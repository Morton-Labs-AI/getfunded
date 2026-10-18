"""Checkpoint evidence checks against the existing crawler; no network/model calls."""
from __future__ import annotations

import fcntl
import hashlib
import json
import shutil
import sqlite3
import time
from functools import lru_cache
from pathlib import Path

from .cohort import PROTOCOL, evidence_db
from .crawl import now
from .evidence import build_packet
from .pipeline import sha256, write_json


@lru_cache(maxsize=256)
def eligibility_page(path: str, digest: str, mtime_ns: int, size: int) -> dict:
    if sha256(Path(path)) != digest:
        raise ValueError("eligibility source hash mismatch")
    return {row["id"]: row for row in json.loads(Path(path).read_text())}


def eligibility_check(target: dict) -> None:
    ref = target["c3_evidence"]
    info = Path(ref["page"]).stat()
    row = eligibility_page(ref["page"], ref["sha256"], info.st_mtime_ns, info.st_size).get(target["org_id"])
    if (not row or row["subsection_code"] != "03"
            or row["source_dataset"] != "irs_eo_bmf"
            or row["source_record_locator"] != "row:EIN=" + target["ein"]):
        raise ValueError("subsection evidence does not match cohort member")


def status(run: Path, worker_state: str | None = None) -> dict:
    cohort = json.loads((run / "cohort.json").read_text())
    with evidence_db(run) as db:
        db.execute("begin")
        counts = dict(db.execute("select state,count(*) from members group by state"))
        processed = db.execute("select count(*) from members where updated_at is not null").fetchone()[0]
        attempts, pages, seconds = db.execute(
            "select count(*),coalesce(sum(pages),0),coalesce(sum(elapsed_seconds),0) from observations").fetchone()
        identities = dict(db.execute("""select o.identity_evidence,count(*) from observations o
            join (select org_id,max(id) as latest from observations group by org_id) last
              on o.id=last.latest group by o.identity_evidence"""))
        pending_proposals = db.execute("select count(*) from submissions").fetchone()[0]
    out = {"schema": PROTOCOL, "as_of": now(), "cohort_size": cohort["members"],
           "cohort_sha256": cohort["members_sha256"], "processed_members": processed,
           "remaining_initial_pass": cohort["members"] - processed, "states": counts,
           "identity_evidence": identities, "observation_records": attempts,
           "page_checks": pages, "measured_check_seconds": round(seconds, 3),
           "candidate_submissions": pending_proposals, "remote_applied": 0,
           "human_reviewed": 0, "published": 0, "fully_verified_organizations": 0,
           "model_calls_by_evidence_worker": 0, "model_tokens_by_evidence_worker": 0,
           "interactive_agent_cost": "not measured by this worker",
           "rules_phase": "initial_pass_complete_rules_review_due" if processed == cohort["members"]
                          else "collecting_real_outcomes_before_rules_review",
           "free_gib": round(shutil.disk_usage(run).free / 1024**3, 1),
           "completion_note": "Processed includes missing-site and blocked dispositions; source-span checks do not certify semantic claims or complete verification."}
    if worker_state is not None:
        out["worker_state"] = worker_state
    else:
        existing = run / "evidence-status.json"
        if existing.exists():
            old = json.loads(existing.read_text())
            out["worker_state"] = old.get("worker_state", "unknown")
    write_json(run / "evidence-status.json", out)
    milestone = run / "initial-pass-rules-review.json"
    if processed == cohort["members"] and not milestone.exists():
        write_json(milestone, {
            "created_at": now(), "cohort_sha256": cohort["members_sha256"],
            "initial_dispositions": counts, "identity_evidence": identities,
            "page_checks": pages, "measured_check_seconds": round(seconds, 3),
            "status": "rules_documentation_and_adjudicated_benchmark_required",
            "not_a_verification_completion": True,
            "next_steps": [
                "Document observed if/then rules, counterexamples and unresolved dependencies.",
                "Create separately adjudicated examples across success, conflict and blocker strata.",
                "Measure candidate models against frozen evidence and labels, including costs and abstentions.",
                "Propose versioned improvements; preserve evaluation holdouts and all review/publication gates.",
            ], "automatic_rule_or_model_promotion": False,
        })
    return out


def next_batch(run: Path, source_run: Path, limit: int) -> list[dict]:
    with sqlite3.connect((source_run / "queue.sqlite3").as_uri() + "?mode=ro",
                         uri=True, timeout=30) as db:
        db.row_factory = sqlite3.Row
        db.execute("attach database ? as v",
                   ((run / "verification.sqlite3").resolve().as_uri() + "?mode=ro",))
        select = """
          select m.org_id,m.target,m.selection_rank,m.revision,o.state as source_state,
                 o.result_path,o.updated_at as source_updated_at
          from v.members m cross join organizations o on o.org_id=m.org_id
        """
        # Drain indexed pending rows first. Do not rescan the full population
        # for every initial batch; follow-up comparisons happen after that drain.
        rows = [dict(row) for row in db.execute(select + """
          where m.state='pending'
          order by m.selection_rank limit ?
        """, (limit,))]
        if rows:
            return rows
        return [dict(row) for row in db.execute(select + """
          where m.source_updated_at is null or m.source_updated_at != o.updated_at
             or m.processed_revision != m.revision
          order by m.selection_rank limit ?
        """, (limit,))]


def check_member(run: Path, source_run: Path, row: dict, db: sqlite3.Connection) -> None:
    started = time.monotonic()
    target = json.loads(row["target"])
    digest, error = None, None
    try:
        eligibility_check(target)
        supplements = []
        for supplement in sorted((run / "supplements" / row["org_id"]).glob("*.json")):
            if sha256(supplement) != supplement.stem:
                raise ValueError("supplement source hash mismatch")
            item = json.loads(supplement.read_text())
            if item["org_id"] != target["org_id"] or item["ein"] != target["ein"]:
                raise ValueError("supplement identity envelope differs from member")
            supplements.extend(item["pages"])
        if row["result_path"] or supplements:
            result = {"org_id": target["org_id"], "ein": target["ein"], "pages": []}
        if row["result_path"]:
            path = Path(row["result_path"]).resolve()
            if source_run.parent not in path.parents:
                raise ValueError("result reference outside private research directory")
            data = path.read_bytes()
            digest = hashlib.sha256(data).hexdigest()
            result = json.loads(data)
        if row["result_path"] or supplements:
            unique = {(p["url"], p["snapshot"]["sha256"]): p
                      for p in result["pages"] + supplements}
            result["pages"] = list(unique.values())
            packet = build_packet(target, result, source_run)
        else:
            state = "needs_website_discovery" if row["source_state"] == "needs_discovery" else "waiting_for_acquisition"
            packet = {"schema": PROTOCOL, "org_id": target["org_id"],
                      "org_name": target["org_name"], "ein": target["ein"],
                      "checked_at": now(), "state": state, "pages": [],
                      "c3_evidence": target["c3_evidence"],
                      "identity_evidence": "website_identity_not_checked",
                      "blocker": row["source_state"], "semantic_review": "pending",
                      "human_reviewed": False, "published": False,
                      "application_status": "awaiting_separate_application"}
    except (OSError, ValueError, KeyError) as exc:
        error = f"{type(exc).__name__}: {exc}"[:500]
        packet = {"schema": PROTOCOL, "org_id": target["org_id"], "checked_at": now(),
                  "state": "source_integrity_blocked", "pages": [], "error": error,
                  "identity_evidence": "not_established", "semantic_review": "pending",
                  "human_reviewed": False, "published": False}
    body = (json.dumps(packet, sort_keys=True, ensure_ascii=False) + "\n").encode()
    packet_hash = hashlib.sha256(body).hexdigest()
    path = run / "packets" / row["org_id"][:2] / row["org_id"] / (packet_hash + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(body)
    db.execute("""update members set state=?,result_sha256=?,packet_path=?,
        updated_at=?,error=?,source_updated_at=?,processed_revision=? where org_id=?""",
        (packet["state"], digest, str(path.resolve()), now(), error,
         row["source_updated_at"], row["revision"], row["org_id"]))
    db.execute("""insert into observations(org_id,observed_at,state,packet_sha256,
                  pages,identity_evidence,elapsed_seconds) values(?,?,?,?,?,?,?)""",
               (row["org_id"], now(), packet["state"], packet_hash, len(packet["pages"]),
                packet["identity_evidence"], time.monotonic() - started))
    db.commit()


def work(run: Path, follow: bool = False, batch_size: int = 250,
         limit: int | None = None, echo=print) -> dict:
    run = run.resolve()
    cohort = json.loads((run / "cohort.json").read_text())
    if sha256(run / "members.jsonl") != cohort["members_sha256"]:
        raise ValueError("fixed cohort membership hash mismatch")
    source_run = Path(cohort["source_run"])
    done, last_status = 0, 0.0
    with (run / "evidence-worker.lock").open("a") as lease, evidence_db(run) as db:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            while True:
                if shutil.disk_usage(run).free < 10 * 1024**3:
                    return status(run, "low_disk")
                rows = next_batch(run, source_run, min(batch_size, limit - done) if limit else batch_size)
                if not rows:
                    current = status(run, "following_crawler" if follow else "pass_drained")
                    echo(json.dumps(current))
                    if not follow:
                        return current
                    time.sleep(30)
                    continue
                for row in rows:
                    if shutil.disk_usage(run).free < 10 * 1024**3:
                        return status(run, "low_disk")
                    check_member(run, source_run, row, db)
                    done += 1
                if time.monotonic() - last_status >= 30 or (limit and done >= limit):
                    current = status(run, "checking_saved_evidence")
                    echo(json.dumps(current))
                    last_status = time.monotonic()
                if limit and done >= limit:
                    return status(run, "bounded_pass_finished")
        except BaseException:
            status(run, "interrupted; checkpointed_members_retained")
            raise


def prioritize(run: Path) -> dict:
    """Reprioritize pending local acquisition, preserving exact local before-images."""
    cohort = json.loads((run / "cohort.json").read_text())
    source = Path(cohort["source_run"])
    marker = run / "acquisition-priority.json"
    if marker.exists():
        return json.loads(marker.read_text())
    with sqlite3.connect(source / "queue.sqlite3", timeout=30) as db:
        db.row_factory = sqlite3.Row
        db.execute("attach database ? as v", (str((run / "verification.sqlite3").resolve()),))
        db.execute("begin immediate")
        rows = [dict(r) for r in db.execute("""select o.org_id,o.state,o.priority,o.updated_at
            from organizations o join v.members m using(org_id)
            where o.state='pending' and o.priority>5 order by o.org_id""")]
        before = run / "local-priority-before-images.json"
        if before.exists():
            raise ValueError("priority before-images already exist; reconcile interrupted update")
        write_json(before, {"recorded_at": now(), "rows": rows,
                            "scope": "local acquisition queue only; no remote mutation"})
        db.executemany("update organizations set priority=5 where org_id=? and state=? and priority=?",
                       [(r["org_id"], r["state"], r["priority"]) for r in rows])
        db.commit()
    out = {"as_of": now(), "changed_local_rows": len(rows),
           "before_images_sha256": sha256(before), "remote_mutations": 0}
    write_json(marker, out)
    return out
