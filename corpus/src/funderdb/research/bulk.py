"""Resumable read-only Data API export, without a privileged database password.

The public views enforce the existing licensing boundary. Their population must
be reconciled with an operator's internal census before claiming full coverage.
An API export has a multi-request observation interval, not snapshot isolation.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urlsplit

import httpx

from ..config import get_settings
from .crawl import now
from .pipeline import sha256, write_json

ORG_SELECT = ("id,name,org_type,city,state,country,website,ntee_code,"
              "source_dataset,source_record_locator,license_code,"
              "org_identifiers(id_type,id_value)")
FILING_SELECT = "object_id,org_id,ein,tax_period,website,source_dataset,source_url,license_code"


class ReadAPI:
    def __init__(self, access: Path):
        cfg = json.loads(access.read_text())
        parsed = urlsplit(cfg["url"])
        if (parsed.scheme != "https" or not parsed.hostname
                or not parsed.hostname.endswith(".supabase.co")
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
            raise ValueError("access file must name a hosted Supabase HTTPS origin")
        self.url = cfg["url"].rstrip("/") + "/rest/v1/"
        self.client = httpx.Client(
            base_url=self.url, headers={"apikey": cfg["key"],
                                      "User-Agent": get_settings().http_user_agent},
            timeout=45, follow_redirects=False,
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=1),
        )

    def close(self):
        self.client.close()

    def get(self, table: str, params: dict) -> httpx.Response:
        if table not in ("organizations", "filings", "funding_events"):
            raise ValueError("only the public inventory/funding-event views are supported")
        for attempt in range(3):
            try:
                response = self.client.get(table, params=params)
                if response.status_code not in (429, 500, 502, 503, 504):
                    response.raise_for_status()
                    return response
                retry = response.headers.get("Retry-After", "")
                delay = int(retry) if retry.isdigit() else 2 ** (attempt + 1)
                if delay > 30:
                    raise RuntimeError(f"Data API asks for a later retry ({delay}s)")
                if attempt == 2:
                    response.raise_for_status()
                time.sleep(delay)
            except httpx.TransportError:
                if attempt == 2:
                    raise
                time.sleep(2 ** (attempt + 1))
        raise RuntimeError("Data API retries exhausted")


def shards(table: str):
    if table == "organizations":
        for n in range(16):
            lo = f"{n:x}0000000-0000-0000-0000-000000000000"
            hi = f"{n+1:x}0000000-0000-0000-0000-000000000000" if n < 15 else None
            yield f"{n:x}", lo, hi
    else:
        edges = [None, *map(str, range(2012, 2028)), None]
        for n, (lo, hi) in enumerate(zip(edges, edges[1:])):
            yield f"{n:02}", lo, hi


def export_shard(access: Path, run: Path, table: str, shard: tuple, echo) -> dict:
    label, lower, upper = shard
    root = run / "api" / table / label
    checkpoint = root / "checkpoint.json"
    state = json.loads(checkpoint.read_text()) if checkpoint.exists() else {
        "table": table, "shard": label, "lower": lower, "upper": upper,
        "started_at": now(), "rows": 0, "cursor": None, "pages": [], "complete": False,
    }
    if state["complete"]:
        return state
    api = ReadAPI(access)
    key = "id" if table == "organizations" else "object_id"
    try:
        while True:
            params = {"select": ORG_SELECT if table == "organizations" else FILING_SELECT,
                      "order": key + ".asc", "limit": "1000"}
            bounds = []
            if state["cursor"]:
                bounds.append(f"{key}.gt.{state['cursor']}")
            elif lower is not None:
                bounds.append(f"{key}.gte.{lower}")
            if upper is not None:
                bounds.append(f"{key}.lt.{upper}")
            if bounds:
                params["and"] = "(" + ",".join(bounds) + ")"
            if table == "filings":
                params.update(website="not.is.null", org_id="not.is.null",
                              superseded_by_object_id="is.null")
            response = api.get(table, params)
            # Hash/save the response before parsing it into inventory records.
            body = response.content
            digest = hashlib.sha256(body).hexdigest()
            path = root / (digest + ".json")
            root.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            rows = json.loads(body)
            if not isinstance(rows, list):
                raise ValueError("Data API did not return an array")
            previous = state["cursor"]
            for row in rows:
                value = row[key]
                if ((previous is not None and value <= previous)
                        or (lower and value < lower) or (upper and value >= upper)):
                    raise ValueError("non-monotone or out-of-range API page")
                previous = value
            state["pages"].append({"sha256": digest, "rows": len(rows),
                                   "url": str(response.url), "fetched_at": now()})
            state["rows"] += len(rows)
            if rows:
                state["cursor"] = rows[-1][key]
            else:
                state["complete"] = True
                state["completed_at"] = now()
            write_json(checkpoint, state)
            if state["complete"] or len(state["pages"]) % 25 == 0:
                echo(f"{table}/{label}: {state['rows']:,} rows; complete={state['complete']}", flush=True)
            if state["complete"]:
                return state
    finally:
        api.close()


def export_api(access: Path, run: Path, workers: int = 4, echo=print) -> dict:
    """Export every org and all unsuperseded public filing website records."""
    import fcntl
    run.mkdir(parents=True, exist_ok=True)
    with (run / "export.lock").open("w") as lease:
        fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        api = ReadAPI(access)
        source = {"url": api.url, "schema": "public", "selects": [ORG_SELECT, FILING_SELECT]}
        api.close()
        source_path = run / "api-source.json"
        if source_path.exists() and json.loads(source_path.read_text()) != source:
            raise ValueError("API source or selection changed; use a new campaign")
        write_json(source_path, source)
        results = []
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(export_shard, access, run, table, part, echo)
                       for table in ("organizations", "filings") for part in shards(table)]
            for future in as_completed(futures):
                results.append(future.result())
        result = {"completed_at": now(), "read_only": True, "transport": "Supabase Data API",
                  "consistency": "keyset-paginated observation interval; not a transactional snapshot",
                  "tables": {t: sum(s["rows"] for s in results if s["table"] == t)
                             for t in ("organizations", "filings")}}
        write_json(run / "api-export.json", result)
        return result


def iter_pages(run: Path, table: str):
    for checkpoint in sorted((run / "api" / table).glob("*/checkpoint.json")):
        state = json.loads(checkpoint.read_text())
        if not state["complete"]:
            raise ValueError(f"unfinished API shard: {checkpoint}")
        for page in state["pages"]:
            path = checkpoint.parent / (page["sha256"] + ".json")
            if sha256(path) != page["sha256"]:
                raise ValueError(f"API page hash mismatch: {path}")
            yield page, json.loads(path.read_text())


def compile_inventory(run: Path, expected: int, expected_filings: int,
                      confirmed_sites: Path | None = None) -> dict:
    export = json.loads((run / "api-export.json").read_text())
    if export["tables"] != {"organizations": expected, "filings": expected_filings}:
        raise ValueError("API counts differ from the live database census; reconcile before research")
    out = run / "inventory.jsonl"
    if out.exists():
        raise ValueError("inventory already exists; preserve it or start a new campaign")
    # Reduction is local. Never run the expensive global DISTINCT view per page.
    db = sqlite3.connect(run / "filing-websites.sqlite3")
    # Rebuildable local reduction over immutable inputs; bounded cache avoids
    # thrashing the default 2 MiB cache on a million filing upserts.
    db.execute("pragma cache_size=-131072")
    db.execute("create table if not exists sites (org_id text primary key, tax_period text, object_id text, record text, raw_sha256 text)")
    try:
        for page, rows in iter_pages(run, "filings"):
            for row in rows:
                db.execute("""insert into sites values (?,?,?,?,?) on conflict(org_id) do update set
                    tax_period=excluded.tax_period,object_id=excluded.object_id,
                    record=excluded.record,raw_sha256=excluded.raw_sha256
                    where (excluded.tax_period,excluded.object_id) > (sites.tax_period,sites.object_id)""",
                           (row["org_id"], row["tax_period"] or "", row["object_id"], json.dumps(row), page["sha256"]))
            db.commit()
        confirmed = {}
        if confirmed_sites:
            confirmed = {r["org_id"]: r for r in json.loads(confirmed_sites.read_text())}
        count, with_site, kinds = 0, 0, {}
        partial = out.with_suffix(".jsonl.partial")
        with partial.open("w") as f:
            for page, rows in iter_pages(run, "organizations"):
                for row in rows:
                    org_id = row["id"]
                    filing = db.execute("select record,raw_sha256 from sites where org_id=?", (org_id,)).fetchone()
                    filing_row = json.loads(filing[0]) if filing else {}
                    web = confirmed.get(org_id, {})
                    website = web.get("website_url") or filing_row.get("website") or row.get("website")
                    eins = {i["id_value"] for i in row.get("org_identifiers", []) if i["id_type"] == "ein"}
                    target = {"org_id": org_id, "org_name": row["name"], "org_type": row["org_type"],
                              "city": row["city"], "state": row["state"], "country": row["country"],
                              "ntee_code": row["ntee_code"], "ein": next(iter(eins)) if len(eins) == 1 else None,
                              "identifiers": row.get("org_identifiers", []), "website": website,
                              "website_basis": "confirmed_website" if web else "filing" if filing else "registry" if website else "unknown",
                              "website_filing": filing_row.get("object_id"), "website_tax_period": filing_row.get("tax_period"),
                              "website_reviewed_at": web.get("reviewed_at"),
                              "registry_source_dataset": row["source_dataset"], "registry_source_locator": row["source_record_locator"],
                              "registry_license_code": row["license_code"],
                              "filing_source_url": filing_row.get("source_url"), "filing_license_code": filing_row.get("license_code"),
                              "inventory_page_sha256": page["sha256"], "filing_page_sha256": filing[1] if filing else None}
                    f.write(json.dumps(target, ensure_ascii=False) + "\n")
                    count += 1
                    with_site += bool(website)
                    kinds[row["org_type"]] = kinds.get(row["org_type"], 0) + 1
        if count != expected:
            raise ValueError("compiled inventory count mismatch")
        partial.replace(out)
        meta = {"schema": "organization_inventory/v1", "completed_at": now(), "organizations": count,
                "expected_organizations": expected, "with_candidate_website": with_site,
                "by_type": kinds, "sha256": sha256(out),
                "scope": "all public organizations, reconciled to the internal census count",
                "consistency": export["consistency"], "is_research_completion": False,
                "confirmed_sites_sha256": sha256(confirmed_sites) if confirmed_sites else None}
        write_json(out.with_suffix(".jsonl.meta.json"), meta)
        return meta
    finally:
        db.close()
