"""Database side of funder signals: load sources, discover candidates, process,
publish. Every write follows the corpus doctrine: a hashed file is registered
in internal.raw_files first, a ledger run brackets the work, and a row never
exists without raw_file_id + source_record_locator.

Two datasets:
  funder_signals  our run manifests and seed CSVs (licence cc_by)  -> raw_file_id
  funder_press    publisher page snapshots (licence publisher_website) -> snapshot_raw_file_id
"""

from __future__ import annotations

import csv
import json
import re
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..normalize import normalize_ein, normalize_name
from . import classify as clf
from . import fetch as fx

DATASET_MANIFESTS = "funder_signals"
DATASET_SNAPSHOTS = "funder_press"
SOURCES_CSV = Path("data/seed/signal_sources.csv")
URLS_CSV = Path("data/seed/signal_urls.csv")
DEFAULT_MODEL = "claude-opus-5-5"


# ---------------------------------------------------------------------------
# Settings shims (the two corpus forks name a few settings differently)
# ---------------------------------------------------------------------------
def _user_agent() -> str:
    s = get_settings()
    return (getattr(s, "signals_user_agent", None) or getattr(s, "http_user_agent", None)
            or "funderdb-signals/0.1 (Open Funder Database; +set HTTP_USER_AGENT)")


def _ai_mode() -> str:
    return (getattr(get_settings(), "signals_ai_mode", None) or "live").lower()


def _model() -> str:
    return getattr(get_settings(), "anthropic_model", None) or DEFAULT_MODEL


def _api_key() -> str | None:
    return getattr(get_settings(), "anthropic_api_key", None)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Files: manifests (ours, cc_by) and snapshots (theirs, publisher_website)
# ---------------------------------------------------------------------------
def _write_json_file(name: str, payload: dict) -> Path:
    tmp_dir = get_settings().data_root / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    fd, path = tempfile.mkstemp(prefix=name + "_", suffix=".json", dir=tmp_dir)
    Path(path).write_text(json.dumps(payload, indent=2, sort_keys=True, default=str) + "\n",
                          encoding="utf-8")
    return Path(path)


def register_manifest(conn: psycopg.Connection, kind: str, payload: dict,
                      *, source_url: str | None = None) -> tuple[int, staging.StagedFile]:
    """Our own compilation artifact: what this run saw and decided. cc_by."""
    stamp = _now().strftime("%Y%m%dT%H%M%SZ")
    tmp = _write_json_file(f"signals-{kind}-{stamp}", payload)
    staged = staging.stage_local(DATASET_MANIFESTS, tmp, source_url)
    tmp.unlink(missing_ok=True)
    rfid = staging.register_raw_file(
        conn, staged, license_code="cc_by", content_type="application/json",
        as_of_date=_now().date(),
        meta={"kind": kind, "curated_by": "Morton Labs", "items": payload.get("count")},
    )
    conn.commit()
    return rfid, staged


def register_snapshot(conn: psycopg.Connection, result: fx.FetchResult,
                      article: fx.Article) -> int:
    """The publisher's page, as fetched. Not republishable; display-only provenance."""
    payload = {
        "url": result.url, "final_url": result.final_url, "status": result.status_code,
        "headers": result.headers, "fetched_at": result.fetched_at.isoformat(),
        "content_type": result.content_type, "title": article.title,
        "published_at": article.published_at.isoformat() if article.published_at else None,
        "date_evidence": article.date_evidence, "html": result.text,
    }
    slug = re.sub(r"[^a-z0-9]+", "-", result.final_url.lower())[-60:].strip("-") or "page"
    tmp = _write_json_file(f"press-{slug}", payload)
    staged = staging.stage_local(DATASET_SNAPSHOTS, tmp, result.final_url)
    tmp.unlink(missing_ok=True)
    rfid = staging.register_raw_file(
        conn, staged, license_code="publisher_website", content_type="application/json",
        as_of_date=result.fetched_at.date(),
        meta={"http_status": result.status_code, "robots_checked": True},
    )
    return rfid


# ---------------------------------------------------------------------------
# Org resolution
# ---------------------------------------------------------------------------
def org_id_by_ein(cur, ein: str | None) -> str | None:
    norm = normalize_ein(ein or "")
    if not norm:
        return None
    cur.execute(
        """select o.id from internal.org_identifiers i
           join internal.organizations o on o.id = i.org_id
           where i.id_type = 'ein' and i.id_value = %s
           order by (o.canonical_org_id is null) desc limit 1""",
        (norm,),
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def org_id_by_exact_name(cur, name: str) -> str | None:
    """Exactly one canonical org with this normalized name, else None (never guess)."""
    norm = normalize_name(name)
    if len(norm) < 6:
        return None
    cur.execute(
        """select id from internal.organizations
           where name_normalized = %s and canonical_org_id is null
             and org_type in ('private_foundation','public_charity','vc','pe','family_office',
                              'corporate_vc','investment_adviser','gov_agency','company')
           limit 2""",
        (norm,),
    )
    rows = cur.fetchall()
    return str(rows[0][0]) if len(rows) == 1 else None


def link_org(cur, signal_id: int, org_id: str, role: str, method: str, confidence: float) -> bool:
    cur.execute(
        """insert into internal.funder_signal_orgs (signal_id, org_id, role, match_method, confidence)
           values (%s, %s, %s, %s, %s)
           on conflict (signal_id, org_id, role) do nothing
           returning signal_id""",
        (signal_id, org_id, role, method, confidence),
    )
    return cur.fetchone() is not None


# ---------------------------------------------------------------------------
# 1. load-sources
# ---------------------------------------------------------------------------
def load_sources(csv_path: Path = SOURCES_CSV) -> dict[str, int]:
    counts = {"inserted": 0, "updated": 0, "unresolved_ein": 0}
    with connect() as conn:
        staged = staging.stage_local(DATASET_MANIFESTS, csv_path)
        rfid = staging.register_raw_file(conn, staged, license_code="cc_by", content_type="text/csv",
                                         meta={"curated_by": "Morton Labs", "kind": "signal_sources"})
        conn.commit()
        run = ledger.start_run(conn, rfid, DATASET_MANIFESTS)
        try:
            with csv_path.open(encoding="utf-8") as fh, conn.cursor() as cur:
                for row in csv.DictReader(fh):
                    slug = row["slug"].strip()
                    ein = normalize_ein(row.get("org_ein") or "")
                    org_id = org_id_by_ein(cur, ein) if ein else None
                    if ein and org_id is None:
                        counts["unresolved_ein"] += 1
                        print(f"  ! {slug}: EIN {ein} not in internal.org_identifiers "
                              f"(source kept, org_id null)")
                    cur.execute(
                        """insert into internal.signal_sources
                             (slug, publisher, org_id, org_ein, source_kind, url, link_pattern,
                              fetch_interval_hours, notes, raw_file_id, source_record_locator)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                           on conflict (slug) do update set
                             publisher = excluded.publisher,
                             org_id = coalesce(excluded.org_id, internal.signal_sources.org_id),
                             org_ein = excluded.org_ein,
                             source_kind = excluded.source_kind,
                             url = excluded.url,
                             link_pattern = excluded.link_pattern,
                             fetch_interval_hours = excluded.fetch_interval_hours,
                             notes = excluded.notes,
                             raw_file_id = excluded.raw_file_id
                           returning (xmax = 0) as inserted""",
                        (slug, row["publisher"].strip(), org_id, ein, row["source_kind"].strip(),
                         row["url"].strip(), (row.get("link_pattern") or None),
                         int(row.get("fetch_interval_hours") or 24), row.get("notes") or None,
                         rfid, f"row:slug={slug}"),
                    )
                    fetched = cur.fetchone()
                    assert fetched is not None
                    counts["inserted" if fetched[0] else "updated"] += 1
            conn.commit()
            ledger.complete_run(conn, run, inserted=counts["inserted"], updated=counts["updated"])
        except Exception as exc:
            conn.rollback()
            ledger.fail_run(conn, run, f"{type(exc).__name__}: {exc}")
            raise
    return counts


# ---------------------------------------------------------------------------
# 2. add (one URL) and add-urls (the seed CSV)
# ---------------------------------------------------------------------------
def _insert_candidate(cur, *, url: str, source_id: int | None, publisher: str | None,
                      submitted_by: str, note: str | None, rfid: int, headline: str | None = None,
                      published_at=None) -> int | None:
    canon = fx.canonical_url(url)
    cur.execute(
        """insert into internal.funder_signals
             (url, source_id, publisher, headline, published_at, submitted_by, discovery_note,
              raw_file_id, source_record_locator)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
           on conflict (url) do nothing
           returning id""",
        (canon, source_id, publisher, headline, published_at, submitted_by, note, rfid,
         f"url:{canon}"),
    )
    row = cur.fetchone()
    return int(row[0]) if row else None


def add_url(url: str, *, ein: str | None, submitted_by: str, note: str | None) -> dict:
    """A human found a release (LinkedIn, a newsletter): record it as a candidate now."""
    with connect() as conn:
        payload = {"kind": "manual_submission", "url": url, "ein": ein, "submitted_by": submitted_by,
                   "note": note, "submitted_at": _now().isoformat(), "count": 1}
        rfid, _ = register_manifest(conn, "add", payload, source_url=url)
        run = ledger.start_run(conn, rfid, DATASET_MANIFESTS)
        try:
            with conn.cursor() as cur:
                org_id = org_id_by_ein(cur, ein) if ein else None
                sid = _insert_candidate(cur, url=url, source_id=None, publisher=None,
                                        submitted_by=submitted_by, note=note, rfid=rfid)
                linked = False
                if sid is None:
                    cur.execute("select id from internal.funder_signals where url = %s",
                                (fx.canonical_url(url),))
                    sid = int(cur.fetchone()[0])
                if org_id:
                    linked = link_org(cur, sid, org_id, "subject", "ein", 1.0)
            conn.commit()
            ledger.complete_run(conn, run, inserted=1 if sid else 0)
            return {"signal_id": sid, "org_id": org_id, "linked": linked,
                    "ein_resolved": bool(org_id) if ein else None}
        except Exception as exc:
            conn.rollback()
            ledger.fail_run(conn, run, f"{type(exc).__name__}: {exc}")
            raise


def add_urls_from_csv(csv_path: Path = URLS_CSV) -> dict[str, int]:
    counts = {"inserted": 0, "existing": 0, "linked": 0, "unresolved_ein": 0}
    with connect() as conn:
        staged = staging.stage_local(DATASET_MANIFESTS, csv_path)
        rfid = staging.register_raw_file(conn, staged, license_code="cc_by", content_type="text/csv",
                                         meta={"curated_by": "Morton Labs", "kind": "signal_urls"})
        conn.commit()
        run = ledger.start_run(conn, rfid, DATASET_MANIFESTS)
        try:
            with csv_path.open(encoding="utf-8") as fh, conn.cursor() as cur:
                for row in csv.DictReader(fh):
                    ein = normalize_ein(row.get("org_ein") or "")
                    org_id = org_id_by_ein(cur, ein) if ein else None
                    if ein and not org_id:
                        counts["unresolved_ein"] += 1
                    sid = _insert_candidate(cur, url=row["url"], source_id=None, publisher=None,
                                            submitted_by=(row.get("submitted_by") or "seed:signal_urls.csv"),
                                            note=row.get("discovery_note") or None, rfid=rfid)
                    if sid is None:
                        counts["existing"] += 1
                        cur.execute("select id from internal.funder_signals where url = %s",
                                    (fx.canonical_url(row["url"]),))
                        sid = int(cur.fetchone()[0])
                    else:
                        counts["inserted"] += 1
                    if org_id and link_org(cur, sid, org_id, "subject", "ein", 1.0):
                        counts["linked"] += 1
            conn.commit()
            ledger.complete_run(conn, run, inserted=counts["inserted"], skipped=counts["existing"])
        except Exception as exc:
            conn.rollback()
            ledger.fail_run(conn, run, f"{type(exc).__name__}: {exc}")
            raise
    return counts


# ---------------------------------------------------------------------------
# 3. poll — every due source yields new candidates
# ---------------------------------------------------------------------------
@dataclass
class SourceRow:
    id: int
    slug: str
    publisher: str
    org_id: str | None
    source_kind: str
    url: str
    link_pattern: str | None
    last_etag: str | None
    last_modified: str | None


def _due_sources(cur, slug: str | None, force: bool) -> list[SourceRow]:
    cur.execute(
        """select id, slug, publisher, org_id, source_kind, url, link_pattern, last_etag, last_modified
           from internal.signal_sources
           where enabled and source_kind <> 'manual'
             and (%s::text is null or slug = %s)
             and (%s or last_fetched_at is null
                  or last_fetched_at < now() - make_interval(hours => fetch_interval_hours))
           order by slug""",
        (slug, slug, force),
    )
    return [SourceRow(r[0], r[1], r[2], str(r[3]) if r[3] else None, r[4], r[5], r[6], r[7], r[8])
            for r in cur.fetchall()]


def poll(slug: str | None = None, *, dry_run: bool = False, force: bool = False,
         max_items: int = 50) -> dict[str, int]:
    counts = {"sources": 0, "fetched": 0, "unchanged": 0, "errors": 0, "discovered": 0,
              "inserted": 0}
    ua = _user_agent()
    with connect() as conn, fx.make_client(ua) as client:
        with conn.cursor() as cur:
            sources = _due_sources(cur, slug, force)
        counts["sources"] = len(sources)
        if not sources:
            return counts
        discovered: dict[int, list[dict]] = {}
        for src in sources:
            try:
                if not fx.robots_allowed(src.url, ua, client=client):
                    raise PermissionError("robots.txt disallows this URL")
                result = fx.fetch(src.url, client=client, etag=src.last_etag,
                                  last_modified=src.last_modified)
                if result.status_code == 304:
                    counts["unchanged"] += 1
                    items: list[fx.FeedItem] = []
                elif result.status_code >= 400:
                    raise RuntimeError(f"HTTP {result.status_code}")
                elif src.source_kind in ("rss", "atom"):
                    items = fx.parse_feed(result.body)
                else:
                    items = [fx.FeedItem(u, None, None)
                             for u in fx.discover_links(result.text, result.final_url, src.link_pattern)]
                items = items[:max_items]
                counts["fetched"] += 1
                counts["discovered"] += len(items)
                discovered[src.id] = [{"url": fx.canonical_url(i.url), "title": i.title,
                                       "published": i.published.isoformat() if i.published else None}
                                      for i in items]
                if not dry_run:
                    with conn.cursor() as cur:
                        cur.execute(
                            """update internal.signal_sources
                               set last_fetched_at = now(), last_status = %s, last_etag = %s,
                                   last_modified = %s, last_error = null where id = %s""",
                            (result.status_code, result.headers.get("etag"),
                             result.headers.get("last-modified"), src.id),
                        )
                    conn.commit()
                print(f"  {src.slug}: HTTP {result.status_code}, {len(items)} link(s)")
            except Exception as exc:  # one bad source must not stop the run
                counts["errors"] += 1
                print(f"  ! {src.slug}: {type(exc).__name__}: {exc}")
                if not dry_run:
                    with conn.cursor() as cur:
                        cur.execute(
                            """update internal.signal_sources
                               set last_fetched_at = now(), last_error = %s where id = %s""",
                            (f"{type(exc).__name__}: {exc}"[:500], src.id),
                        )
                    conn.commit()
        if dry_run:
            for sid, items in discovered.items():
                for it in items[:10]:
                    print(f"    {it['url']}")
            return counts

        total = sum(len(v) for v in discovered.values())
        if total == 0:
            return counts
        rfid, _ = register_manifest(conn, "poll", {
            "kind": "poll", "count": total, "polled_at": _now().isoformat(),
            "sources": {str(k): v for k, v in discovered.items()},
        })
        run = ledger.start_run(conn, rfid, DATASET_MANIFESTS)
        try:
            with conn.cursor() as cur:
                by_id = {s.id: s for s in sources}
                for sid, items in discovered.items():
                    src = by_id[sid]
                    for it in items:
                        new_id = _insert_candidate(
                            cur, url=it["url"], source_id=src.id, publisher=src.publisher,
                            submitted_by=f"feed:{src.slug}", note=None, rfid=rfid,
                            headline=it["title"], published_at=it["published"])
                        if new_id:
                            counts["inserted"] += 1
                            if src.org_id:
                                link_org(cur, new_id, src.org_id, "subject", "source_feed", 1.0)
            conn.commit()
            ledger.complete_run(conn, run, inserted=counts["inserted"],
                                skipped=total - counts["inserted"])
        except Exception as exc:
            conn.rollback()
            ledger.fail_run(conn, run, f"{type(exc).__name__}: {exc}")
            raise
    return counts


# ---------------------------------------------------------------------------
# 4. process — fetch, snapshot, classify, link
# ---------------------------------------------------------------------------
def process(limit: int = 20, *, dry_run: bool = False, auto_publish: bool = False,
            min_confidence: float = 0.85, signal_id: int | None = None) -> dict[str, int]:
    counts = {"processed": 0, "published": 0, "triaged_out": 0, "errors": 0, "evidence_violations": 0}
    ua = _user_agent()
    mode, model, api_key = _ai_mode(), _model(), _api_key()
    if mode != "mock" and not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set. Set it in .env, or SIGNALS_AI_MODE=mock "
                           "for the token-free keyword classifier.")
    with connect() as conn, fx.make_client(ua) as client:
        with conn.cursor() as cur:
            cur.execute(
                """select s.id, s.url, s.publisher, s.submitted_by, s.discovery_note,
                          src.org_id, src.publisher
                   from internal.funder_signals s
                   left join internal.signal_sources src on src.id = s.source_id
                   where s.status = 'candidate' and s.extracted_at is null
                     and (%s::bigint is null or s.id = %s)
                   order by s.id limit %s""",
                (signal_id, signal_id, limit),
            )
            todo = cur.fetchall()
        if not todo:
            return counts
        decisions: list[dict] = []
        rfid = None
        run = None
        if not dry_run:
            rfid, _ = register_manifest(conn, "process", {
                "kind": "process", "count": len(todo), "model": model if mode != "mock" else "mock",
                "started_at": _now().isoformat(),
                "ids": [int(r[0]) for r in todo]})
            run = ledger.start_run(conn, rfid, DATASET_MANIFESTS)
        for (sid, url, publisher, submitted_by, note, src_org_id, src_publisher) in todo:
            publisher_hint = publisher or src_publisher
            try:
                if not fx.robots_allowed(url, ua, client=client):
                    raise PermissionError("robots.txt disallows this URL")
                result = fx.fetch(url, client=client)
                if result.status_code >= 400:
                    raise RuntimeError(f"HTTP {result.status_code}")
                article = fx.extract_article(result.text, result.final_url)
                out = clf.classify(article, publisher_hint, mode=mode, model=model, api_key=api_key)
                c = out.classification
                counts["evidence_violations"] += len(out.violations)
                headline = c.headline or article.title
                published = clf.parse_iso_date(c.published_at) or article.published_at
                triage_out = (not c.is_funding_signal) or c.relevance == "none"
                publish_now = (auto_publish and not triage_out and c.relevance in ("high", "medium")
                               and c.confidence >= min_confidence and mode != "mock")
                decisions.append({"id": sid, "url": url, "headline": headline,
                                  "signal_type": c.signal_type, "amount_usd": c.amount_usd,
                                  "relevance": c.relevance, "confidence": c.confidence,
                                  "triaged_out": triage_out, "published": publish_now,
                                  "violations": out.violations})
                label = "triage-out" if triage_out else ("PUBLISH" if publish_now else "candidate")
                print(f"  #{sid} {label} {c.signal_type} conf={c.confidence:.2f} "
                      f"amount={c.amount_usd} {headline!r:.70}")
                if dry_run:
                    counts["processed"] += 1
                    continue
                with conn.cursor() as cur:
                    snap_id = register_snapshot(conn, result, article)
                    raw_source = {
                        "evidence": {e.field: e.excerpt for e in c.evidence},
                        "violations": out.violations,
                        "mentioned_orgs": c.mentioned_orgs,
                        "http": {"status": result.status_code, "final_url": result.final_url,
                                 "fetched_at": result.fetched_at.isoformat()},
                        "date_evidence": article.date_evidence,
                        "usage": out.usage,
                        "mode": mode,
                    }
                    status = "rejected" if triage_out else ("published" if publish_now else "candidate")
                    reviewed_by = f"model:{out.model}" if status != "candidate" else None
                    cur.execute(
                        """update internal.funder_signals set
                             url = %s, publisher = coalesce(publisher, %s), headline = %s,
                             published_at = coalesce(%s, published_at),
                             signal_type = %s, amount_usd = %s, amount_kind = %s,
                             instruments = %s, eligible_recipients = %s, sectors = %s,
                             geographies = %s, horizon_end = %s, summary = %s, action_hint = %s,
                             relevance = %s, extraction_model = %s, extraction_confidence = %s,
                             extracted_at = now(), status = %s,
                             reviewed_by = %s, reviewed_at = case when %s is null then null else now() end,
                             notes = case when %s then 'model triage: not a funding signal' else notes end,
                             raw_source = %s, raw_file_id = %s, snapshot_raw_file_id = %s,
                             source_record_locator = %s
                           where id = %s""",
                        (fx.canonical_url(result.final_url) if fx.same_host(result.final_url, url) else url,
                         publisher_hint, headline, published,
                         c.signal_type, c.amount_usd, c.amount_kind,
                         c.instruments, c.eligible_recipients, c.sectors,
                         c.geographies, clf.parse_iso_date(c.horizon_end), c.summary, c.action_hint,
                         c.relevance, out.model, max(min(c.confidence, 1.0), 0.01), status,
                         reviewed_by, reviewed_by, triage_out,
                         json.dumps(raw_source), rfid, snap_id,
                         f"url:{fx.canonical_url(url)}", sid),
                    )
                    if src_org_id:
                        link_org(cur, sid, str(src_org_id), "subject", "source_feed", 1.0)
                    for name in c.mentioned_orgs[:10]:
                        oid = org_id_by_exact_name(cur, name)
                        if oid and oid != (str(src_org_id) if src_org_id else None):
                            link_org(cur, sid, oid, "partner", "model", 0.6)
                conn.commit()
                counts["processed"] += 1
                counts["published"] += int(publish_now)
                counts["triaged_out"] += int(triage_out)
            except psycopg.errors.UniqueViolation as exc:
                # the final URL after redirects is already a row: keep the other, drop this one
                conn.rollback()
                counts["errors"] += 1
                print(f"  ! #{sid}: duplicate after redirect ({exc.diag.constraint_name}); "
                      f"leaving as candidate")
            except Exception as exc:
                conn.rollback()
                counts["errors"] += 1
                print(f"  ! #{sid}: {type(exc).__name__}: {exc}")
                if not dry_run:
                    with conn.cursor() as cur:
                        cur.execute(
                            """update internal.funder_signals
                               set notes = left(coalesce(notes || ' | ', '') || %s, 2000)
                               where id = %s""",
                            (f"process error {_now():%Y-%m-%d}: {type(exc).__name__}: {exc}", sid),
                        )
                    conn.commit()
        if run is not None:
            ledger.complete_run(conn, run, inserted=0, updated=counts["processed"],
                                skipped=counts["errors"],
                                notes=json.dumps({"published": counts["published"],
                                                  "triaged_out": counts["triaged_out"]}))
    return counts


# ---------------------------------------------------------------------------
# 5. publish / reject — the human decision
# ---------------------------------------------------------------------------
def set_status(ids: list[int], status: str, *, reviewed_by: str, note: str | None = None) -> int:
    assert status in ("published", "rejected", "candidate")
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """update internal.funder_signals
               set status = %s, reviewed_by = %s, reviewed_at = now(),
                   notes = coalesce(%s, notes)
               where id = any(%s) and status <> 'superseded'
                 and (%s <> 'published' or extracted_at is not null)""",
            (status, reviewed_by, note, ids, status),
        )
        n = cur.rowcount
        conn.commit()
    return n


def publish_confident(min_confidence: float, *, reviewed_by: str) -> int:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """update internal.funder_signals
               set status = 'published', reviewed_by = %s, reviewed_at = now()
               where status = 'candidate' and extracted_at is not null
                 and relevance in ('high','medium') and extraction_confidence >= %s
                 and extraction_model <> 'mock'
                 and exists (select 1 from internal.funder_signal_orgs so where so.signal_id = funder_signals.id)""",
            (reviewed_by, min_confidence),
        )
        n = cur.rowcount
        conn.commit()
    return n


# ---------------------------------------------------------------------------
# 6. status
# ---------------------------------------------------------------------------
def status() -> dict:
    with connect() as conn, conn.cursor() as cur:
        cur.execute("select status, count(*) from internal.funder_signals group by status order by 1")
        by_status = dict(cur.fetchall())
        cur.execute("""select count(*), count(*) filter (where enabled),
                              count(*) filter (where last_error is not null)
                       from internal.signal_sources""")
        srcs = cur.fetchone()
        cur.execute("""select count(*) from internal.funder_signals
                       where status = 'candidate' and extracted_at is null""")
        unprocessed = cur.fetchone()[0]
        cur.execute("""select dataset_name, status, started_at, rows_inserted, rows_updated, notes
                       from internal.ingestion_ledger
                       where dataset_name in (%s, %s) order by id desc limit 8""",
                    (DATASET_MANIFESTS, DATASET_SNAPSHOTS))
        runs = [{"dataset": r[0], "status": r[1], "started_at": r[2].isoformat(),
                 "inserted": r[3], "updated": r[4], "notes": r[5]} for r in cur.fetchall()]
    return {"by_status": {k: int(v) for k, v in by_status.items()},
            "sources": {"total": srcs[0], "enabled": srcs[1], "with_error": srcs[2]},
            "unprocessed_candidates": int(unprocessed), "recent_runs": runs}
