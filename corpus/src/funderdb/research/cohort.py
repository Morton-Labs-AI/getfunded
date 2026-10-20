"""Freeze a local evidence cohort from explicit IRS subsection observations.

The existing Data API client has GET only. This module never registers files,
writes a remote ledger, changes the immutable population or calls a model.
"""
from __future__ import annotations

import fcntl
import json
import re
import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .bulk import ReadAPI
from .crawl import now
from .pipeline import sha256, write_json

PROTOCOL = "evidence-first/v1"
ELIGIBILITY_SELECT = (
    "id,org_type,subsection_code,source_dataset,source_url,source_record_locator,license_code"
)


@contextmanager
def evidence_db(run: Path):
    run.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect((run / "verification.sqlite3").resolve().as_uri(), uri=True, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("pragma journal_mode=wal")
    db.executescript("""
        create table if not exists eligibility (
          org_id text primary key, record text not null, page text not null,
          page_sha256 text not null, observed_at text not null);
        create table if not exists members (
          org_id text primary key, target text not null, selection_rank integer not null,
          state text not null default 'pending', result_sha256 text,
          packet_path text, updated_at text, error text, source_updated_at text,
          revision integer not null default 0, processed_revision integer not null default -1);
        create index if not exists evidence_state on members(state,selection_rank);
        create index if not exists evidence_rank on members(selection_rank);
        create table if not exists submissions (
          sha256 text primary key, org_id text not null, path text not null,
          recorded_at text not null, status text not null);
        create table if not exists observations (
          id integer primary key, org_id text not null, observed_at text not null,
          state text not null, packet_sha256 text not null, pages integer not null,
          identity_evidence text not null, elapsed_seconds real not null);
    """)
    # An interrupted initialization may predate this checkpoint field. This is
    # a private local queue upgrade, never a migration against the live corpus.
    columns = {row[1] for row in db.execute("pragma table_info(members)")}
    if "source_updated_at" not in columns:
        db.execute("alter table members add column source_updated_at text")
    for column, default in (("revision", 0), ("processed_revision", -1)):
        if column not in columns:
            db.execute(f"alter table members add column {column} integer not null default {default}")
    try:
        with db:
            yield db
    finally:
        db.close()


def export_eligibility(access: Path, run: Path, kind: str, echo=print,
                       max_rows: int | None = None) -> dict:
    """Save resumable, hashed public observations before interpreting any row."""
    root = run / "eligibility" / kind
    root.mkdir(parents=True, exist_ok=True)
    checkpoint = root / "checkpoint.json"
    params = {"select": ELIGIBILITY_SELECT, "subsection_code": "eq.03",
              "org_type": "eq." + kind, "source_dataset": "eq.irs_eo_bmf",
              "order": "id.asc", "limit": "1000"}
    state = json.loads(checkpoint.read_text()) if checkpoint.exists() else {
        "parameters": params, "cursor": None, "pages": [], "rows": 0,
        "complete": False, "started_at": now(),
    }
    if state["parameters"] != params:
        raise ValueError("eligibility parameters changed; use a new cohort directory")
    if state["complete"]:
        return state
    api = ReadAPI(access)
    try:
        if any(not page["source_url"].startswith(api.url + "organizations?")
               for page in state["pages"]):
            raise ValueError("eligibility checkpoint belongs to another API source")
        while not state["complete"]:
            if max_rows is not None and state["rows"] >= max_rows:
                # A bounded fallback sample is sufficient to fill the cohort.
                # It must not be called a complete public-charity export.
                return state
            if shutil.disk_usage(run).free < 10 * 1024**3:
                raise RuntimeError("10 GiB disk guard: eligibility export deferred")
            query = dict(params)
            if state["cursor"]:
                query["id"] = "gt." + state["cursor"]
            response = api.get("organizations", query)
            import hashlib
            digest = hashlib.sha256(response.content).hexdigest()
            path = root / (digest + ".json")
            if path.exists() and sha256(path) != digest:
                raise ValueError("saved eligibility response hash mismatch")
            if not path.exists():
                path.write_bytes(response.content)
            rows = json.loads(response.content)
            previous = state["cursor"]
            for row in rows:
                if (row["subsection_code"] != "03" or row["source_dataset"] != "irs_eo_bmf"
                        or row["license_code"] != "us_public_domain"
                        or row["org_type"] != kind
                        or (previous is not None and row["id"] <= previous)):
                    raise ValueError("eligibility response violates the requested source/order")
                previous = row["id"]
            state["pages"].append({"path": str(path.resolve()), "sha256": digest,
                                   "observed_at": now(), "rows": len(rows),
                                   "source_url": str(response.url)})
            state["rows"] += len(rows)
            if rows:
                state["cursor"] = rows[-1]["id"]
            else:
                state["complete"] = True
                state["completed_at"] = now()
            write_json(checkpoint, state)
            if len(state["pages"]) % 10 == 0 or state["complete"]:
                echo(json.dumps({"eligibility_type": kind, "rows": state["rows"],
                                 "complete": state["complete"]}))
    finally:
        api.close()
    return state


def initialize_cohort(source_run: Path, run: Path, access: Path,
                      size: int = 150_000, echo=print) -> dict:
    source_run, run = source_run.resolve(), run.resolve()
    if source_run == run or size < 1:
        raise ValueError("use a separate, positive-size evidence cohort")
    run.mkdir(parents=True, exist_ok=True)
    with (run / "initialize.lock").open("a") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        manifest = run / "cohort.json"
        if manifest.exists():
            old = json.loads(manifest.read_text())
            if old["source_run"] != str(source_run) or old["requested_size"] != size:
                raise ValueError("cohort is immutable; create another directory")
            if sha256(run / "members.jsonl") != old["members_sha256"]:
                raise ValueError("cohort membership hash mismatch")
            return old
        metadata = json.loads((source_run / "inventory.jsonl.meta.json").read_text())
        if sha256(source_run / "inventory.jsonl") != metadata["sha256"]:
            raise ValueError("immutable source inventory hash mismatch")
        # Foundations first: a funder-research priority, never an eligibility claim.
        # Public charities are a fallback only if the explicit subsection cohort is short.
        for kind in ("private_foundation", "public_charity"):
            state = export_eligibility(access, run, kind, echo,
                                       max_rows=size if kind == "public_charity" else None)
            with evidence_db(run) as db:
                for page in state["pages"]:
                    path = Path(page["path"])
                    if sha256(path) != page["sha256"]:
                        raise ValueError("eligibility checkpoint source mismatch")
                    db.executemany("insert or ignore into eligibility values(?,?,?,?,?)", [
                        (row["id"], json.dumps(row), str(path), page["sha256"], page["observed_at"])
                        for row in json.loads(path.read_text())])
            with sqlite3.connect((source_run / "queue.sqlite3").as_uri() + "?mode=ro",
                                 uri=True, timeout=30) as source, evidence_db(run) as db:
                # ATTACH is local and read-only. No remote database connection is involved.
                source.execute("attach database ? as eligibility_cohort",
                               ((run / "verification.sqlite3").as_uri() + "?mode=ro",))
                candidates = source.execute("""
                  select o.org_id,o.target,o.state,e.record,e.page,e.page_sha256,e.observed_at
                  from organizations o join eligibility_cohort.eligibility e using(org_id)
                  order by case json_extract(o.target,'$.org_type')
                             when 'private_foundation' then 0 else 1 end,
                           case o.state when 'evidence_ready' then 0 else 1 end,
                           case when json_extract(o.target,'$.website') is not null
                             then 0 else 1 end,o.org_id
                """)
                chosen, seen = [], set()
                for org_id, target_json, state_name, eligibility_json, page, digest, observed in candidates:
                    target, eligibility = json.loads(target_json), json.loads(eligibility_json)
                    ein = target.get("ein")
                    if (not ein or not re.fullmatch(r"\d{9}", ein) or ein in seen
                            or eligibility["source_record_locator"] != "row:EIN=" + ein
                            or target.get("canonical_org_id")):
                        continue
                    seen.add(ein)
                    target["c3_evidence"] = {"subsection_code": "03", "page": page,
                        "sha256": digest, "source_record_locator": eligibility["source_record_locator"],
                        "source_dataset": "irs_eo_bmf", "observed_at": observed,
                        "standing_not_checked": True}
                    chosen.append(target)
                    if len(chosen) == size:
                        break
                if len(chosen) < size:
                    continue
                members = run / "members.jsonl"
                data = "".join(json.dumps(t, sort_keys=True) + "\n" for t in chosen)
                if members.exists() and members.read_text() != data:
                    raise ValueError("preserve existing cohort membership; resolve partial initialization")
                if not members.exists():
                    members.write_text(data)
                db.executemany("insert or ignore into members(org_id,target,selection_rank) values(?,?,?)",
                               [(t["org_id"], json.dumps(t), rank) for rank, t in enumerate(chosen)])
                if db.execute("select count(*) from members").fetchone()[0] != size:
                    raise ValueError("cohort queue differs from fixed membership")
            out = {"schema": "evidence_cohort/v1", "protocol": PROTOCOL,
                   "created_at": now(), "source_run": str(source_run),
                   "source_inventory_sha256": metadata["sha256"],
                   "source_population": metadata["organizations"], "requested_size": size,
                   "members": size, "unique_eins": size, "members_sha256": sha256(members),
                   "selection": "Explicit BMF subsection03; foundations first, acquired evidence, website, UUID; unique EIN",
                   "fallback_scope": "Public-charity fallback uses only the first bounded UUID-ordered eligibility observations; it is not an exhaustive charity ranking",
                   "eligibility_scope": "IRS BMF classification observation; not a current-standing certification",
                   "remote_mutations": 0, "human_reviewed": 0, "published": 0}
            write_json(manifest, out)
            return out
        raise ValueError(f"fewer than {size} matching, unique-EIN subsection03 organizations")
