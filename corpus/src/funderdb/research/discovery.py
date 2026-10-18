"""Record actual analyst work separately from generated search suggestions."""
from __future__ import annotations

import hashlib
import json
import fcntl
from contextlib import ExitStack
from datetime import datetime
from pathlib import Path
from uuid import UUID

from .crawl import canonical, now
from .pipeline import queue, sha256, write_json

STAGES = ("website_search", "news_search", "reverse_research", "identity_review", "claim_review")
OUTCOMES = ("candidate_found", "no_result", "blocked", "needs_review")


def next_discovery(run: Path, limit: int = 20) -> list[dict]:
    with queue(run) as db:
        from .runner import prepare
        prepare(db)
        rows = db.execute("""select target from organizations o
            where state='needs_discovery' and not exists
              (select 1 from research_steps s where s.org_id=o.org_id and s.stage='website_search')
            order by priority,attempts,org_id limit ?""", (limit,))
        out = []
        for row in rows:
            target = json.loads(row[0])
            query = " ".join(str(v) for v in (target["org_name"], target.get("ein"),
                                            target.get("city"), target.get("state")) if v)
            out.append({**target, "suggested_query": query, "search_executed": False})
        return out


def record_step(run: Path, record: Path) -> dict:
    # Stage the original input before parsing. This is a private research log,
    # not an approved fact or a substitute for registering publisher snapshots.
    data = record.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    raw = run / "research-steps" / digest[:2] / (digest + ".json")
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_bytes(data)
    item = json.loads(raw.read_text())
    org_id = str(UUID(item["org_id"]))
    if item.get("stage") not in STAGES or item.get("outcome") not in OUTCOMES:
        raise ValueError("unsupported research stage or outcome")
    if not item.get("performed_at") or not item.get("method") or not item.get("note"):
        raise ValueError("performed_at, method and note must describe work actually performed")
    if datetime.fromisoformat(item["performed_at"].replace("Z", "+00:00")).tzinfo is None:
        raise ValueError("performed_at needs an ISO timestamp with a timezone")
    if item["stage"].endswith("search") or item["stage"] == "reverse_research":
        if (not isinstance(item.get("queries"), list) or not item["queries"]
                or not all(isinstance(q, str) and q.strip() for q in item["queries"])):
            raise ValueError("search stages need the exact executed queries")
    sources = item.get("source_urls", [])
    if not isinstance(sources, list):
        raise ValueError("source_urls must be an array")
    for url in sources:
        canonical(url)
    if item["outcome"] == "candidate_found" and not sources:
        raise ValueError("a discovered candidate needs at least one attributed source URL")
    with queue(run) as db:
        if not db.execute("select 1 from organizations where org_id=?", (org_id,)).fetchone():
            raise ValueError("organization is outside this campaign")
        db.execute("insert or ignore into research_steps values(?,?,?,?,?,?)",
                   (org_id, item["stage"], item["outcome"], now(), str(raw.resolve()), digest))
    return {"org_id": org_id, "stage": item["stage"], "outcome": item["outcome"],
            "record_sha256": digest, "approved_fact": False}


def carry_forward(run: Path, previous: Path) -> dict:
    """Reuse dated evidence for matching UUIDs; never refresh its observation date."""
    if run.resolve() == previous.resolve():
        raise ValueError("source and destination campaigns must differ")
    with ExitStack() as stack:
        for root in sorted((run, previous), key=lambda p: str(p.resolve())):
            if not (root / "queue.sqlite3").exists():
                raise ValueError("both campaigns must already be initialized")
            lease = stack.enter_context((root / "worker.lock").open("w"))
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return _carry_forward(run, previous)


def _carry_forward(run: Path, previous: Path) -> dict:
    count = 0
    with queue(previous) as old, queue(run) as db:
        for row in old.execute("select * from organizations where result_path is not null"):
            target = db.execute("select target,state from organizations where org_id=?", (row["org_id"],)).fetchone()
            if not target or target["state"] not in ("pending", "needs_discovery"):
                continue
            result_path = Path(row["result_path"])
            result = json.loads(result_path.read_text())
            if result["org_id"] != row["org_id"] or result["status"] not in ("evidence_ready", "blocked"):
                raise ValueError("source result does not match the queue")
            original = json.loads(row["target"])
            target_data = json.loads(target["target"])
            target_data["prior_research"] = {"source_campaign": str(previous.resolve()),
                                            "result_sha256": sha256(result_path)}
            for key in ("website", "website_basis", "discovery", "research_urls"):
                if key in original:
                    target_data[key] = original[key]
            output = run / "results" / row["org_id"][:2] / (row["org_id"] + ".json")
            # Preserve the exact bytes and their original date, snapshots and locators.
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(result_path.read_bytes())
            db.execute("""update organizations set target=?,state=?,attempts=?,updated_at=?,result_path=?
                where org_id=?""", (json.dumps(target_data), result["status"], row["attempts"],
                                   now(), str(output.resolve()), row["org_id"]))
            count += 1
    manifest = {"source_campaign": str(previous.resolve()), "carried_forward_at": now(),
                "organizations": count, "refreshes_observation_dates": False}
    name = hashlib.sha256(str(previous.resolve()).encode()).hexdigest()
    write_json(run / "carry-forward" / (name + ".json"), manifest)
    return manifest
