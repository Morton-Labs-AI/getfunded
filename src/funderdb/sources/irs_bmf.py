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
import json
from dataclasses import dataclass
from datetime import date
from typing import Iterator, TextIO

from .. import ledger, staging
from ..db import connect
from ..normalize import normalize_ein, normalize_name, parse_amount, parse_ruling_date

REGION_FILES = ("eo1.csv", "eo2.csv", "eo3.csv", "eo4.csv")
BASE_URL = "https://www.irs.gov/pub/irs-soi/"
DATASET = "irs_eo_bmf"
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


def parse_foundations(fh: TextIO) -> Iterator[BmfRecord]:
    """Yield private-foundation records from one BMF region CSV."""
    reader = csv.DictReader(fh)
    assert reader.fieldnames is not None
    headers = _resolve_headers(list(reader.fieldnames))

    def get(row: dict[str, str], key: str) -> str:
        col = headers.get(key)
        return (row.get(col) or "").strip() if col else ""

    for row in reader:
        foundation = get(row, "foundation").zfill(2)
        if foundation not in FOUNDATION_CODES:
            continue
        ein = normalize_ein(get(row, "ein"))
        name = get(row, "name")
        if not ein or not name:
            continue
        yield BmfRecord(
            ein=ein,
            name=name,
            name_normalized=normalize_name(name),
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
    street = s.street, city = s.city, state = s.state, zip = s.zip,
    ntee_code = s.ntee, subsection_code = s.subsection, foundation_code = s.foundation,
    ruling_date = s.ruling_date,
    asset_amount = s.asset_amt, income_amount = s.income_amt, revenue_amount = s.revenue_amt,
    raw_file_id = %(rfid)s,
    source_record_locator = 'row:EIN=' || s.ein,
    raw_source = s.raw,
    last_verified_at = now()
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
  select name, name_norm, 'private_foundation', street, city, state, zip,
         ntee, subsection, foundation, ruling_date,
         asset_amt, income_amt, revenue_amt,
         %(rfid)s, 'row:EIN=' || ein, raw, now()
  from new_rows
  returning id, source_record_locator
)
insert into internal.org_identifiers (org_id, id_type, id_value, raw_file_id, source_record_locator)
select id, 'ein', substring(source_record_locator from 9), %(rfid)s, source_record_locator
from ins
"""

_STAGE_COLUMNS = (
    "ein", "name", "name_norm", "street", "city", "state", "zip", "subsection",
    "foundation", "ruling_date", "ntee", "asset_amt", "income_amt", "revenue_amt", "raw",
)


def stage_files(files: tuple[str, ...] = REGION_FILES) -> list[staging.StagedFile]:
    return [stage_one(name) for name in files]


def stage_one(name: str) -> staging.StagedFile:
    return staging.stage_download(DATASET, BASE_URL + name)


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


def ingest(files: tuple[str, ...] = REGION_FILES, as_of: date | None = None) -> dict[str, dict]:
    """Stage, register, and load each region file (one transaction per file)."""
    results: dict[str, dict] = {}
    with connect() as conn:
        for fname in files:
            staged = stage_one(fname)
            raw_file_id = staging.register_raw_file(
                conn, staged, license_code="us_public_domain",
                as_of_date=as_of, content_type="text/csv",
            )
            conn.commit()
            run_id = ledger.start_run(conn, raw_file_id, DATASET)
            try:
                seen: set[str] = set()
                skipped = 0
                with conn.cursor() as cur:
                    cur.execute(_STAGE_DDL)
                    with cur.copy(
                        f"copy _bmf_stage ({', '.join(_STAGE_COLUMNS)}) from stdin"
                    ) as copy:
                        with staged.path.open(encoding="utf-8", errors="replace") as fh:
                            for rec in parse_foundations(fh):
                                if rec.ein in seen:
                                    skipped += 1
                                    continue
                                seen.add(rec.ein)
                                # raw_source deliberately NULL: at 135k rows the
                                # duplicated CSV dict cost ~150MB of heap (measured
                                # 2026-07-25); locator + staged hashed file is the
                                # provenance, same policy as funding_events.
                                copy.write_row((
                                    rec.ein, rec.name, rec.name_normalized, rec.street,
                                    rec.city, rec.state, rec.zip, rec.subsection,
                                    rec.foundation, rec.ruling_date, rec.ntee,
                                    rec.asset_amt, rec.income_amt, rec.revenue_amt,
                                    None,
                                ))
                    cur.execute(_UPDATE_SQL, {"rfid": raw_file_id})
                    updated = cur.rowcount
                    cur.execute(_INSERT_SQL, {"rfid": raw_file_id})
                    inserted = cur.rowcount
                conn.commit()
                ledger.complete_run(
                    conn, run_id, inserted=inserted, updated=updated, skipped=skipped,
                    notes=f"{fname}: {len(seen)} foundation rows parsed",
                )
                results[fname] = {"inserted": inserted, "updated": updated, "skipped": skipped}
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
