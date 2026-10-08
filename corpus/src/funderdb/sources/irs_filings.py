"""IRS filings spine — every indexed 990/990-PF e-filed return, zip-free.

Migration 0013 promoted internal.processed_filings to internal.filings. This
module owns two things:

1. The spine load: the annual index CSVs alone carry object_id, EIN, return
   type, tax period, DLN, SUB_DATE, batch id, and taxpayer name — enough to
   register every filing's existence without touching a single batch zip.
   Rows the grants pass already saw get their index metadata backfilled;
   never-seen rows are inserted with both idempotency markers NULL.

2. reconcile(): amended-return supersession. Within (ein, return_type,
   tax_period) the greatest object_id wins — SUB_DATE is unusable for ordering
   (year-only in 2022+ indexes, garbage timestamps in 2021), and object_ids
   are fixed-width 18-digit strings whose prefix is the IRS processing date,
   so text max() == latest. Losers get superseded_by_object_id; their
   funding_events rows are DELETED (they feed every aggregate surface — MVs,
   benchmarks, profiles — and a filter-everywhere approach leaks). Their
   filing_financials/officers/contributors rows are KEPT: the original return
   stays viewable, ProPublica-style. Deleted grant rows are recoverable at any
   time by re-parsing the staged zips.

Spine scope: 990PF + 990 only. 990 matters even before charity financials
land because Schedule I grants come from 990 filings and need the same
supersession. 990-EZ/990-T are recorded absences (see README known limits).

The 2017-2020 indexes write two of those forms under other codes ('990PR'
for some 990-PFs, '990O' for Form 990s from non-501(c)(3) filers). The spine
stores the canonical form, so supersession groups line up across years.
"""

from __future__ import annotations

import csv
from collections import defaultdict

import psycopg

from .. import ledger, staging
from ..db import connect
from ..normalize import normalize_ein
from .irs_990pf import DATASET, canonical_return_type, stage_index

RETURN_TYPES = ("990PF", "990")

_SPINE_STAGE_DDL = """
create temp table _filings_idx (
  object_id     text primary key,
  ein           text not null,
  return_type   text not null,
  tax_period    text,
  taxpayer_name text,
  dln           text,
  sub_date      text,
  batch_id      text
) on commit drop
"""

# Upsert: insert never-seen filings; backfill index metadata onto rows the
# grants pass created before 0013. raw_file_id is NOT overwritten on existing
# rows — a batch-zip pointer is more specific provenance than the index CSV.
_SPINE_UPSERT = """
with up as (
  insert into internal.filings as f
    (object_id, ein, return_type, tax_period, dln, sub_date, xml_batch_id,
     taxpayer_name, tax_period_end, raw_file_id)
  select s.object_id, s.ein, s.return_type, s.tax_period, s.dln, s.sub_date,
         s.batch_id, s.taxpayer_name,
         case when s.tax_period ~ '^\\d{6}$'
              then (to_date(s.tax_period || '01', 'YYYYMMDD')
                    + interval '1 month' - interval '1 day')::date end,
         %(rfid)s
  from _filings_idx s
  on conflict (object_id) do update set
    dln            = coalesce(f.dln, excluded.dln),
    sub_date       = coalesce(f.sub_date, excluded.sub_date),
    xml_batch_id   = coalesce(f.xml_batch_id, excluded.xml_batch_id),
    taxpayer_name  = coalesce(f.taxpayer_name, excluded.taxpayer_name),
    tax_period     = coalesce(nullif(f.tax_period, ''), excluded.tax_period),
    tax_period_end = coalesce(f.tax_period_end, excluded.tax_period_end)
  where f.dln is null or f.tax_period_end is null or f.xml_batch_id is null
     or f.taxpayer_name is null or f.sub_date is null
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted), count(*) filter (where not inserted)
from up
"""


def load_spine_rows(year: int, refresh: bool = False) -> tuple[staging.StagedFile, list[tuple]]:
    """Index rows for both return types in one CSV pass, deduped on object_id."""
    staged = stage_index(year, refresh=refresh)
    rows: dict[str, tuple] = {}
    with staged.path.open(encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            rt = canonical_return_type(row.get("RETURN_TYPE"))
            if rt not in RETURN_TYPES:
                continue
            ein = normalize_ein(row.get("EIN") or "")
            oid = (row.get("OBJECT_ID") or "").strip()
            if not ein or not oid:
                continue
            rows[oid] = (
                oid, ein, rt,
                (row.get("TAX_PERIOD") or "").strip(),
                (row.get("TAXPAYER_NAME") or "").strip() or None,
                (row.get("DLN") or "").strip() or None,
                (row.get("SUB_DATE") or "").strip() or None,
                (row.get("XML_BATCH_ID") or "").strip() or None,
            )
    return staged, list(rows.values())


def upsert_spine_rows(cur, rows: list[tuple], raw_file_id: int) -> tuple[int, int]:
    """Upsert spine rows inside the caller's transaction; returns
    ``(inserted, updated)``.

    ``rows`` are ``(object_id, ein, return_type, tax_period, taxpayer_name,
    dln, sub_date, batch_id)``. They normally come from an index CSV
    (load_spine_rows); the backfill also passes rows read from the XML header
    of returns that are in a zip but in no index, with the zip as raw file."""
    cur.execute(_SPINE_STAGE_DDL)
    with cur.copy(
        "copy _filings_idx (object_id, ein, return_type, tax_period,"
        " taxpayer_name, dln, sub_date, batch_id) from stdin"
    ) as copy:
        for r in rows:
            copy.write_row(r)
    cur.execute("analyze _filings_idx")
    cur.execute(_SPINE_UPSERT, {"rfid": raw_file_id})
    inserted, updated = cur.fetchone()
    return inserted, updated


def load_spine_year(conn: psycopg.Connection, year: int, refresh: bool = False) -> dict:
    """Load one index year into the spine: stage and register the index CSV,
    upsert its rows, record a ledger run. No supersession sweep — the caller
    runs reconcile() when it has finished loading."""
    staged, rows = load_spine_rows(year, refresh=refresh)
    raw_file_id = staging.register_raw_file(
        conn, staged, license_code="us_public_domain",
        content_type="text/csv",
    )
    conn.commit()
    run_id = ledger.start_run(conn, raw_file_id, DATASET)
    try:
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '30min'")
            inserted, updated = upsert_spine_rows(cur, rows, raw_file_id)
        conn.commit()
        ledger.complete_run(
            conn, run_id, inserted=inserted, updated=updated,
            notes=f"filings spine {year}: {len(rows)} index rows "
                  f"(990PF+990); +{inserted} / ~{updated}",
        )
        print(f"{year}: index_rows={len(rows):,} "
              f"inserted={inserted:,} updated={updated:,}", flush=True)
    except Exception as exc:
        try:
            conn.rollback()
            ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
        except Exception:
            pass
        raise
    return {"indexed": len(rows), "inserted": inserted, "updated": updated,
            "raw_file_id": raw_file_id}


def ingest(years: tuple[int, ...] = (2021, 2022, 2023, 2024, 2025, 2026),
           refresh: bool = False) -> dict:
    totals: dict[str, int] = defaultdict(int)
    with connect() as conn:
        for year in years:
            r = load_spine_year(conn, year, refresh=refresh)
            totals[f"indexed_{year}"] = r["indexed"]
            totals["spine_inserted"] += r["inserted"]
            totals["spine_updated"] += r["updated"]
        for k, v in reconcile(conn).items():
            totals[k] = v
    return dict(totals)


# Scope filter for reconcile(): only the (ein, return_type, tax_period) groups
# that hold at least one filing registered under the given raw files. The
# whole group is still compared, so an amendment that arrived in another year
# or another zip wins or loses exactly as in the unscoped sweep.
_SCOPE_GROUPS = """
              and (ein, return_type, tax_period) in (
                select s.ein, s.return_type, s.tax_period
                from internal.filings s
                where s.raw_file_id = any(%(scope)s::bigint[]))"""


def reconcile(conn: psycopg.Connection, *,
              scope_raw_file_ids: list[int] | None = None,
              refresh_stats: bool = True) -> dict:
    """Supersession sweep. Idempotent; runs at the tail of every 990 ingest.

    Each step commits separately — the org_id backfill alone touches up to
    2.5M rows on first run, and small transactions keep WAL spikes inside
    what Supabase disk autoscaling absorbs (learned the hard way, see
    irs_990pf._load_batch).

    ``scope_raw_file_ids`` limits the sweep to the supersession groups touched
    by filings registered under those raw files (an index CSV and its zips).
    The backfill uses it to sweep one year at a time. ``refresh_stats=False``
    leaves out the materialized-view refresh and the full-table linked-grant
    count, so a caller can do that expensive step once at the very end.
    The defaults are the original behaviour: everything, then refresh.
    """
    counts: dict[str, int] = {}
    scoped = scope_raw_file_ids is not None
    params = {"scope": list(scope_raw_file_ids)} if scoped else None
    groups = _SCOPE_GROUPS if scoped else ""

    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        # Winner = max(object_id) per (ein, return_type, tax_period).
        # Also repairs stale pointers if a later index reveals a newer winner.
        cur.execute(f"""
            with w as (
              select ein, return_type, tax_period, max(object_id) as winner
              from internal.filings
              where coalesce(tax_period, '') <> ''{groups}
              group by 1, 2, 3
              having count(*) > 1
            )
            update internal.filings f
            set superseded_by_object_id =
                  case when f.object_id = w.winner then null else w.winner end
            from w
            where f.ein = w.ein and f.return_type = w.return_type
              and f.tax_period = w.tax_period
              and f.superseded_by_object_id is distinct from
                  case when f.object_id = w.winner then null else w.winner end
        """, params)
        counts["supersession_pointer_updates"] = cur.rowcount
        cur.execute(
            "select count(*) from internal.filings "
            "where superseded_by_object_id is not null")
        counts["superseded_filings_total"] = cur.fetchone()[0]
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        # Measure before deleting: the resolved count is the ER-floor guard
        # input (suite floor: 886,763 linked grant rows).
        cur.execute(f"""
            select count(*), count(*) filter (where recipient_org_id is not null)
            from internal.funding_events
            where split_part(source_record_key, ':', 2) in
                  (select object_id from internal.filings
                   where superseded_by_object_id is not null{groups})
        """, params)
        n_del, n_del_resolved = cur.fetchone()
        counts["superseded_events_found"] = n_del
        counts["superseded_events_resolved"] = n_del_resolved
        if n_del:
            cur.execute(f"""
                delete from internal.funding_events
                where split_part(source_record_key, ':', 2) in
                      (select object_id from internal.filings
                       where superseded_by_object_id is not null{groups})
            """, params)
            counts["superseded_events_deleted"] = cur.rowcount
    conn.commit()

    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute(f"""
            update internal.filings f
            set org_id = oi.org_id
            from internal.org_identifiers oi
            where f.org_id is null
              and oi.id_type = 'ein' and oi.id_value = f.ein
              {"and f.raw_file_id = any(%(scope)s::bigint[])" if scoped else ""}
        """, params)
        counts["org_id_backfilled"] = cur.rowcount
    conn.commit()

    if not refresh_stats:
        return counts

    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute("""
            select count(*) from internal.funding_events
            where event_type = 'grant' and recipient_org_id is not null
        """)
        counts["linked_grants_now"] = cur.fetchone()[0]
        cur.execute("select internal.refresh_dashboard_stats()")
    conn.commit()

    if counts.get("superseded_events_deleted") and counts["linked_grants_now"] < 886_763:
        print("WARNING: linked-grant count fell below the 886,763 suite floor — "
              "run `funderdb resolve recipients` before recording eval results.",
              flush=True)
    return counts
