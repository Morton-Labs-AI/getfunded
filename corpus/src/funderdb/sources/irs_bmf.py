"""IRS Exempt Organizations Business Master File (EO BMF) ingest.

Source: https://www.irs.gov/pub/irs-soi/eo{1..4}.csv (~250MB, ~1.98M rows,
refreshed roughly monthly). Docs: https://www.irs.gov/pub/foia/ig/tege/eo-info.pdf

Phase-1 subset: private foundations only — FOUNDATION code in ('02','03','04')
(exempt-operating, private-operating, private-non-operating): ~135k orgs.

Parsing conventions (FIELD_ALIASES, EIN zfill, ruling-date forms) ported from
the April 2026 attempt's eo_bmf.py; retargeted at the org_identifiers crosswalk
instead of an EIN-keyed table, and keeps STREET/ZIP/ASSET_AMT/INCOME_AMT/
REVENUE_AMT (which the prior importer dropped).
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterator, TextIO

from .. import ledger, staging
from ..db import connect
from ..normalize import normalize_ein, normalize_name, parse_amount, parse_ruling_date

REGION_FILES = ("eo1.csv", "eo2.csv", "eo3.csv", "eo4.csv")
BASE_URL = "https://www.irs.gov/pub/irs-soi/"
DATASET = "irs_eo_bmf"
# The IRS republishes eo{1..4}.csv under the SAME name roughly monthly, so the
# URL is a mutable feed: a staged copy is reused for this long, then checked
# upstream (conditional request) before being reused again.
MAX_AGE = timedelta(days=30)
FOUNDATION_CODES = frozenset({"02", "03", "04"})

# Header aliases seen across BMF vintages (from the April importer, extended).
FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "ein": ("EIN",),
    "name": ("NAME",),
    "street": ("STREET",),
    "city": ("CITY",),
    "state": ("STATE",),
    "zip": ("ZIP",),
    "subsection": ("SUBSECTION",),
    "foundation": ("FOUNDATION",),
    "ruling": ("RULING",),
    "ntee": ("NTEE_CD", "NTEE_CODE", "NTEE"),
    "asset_amt": ("ASSET_AMT",),
    "income_amt": ("INCOME_AMT",),
    "revenue_amt": ("REVENUE_AMT",),
}


@dataclass(frozen=True)
class BmfRecord:
    ein: str
    name: str
    name_normalized: str
    org_type: str
    street: str | None
    city: str | None
    state: str | None
    zip: str | None
    subsection: str | None
    foundation: str
    ruling_date: date | None
    ntee: str | None
    asset_amt: int | None
    income_amt: int | None
    revenue_amt: int | None
    raw: dict[str, str]


def _resolve_headers(fieldnames: list[str]) -> dict[str, str]:
    resolved: dict[str, str] = {}
    upper = {f.upper().strip(): f for f in fieldnames}
    for key, aliases in FIELD_ALIASES.items():
        for alias in aliases:
            if alias in upper:
                resolved[key] = upper[alias]
                break
        else:
            if key in ("ein", "name", "foundation"):
                raise ValueError(f"BMF header missing required column {key!r}: {fieldnames}")
    return resolved


def parse_foundations(fh: TextIO, all_orgs: bool = False) -> Iterator[BmfRecord]:
    """Yield BMF org records. Default: private foundations only (codes
    02/03/04). all_orgs=True: the full exempt-org spine — every other code
    lands as org_type='public_charity' (the Phase-2 recipient-resolution
    universe; the simplification is documented in /data known limits)."""
    reader = csv.DictReader(fh)
    assert reader.fieldnames is not None
    headers = _resolve_headers(list(reader.fieldnames))

    def get(row: dict[str, str], key: str) -> str:
        col = headers.get(key)
        return (row.get(col) or "").strip() if col else ""

    for row in reader:
        foundation = get(row, "foundation").zfill(2)
        is_pf = foundation in FOUNDATION_CODES
        if not is_pf and not all_orgs:
            continue
        ein = normalize_ein(get(row, "ein"))
        name = get(row, "name")
        if not ein or not name:
            continue
        yield BmfRecord(
            ein=ein,
            name=name,
            name_normalized=normalize_name(name),
            org_type="private_foundation" if is_pf else "public_charity",
            street=get(row, "street") or None,
            city=get(row, "city") or None,
            state=get(row, "state") or None,
            zip=get(row, "zip") or None,
            subsection=get(row, "subsection") or None,
            foundation=foundation,
            ruling_date=parse_ruling_date(get(row, "ruling")),
            ntee=get(row, "ntee") or None,
            asset_amt=parse_amount(get(row, "asset_amt")),
            income_amt=parse_amount(get(row, "income_amt")),
            revenue_amt=parse_amount(get(row, "revenue_amt")),
            raw={k: v for k, v in row.items() if v},
        )


_STAGE_DDL = """
create temp table _bmf_stage (
  ein         text primary key,
  name        text not null,
  name_norm   text not null,
  org_type    text not null,
  street      text,
  city        text,
  state       text,
  zip         text,
  subsection  text,
  foundation  text not null,
  ruling_date date,
  ntee        text,
  asset_amt   bigint,
  income_amt  bigint,
  revenue_amt bigint,
  raw         jsonb
) on commit drop
"""

_UPDATE_SQL = """
update internal.organizations o
set name = s.name,
    name_normalized = s.name_norm,
    -- BMF may promote an org to private_foundation, but must never demote one
    -- that has 990-PF grant evidence on file: the BMF FOUNDATION column is
    -- current legal status, while a filed 990-PF is behavioral proof of
    -- grantmaking, and this product ranks funders by what they actually fund.
    -- (Measured 2026-07-26: the naive overwrite reclassified 5,114 real
    -- grantmakers and orphaned 4,651 semantic foundation docs.)
    org_type = case
      when o.org_type = 'private_foundation'
       and s.org_type = 'public_charity'
       and exists (select 1 from internal.funding_events fe
                   where fe.funder_org_id = o.id and fe.event_type = 'grant')
      then o.org_type else s.org_type end,
    street = s.street, city = s.city, state = s.state, zip = s.zip,
    ntee_code = s.ntee, subsection_code = s.subsection, foundation_code = s.foundation,
    ruling_date = s.ruling_date,
    asset_amount = s.asset_amt, income_amount = s.income_amt, revenue_amount = s.revenue_amt,
    raw_file_id = %(rfid)s,
    source_record_locator = 'row:EIN=' || s.ein,
    raw_source = s.raw,
    last_verified_at = %(verified_at)s
from _bmf_stage s
join internal.org_identifiers oi on oi.id_type = 'ein' and oi.id_value = s.ein
where o.id = oi.org_id
"""

_INSERT_SQL = """
with new_rows as (
  select s.* from _bmf_stage s
  where not exists (
    select 1 from internal.org_identifiers oi
    where oi.id_type = 'ein' and oi.id_value = s.ein)
), ins as (
  insert into internal.organizations
    (name, name_normalized, org_type, street, city, state, zip,
     ntee_code, subsection_code, foundation_code, ruling_date,
     asset_amount, income_amount, revenue_amount,
     raw_file_id, source_record_locator, raw_source, last_verified_at)
  select name, name_norm, org_type, street, city, state, zip,
         ntee, subsection, foundation, ruling_date,
         asset_amt, income_amt, revenue_amt,
         %(rfid)s, 'row:EIN=' || ein, raw, %(verified_at)s
  from new_rows
  returning id, source_record_locator
)
insert into internal.org_identifiers (org_id, id_type, id_value, raw_file_id, source_record_locator)
select id, 'ein', substring(source_record_locator from 9), %(rfid)s, source_record_locator
from ins
"""

_STAGE_COLUMNS = (
    "ein", "name", "name_norm", "org_type", "street", "city", "state", "zip",
    "subsection", "foundation", "ruling_date", "ntee", "asset_amt", "income_amt",
    "revenue_amt", "raw",
)


def stage_files(files: tuple[str, ...] = REGION_FILES,
                refresh: bool = False) -> list[staging.StagedFile]:
    return [stage_one(name, refresh=refresh) for name in files]


def stage_one(name: str, refresh: bool = False) -> staging.StagedFile:
    return staging.stage_download(DATASET, BASE_URL + name, mutable=True,
                                  refresh=refresh, max_age=MAX_AGE)


def dry_run(files: tuple[str, ...] = REGION_FILES, limit: int | None = None) -> dict[str, int]:
    """Parse locally without a database: per-file foundation counts."""
    counts: dict[str, int] = {}
    for fname in files:
        staged = stage_one(fname)
        n = 0
        with staged.path.open(encoding="utf-8", errors="replace") as fh:
            for _ in parse_foundations(fh):
                n += 1
                if limit and n >= limit:
                    break
        counts[fname] = n
    return counts


def ingest(
    files: tuple[str, ...] = REGION_FILES,
    as_of: date | None = None,
    all_orgs: bool = False,
    refresh: bool = False,
) -> dict[str, dict]:
    """Stage, register, and load each region file (one transaction per file).

    ``last_verified_at`` is stamped with the staged file's vintage (server
    Last-Modified, else our fetch time) — never with now(), so re-ingesting
    an old snapshot cannot make rows look freshly verified.
    """
    results: dict[str, dict] = {}
    with connect() as conn:
        for fname in files:
            staged = stage_one(fname, refresh=refresh)
            raw_file_id = staging.register_raw_file(
                conn, staged, license_code="us_public_domain",
                as_of_date=as_of or staged.vintage_date, content_type="text/csv",
            )
            verified_at = staging.verified_at(staged)
            conn.commit()
            run_id = ledger.start_run(conn, raw_file_id, DATASET)
            try:
                seen: set[str] = set()
                skipped = 0
                with conn.cursor() as cur:
                    cur.execute("set local statement_timeout = '30min'")
                    cur.execute(_STAGE_DDL)
                    with cur.copy(
                        f"copy _bmf_stage ({', '.join(_STAGE_COLUMNS)}) from stdin"
                    ) as copy:
                        with staged.path.open(encoding="utf-8", errors="replace") as fh:
                            for rec in parse_foundations(fh, all_orgs=all_orgs):
                                if rec.ein in seen:
                                    skipped += 1
                                    continue
                                seen.add(rec.ein)
                                # raw_source deliberately NULL: at 135k rows the
                                # duplicated CSV dict cost ~150MB of heap (measured
                                # 2026-07-25); locator + staged hashed file is the
                                # provenance, same policy as funding_events.
                                copy.write_row((
                                    rec.ein, rec.name, rec.name_normalized,
                                    rec.org_type, rec.street,
                                    rec.city, rec.state, rec.zip, rec.subsection,
                                    rec.foundation, rec.ruling_date, rec.ntee,
                                    rec.asset_amt, rec.income_amt, rec.revenue_amt,
                                    None,
                                ))
                    params = {"rfid": raw_file_id, "verified_at": verified_at}
                    cur.execute(_UPDATE_SQL, params)
                    updated = cur.rowcount
                    cur.execute(_INSERT_SQL, params)
                    inserted = cur.rowcount
                conn.commit()
                ledger.complete_run(
                    conn, run_id, inserted=inserted, updated=updated, skipped=skipped,
                    notes=f"{fname}: {len(seen)} foundation rows parsed "
                          f"(vintage {staged.vintage_date}, "
                          f"{'cached' if staged.from_cache else 'fetched'})",
                )
                results[fname] = {"inserted": inserted, "updated": updated, "skipped": skipped,
                                  "vintage": str(staged.vintage_date),
                                  "from_cache": staged.from_cache}
            except Exception as exc:
                # The connection may already be dead; never let cleanup mask
                # the original error.
                try:
                    conn.rollback()
                    ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                except Exception:
                    pass
                raise
    return results
