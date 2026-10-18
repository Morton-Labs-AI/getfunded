"""An exhaustive inventory and a durable local research queue.

This module only reads Postgres. Research stays in a private local campaign
until reviewed through the existing Greenbook / signals publication paths.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import tempfile
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

from ..config import get_settings
from ..db import connect
from .crawl import PublicWeb, canonical, crawl_org, now

# One row per organization, including recipients, merged records, entities with
# no site, and already-enriched entities. No financial/posture threshold.
INVENTORY_SQL = """
select o.id::text as org_id, o.name as org_name, o.org_type, o.state, ident.ein,
       o.canonical_org_id::text,
       coalesce(w.website_url, ow.website, nullif(btrim(o.website), '')) as website,
       case when w.id is not null then 'confirmed_website'
            when ow.website is not null then 'filing'
            when nullif(btrim(o.website), '') is not null then 'registry'
            else 'unknown' end as website_basis,
       ow.object_id as website_filing, ow.tax_period as website_tax_period,
       w.reviewed_at as website_reviewed_at
from internal.organizations o
left join lateral (
    select case when count(distinct i.id_value) = 1 then min(i.id_value) end as ein
    from internal.org_identifiers i
    where i.org_id = o.id and i.id_type = 'ein'
) ident on true
left join internal.org_website ow on ow.org_id = o.id
left join internal.org_web_facts w on w.org_id = o.id and w.status = 'confirmed'
order by o.id
"""


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def write_json(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # Reports can be refreshed while a worker updates its own checkpoint.
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, suffix=".partial", delete=False) as f:
        tmp = Path(f.name)
        try:
            f.write(json.dumps(obj, indent=2, ensure_ascii=False, default=str) + "\n")
            f.close()
            tmp.replace(path)
        finally:
            tmp.unlink(missing_ok=True)


def inventory(out: Path) -> dict:
    if out.exists():
        raise ValueError("inventory exists; use a new campaign path to preserve its denominator")
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_suffix(out.suffix + ".partial")
    started = now()
    count, kinds = 0, Counter()
    with connect() as conn:
        conn.execute("set transaction isolation level repeatable read read only")
        expected = conn.execute("select count(*) from internal.organizations").fetchone()[0]
        with conn.cursor(name="research_inventory") as cur, partial.open("w") as f:
            cur.itersize = 2000
            cur.execute(INVENTORY_SQL)
            names = [d.name for d in cur.description] if cur.description else None
            for row in cur:
                if names is None:
                    names = [d.name for d in cur.description]
                item = dict(zip(names, row))
                f.write(json.dumps(item, default=str, ensure_ascii=False) + "\n")
                count += 1
                kinds[item["org_type"]] += 1
    if count != expected:
        raise ValueError(f"inventory denominator mismatch: expected {expected}, got {count}")
    partial.replace(out)
    metadata = {"schema": "organization_inventory/v1", "started_at": started,
                "completed_at": now(), "expected_organizations": expected,
                "organizations": count, "by_type": dict(kinds), "sha256": sha256(out),
                "scope": "all organizations in one repeatable-read database snapshot",
                "is_research_completion": False}
    write_json(out.with_suffix(out.suffix + ".meta.json"), metadata)
    return metadata


@contextmanager
def queue(run: Path):
    run.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(run / "queue.sqlite3", timeout=30)
    db.row_factory = sqlite3.Row
    db.executescript("""
      create table if not exists campaign (key text primary key, value text not null);
      create table if not exists organizations (
        org_id text primary key, target text not null, state text not null,
        attempts integer not null default 0, updated_at text not null, result_path text);
      create index if not exists research_state on organizations(state, attempts, org_id);
      create table if not exists research_steps (
        org_id text not null references organizations(org_id), stage text not null,
        outcome text not null, recorded_at text not null, record_path text not null,
        record_sha256 text primary key);
      create index if not exists research_steps_org_stage on research_steps(org_id,stage);
    """)
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(run: Path, targets: Path) -> dict:
    # Hash the immutable input before parsing anything into the local worklist.
    digest = sha256(targets)
    with queue(run) as db:
        old = db.execute("select value from campaign where key='input_sha256'").fetchone()
        if old:
            if old[0] != digest:
                raise ValueError("campaign input changed; create a new run directory")
            return report(run)
        db.execute("insert into campaign values ('input_sha256', ?)", (digest,))
        db.execute("insert into campaign values ('input_path', ?)", (str(targets.resolve()),))
        meta_path = targets.with_suffix(targets.suffix + ".meta.json")
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        if meta.get("sha256") and meta["sha256"] != digest:
            raise ValueError("inventory hash does not match its census metadata")
        db.execute("insert into campaign values ('scope', ?)", (meta.get("scope", "supplied targets only"),))
        n = 0
        with targets.open() as f:
            for line in f:
                if not line.strip():
                    continue
                target = json.loads(line)
                if not target.get("org_id") or not target.get("org_name"):
                    raise ValueError("every target needs org_id and org_name")
                # Do not let an untrusted identifier become a path outside run/.
                from uuid import UUID
                target["org_id"] = str(UUID(target["org_id"]))
                state = "merged" if target.get("canonical_org_id") else (
                    "pending" if target.get("website") else "needs_discovery")
                db.execute("insert into organizations(org_id,target,state,updated_at) values(?,?,?,?)",
                           (target["org_id"], json.dumps(target), state, now()))
                n += 1
        if meta.get("organizations") is not None and n != meta["organizations"]:
            raise ValueError("inventory row count differs from census metadata")
        db.execute("insert into campaign values ('denominator', ?)", (str(n),))
    return report(run)


def research(run: Path, max_pages: int, limit: int | None, retry_blocked: bool, echo=print) -> dict:
    if not (run / "queue.sqlite3").exists():
        raise ValueError("run research init first")
    web = PublicWeb(run / "snapshots", get_settings().http_user_agent)
    with queue(run) as db:
        # An exclusive lease avoids two workers racing on the same local queue.
        # flock releases automatically on process exit, including SIGKILL.
        import fcntl
        with (run / "worker.lock").open("w") as lease:
            fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            db.execute("update organizations set state='pending' where state='running'")
            if retry_blocked:
                db.execute("update organizations set state='pending' where state='blocked'")
            db.commit()
            done = 0
            while limit is None or done < limit:
                row = db.execute("select * from organizations where state='pending' order by attempts,org_id limit 1").fetchone()
                if row is None:
                    break
                target = json.loads(row["target"])
                db.execute("update organizations set state='running',attempts=attempts+1,updated_at=? where org_id=?",
                           (now(), row["org_id"]))
                db.commit()
                result = crawl_org(target, web, max_pages)
                output = run / "results" / f"{row['org_id']}.json"
                # Retries preserve prior review evidence; snapshots are immutable.
                if output.exists():
                    archive = run / "history" / f"{row['org_id']}-{sha256(output)}.json"
                    archive.parent.mkdir(parents=True, exist_ok=True)
                    output.replace(archive)
                write_json(output, result)
                db.execute("update organizations set state=?,updated_at=?,result_path=? where org_id=?",
                           (result["status"], now(), str(output), row["org_id"]))
                db.commit()
                done += 1
                echo(f"{target['org_name']}: {result['status']}; pages={len(result['pages'])}; errors={len(result['errors'])}")
    return report(run)


def assign_website(run: Path, org_id: str, url: str, evidence_url: str, note: str) -> dict:
    """Record an attributed discovery as a candidate, without confirming identity."""
    from uuid import UUID
    org_id, url, evidence_url = str(UUID(org_id)), canonical(url), canonical(evidence_url)
    amendment = {"org_id": org_id, "candidate_website": url, "evidence_url": evidence_url,
                 "note": note, "recorded_at": now(), "identity_status": "needs_review"}
    data = (json.dumps(amendment, sort_keys=True) + "\n").encode()
    digest = hashlib.sha256(data).hexdigest()
    path = run / "discoveries" / f"{digest}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    with queue(run) as db:
        row = db.execute("select target,state from organizations where org_id=?", (org_id,)).fetchone()
        if row is None or row["state"] not in ("needs_discovery", "blocked"):
            raise ValueError("target must exist and be awaiting discovery or blocked")
        target = json.loads(row["target"])
        target.update(website=url, website_basis="research_candidate",
                      discovery={"path": str(path), "sha256": digest})
        db.execute("update organizations set target=?,state='pending',updated_at=? where org_id=?",
                   (json.dumps(target), now(), org_id))
    return amendment


def report(run: Path, export_discovery: bool = False) -> dict:
    with queue(run) as db:
        # The concurrent worker can commit between SELECTs. Read one snapshot so
        # acquisition totals and state counts describe the same queue instant.
        db.execute("begin")
        counts = {r[0]: r[1] for r in db.execute("select state,count(*) from organizations group by state")}
        settings = {r[0]: r[1] for r in db.execute("select key,value from campaign")}
        attempted = db.execute("select count(*) from organizations where attempts>0").fetchone()[0]
        steps = {r[0]: r[1] for r in db.execute("select stage,count(distinct org_id) from research_steps group by stage")}
        total = sum(counts.values())
        out = {"as_of": now(), "scope": settings.get("scope", "uninitialized"),
               "input_sha256": settings.get("input_sha256"), "organizations": total,
               "states": counts, "crawl_attempted": attempted,
               "evidence_ready": counts.get("evidence_ready", 0),
               "organizations_with_recorded_research_steps": steps,
               "human_reviewed": 0, "published_by_this_workflow": 0,
               "all_organizations_researched": False,
               "pending_work": "Identity verification, missing-site search, reverse research, evidence review and publication are separate steps."}
        # A streamed worklist for every missing-site org; never counts a query as executed.
        if export_discovery:
            with (run / "discovery.jsonl").open("w") as f:
                for row in db.execute("select target from organizations where state='needs_discovery'"):
                    t = json.loads(row[0])
                    f.write(json.dumps({"org_id": t["org_id"], "org_name": t["org_name"],
                                        "query": " ".join(filter(None, [t["org_name"], t.get("ein"), t.get("state"), "official foundation grants"])),
                                        "search_executed": False}) + "\n")
    write_json(run / "coverage.json", out)
    return out
