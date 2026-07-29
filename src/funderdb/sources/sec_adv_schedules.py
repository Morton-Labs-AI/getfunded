"""SEC Form ADV monthly filing zips — Schedule A/B owners + Schedule D 7.B.1 funds.

Source: https://reports.adviserinfo.sec.gov/reports/foia/advFilingData/{YYYY}/
        ADV_Filing_Data_{start}_{end}.zip  (Jan 2025 -> present, ~190MB total,
        enumerated via reports_metadata.json).

Semantics: these are FILINGS in the window, not snapshots. Every registered
adviser files an annual amendment within 90 days of FYE, so Jan-2025->present
covers the active universe. Current state = the LATEST filing per CRD; we build
a cross-zip winner index (pass 1 over Base CSVs), then extract only winning
filings' Schedule A/B and 7B1 rows (pass 2).

Loads:
  - individual owners/execs -> people + owner_of/executive_of relationships
    (entity owners DE/FE are skipped in Phase 1 — counted, not silently dropped)
  - 7B1 private funds -> organizations(org_type='fund') + sec_private_fund_id
    identifiers + manages_fund edges + fund GAV as fund_size
  - adviser classification: ERA Item 2B1=Y or any VC-type fund -> org_type 'vc';
    else any PE-type fund -> 'pe'
  - adviser fund_size = sum of its funds' gross asset values
"""

from __future__ import annotations

import csv
import io
import json
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..normalize import normalize_crd, normalize_name, parse_amount, state_code

DATASET = "sec_form_adv_filings"

_OWNER_CODES = frozenset({"A", "B", "C", "D", "E"})  # >=5% ownership bands


def _parse_date(raw: str) -> datetime | None:
    raw = (raw or "").strip()
    for fmt in ("%m/%d/%Y %I:%M:%S %p", "%m/%d/%Y", "%Y-%m-%d", "%m/%d/%Y %H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _csv_members(zf: zipfile.ZipFile, prefix: str) -> list[str]:
    return [n for n in zf.namelist() if n.startswith(prefix)]


def _dict_rows(zf: zipfile.ZipFile, member: str):
    with zf.open(member) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="latin-1"))


@dataclass
class Winner:
    filing_id: str
    crd: str
    date: datetime
    zip_path: Path
    is_era: bool
    era_2b1: str | None


def _staged_zips() -> list[Path]:
    zip_dir = get_settings().raw_dir / DATASET
    paths = sorted(zip_dir.glob("*_ADV_Filing_Data_*.zip"),
                   key=lambda p: p.name.split("ADV_Filing_Data_")[1])
    if not paths:
        raise RuntimeError(f"no staged zips under {zip_dir}; run staging first")
    return paths


def _build_winner_index(paths: list[Path]) -> dict[str, Winner]:
    """Pass 1: latest filing per CRD across all zips (IA + ERA Base CSVs)."""
    winners: dict[str, Winner] = {}
    for path in paths:
        with zipfile.ZipFile(path) as zf:
            for prefix, is_era in (("IA_ADV_Base_A_", False), ("ERA_ADV_Base_", True)):
                for member in _csv_members(zf, prefix):
                    for row in _dict_rows(zf, member):
                        crd = normalize_crd(row.get("1E1") or "")
                        filing_id = (row.get("FilingID") or "").strip()
                        dt = _parse_date(row.get("DateSubmitted") or "")
                        if not crd or not filing_id or dt is None:
                            continue
                        cur = winners.get(crd)
                        if cur is None or dt > cur.date:
                            winners[crd] = Winner(
                                filing_id=filing_id, crd=crd, date=dt, zip_path=path,
                                is_era=is_era,
                                era_2b1=(row.get("2B1") or "").strip() or None,
                            )
    return winners


_AB_STAGE_DDL = """
create temp table _ab_stage (
  crd            text not null,
  full_name      text not null,
  name_norm      text not null,
  title          text,
  ownership_code text,
  control_person text,
  schedule       text,
  natural_key    text not null,
  zip_name       text not null,
  primary key (natural_key)
) on commit drop
"""

_FUND_STAGE_DDL = """
create temp table _fund_stage (
  fund_id     text primary key,
  adviser_crd text not null,
  fund_name   text not null,
  name_norm   text not null,
  state       text,
  country     text,
  fund_type   text,
  gav         numeric,
  zip_name    text not null
) on commit drop
"""

_FUND_EDGE_DDL = """
create temp table _fund_edges (
  adviser_crd text not null,
  fund_id     text not null,
  primary key (adviser_crd, fund_id)
) on commit drop
"""

_ZIP_RFID_DDL = """
create temp table _zip_rfid (
  zip_name text primary key,
  rfid     bigint not null
) on commit drop
"""


def ingest() -> dict:
    paths = _staged_zips()
    winners = _build_winner_index(paths)
    winning_ids: dict[str, Winner] = {w.filing_id: w for w in winners.values()}

    counts = {"advisers_with_filings": len(winners), "entity_owners_skipped": 0,
              "people": 0, "relationships": 0, "funds": 0, "fund_edges": 0}

    with connect() as conn:
        # Register every staged zip; remember id per basename for provenance.
        zip_rfid: dict[str, int] = {}
        for path in paths:
            sha = staging._sha256_of(path)
            staged = staging.StagedFile(DATASET, None, path, sha, path.stat().st_size)
            zip_rfid[path.name] = staging.register_raw_file(
                conn, staged, license_code="us_public_domain",
                content_type="application/zip",
            )
        conn.commit()
        run_id = ledger.start_run(conn, zip_rfid[paths[-1].name], DATASET)
        try:
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '30min'")
                cur.execute(_AB_STAGE_DDL)
                cur.execute(_FUND_STAGE_DDL)
                cur.execute(_FUND_EDGE_DDL)
                cur.execute(_ZIP_RFID_DDL)
                with cur.copy("copy _zip_rfid (zip_name, rfid) from stdin") as copy:
                    for zip_name, rfid in zip_rfid.items():
                        copy.write_row((zip_name, rfid))

                # Pass 2: stream winning filings' rows into temp tables.
                with cur.copy(
                    "copy _ab_stage (crd, full_name, name_norm, title, ownership_code,"
                    " control_person, schedule, natural_key, zip_name) from stdin"
                ) as copy:
                    seen_people: set[str] = set()
                    for path in paths:
                        with zipfile.ZipFile(path) as zf:
                            for prefix in ("IA_Schedule_A_B_", "ERA_Schedule_A_B_"):
                                for member in _csv_members(zf, prefix):
                                    for row in _dict_rows(zf, member):
                                        w = winning_ids.get((row.get("FilingID") or "").strip())
                                        if w is None or w.zip_path != path:
                                            continue
                                        if (row.get("DE/FE/I") or "").strip() != "I":
                                            counts["entity_owners_skipped"] += 1
                                            continue
                                        name = (row.get("Full Legal Name") or "").strip()
                                        if not name:
                                            continue
                                        norm = normalize_name(name)
                                        key = f"adv_ab:{w.crd}:{norm}"
                                        if key in seen_people:
                                            continue
                                        seen_people.add(key)
                                        copy.write_row((
                                            w.crd, name.title(), norm,
                                            (row.get("Title or Status") or "").strip() or None,
                                            (row.get("Ownership Code") or "").strip() or None,
                                            (row.get("Control Person") or "").strip() or None,
                                            (row.get("Schedule") or "").strip() or None,
                                            key, path.name,
                                        ))

                with cur.copy(
                    "copy _fund_stage (fund_id, adviser_crd, fund_name, name_norm,"
                    " state, country, fund_type, gav, zip_name) from stdin"
                ) as copy:
                    seen_funds: set[str] = set()
                    edges: set[tuple[str, str]] = set()
                    for path in paths:
                        with zipfile.ZipFile(path) as zf:
                            for prefix in ("IA_Schedule_D_7B1_2", "ERA_Schedule_D_7B1_2"):
                                for member in _csv_members(zf, prefix):
                                    for row in _dict_rows(zf, member):
                                        w = winning_ids.get((row.get("FilingID") or "").strip())
                                        if w is None or w.zip_path != path:
                                            continue
                                        fund_id = (row.get("Fund ID") or "").strip()
                                        fund_name = (row.get("Fund Name") or "").strip()
                                        if not fund_id or not fund_name:
                                            continue
                                        edges.add((w.crd, fund_id))
                                        if fund_id in seen_funds:
                                            continue
                                        seen_funds.add(fund_id)
                                        copy.write_row((
                                            fund_id, w.crd, fund_name,
                                            normalize_name(fund_name),
                                            # 7B1 carries full state names
                                            # ("Delaware"); store codes like
                                            # every other source.
                                            state_code(row.get("State")),
                                            (row.get("Country") or "").strip() or None,
                                            (row.get("Fund Type") or "").strip() or None,
                                            parse_amount(row.get("Gross Asset Value") or ""),
                                            path.name,
                                        ))
                with cur.copy(
                    "copy _fund_edges (adviser_crd, fund_id) from stdin"
                ) as copy:
                    for crd, fund_id in sorted(edges):
                        copy.write_row((crd, fund_id))

                cur.execute("analyze _ab_stage")
                cur.execute("analyze _fund_stage")
                cur.execute("analyze _fund_edges")
                cur.execute("analyze _zip_rfid")

                # People upsert (idempotent on source_natural_key).
                cur.execute("""
                    insert into internal.people
                      (full_name, primary_org_id, primary_title, source_natural_key,
                       raw_file_id, source_record_locator)
                    select s.full_name, oi.org_id, s.title, s.natural_key,
                           z.rfid, 'zip:' || s.zip_name || ':' || s.natural_key
                    from _ab_stage s
                    join internal.org_identifiers oi
                      on oi.id_type = 'crd' and oi.id_value = s.crd
                    join _zip_rfid z on z.zip_name = s.zip_name
                    on conflict (source_natural_key) where source_natural_key is not null
                    do update set
                      full_name = excluded.full_name,
                      primary_org_id = excluded.primary_org_id,
                      primary_title = excluded.primary_title,
                      raw_file_id = excluded.raw_file_id,
                      source_record_locator = excluded.source_record_locator
                """)
                counts["people"] = cur.rowcount

                # Replace ADV-sourced person->adviser edges for refreshed orgs.
                cur.execute("""
                    delete from internal.relationships r
                    using internal.org_identifiers oi
                    where r.to_org_id = oi.org_id
                      and oi.id_type = 'crd'
                      and oi.id_value in (select distinct crd from _ab_stage)
                      and r.rel_type in ('owner_of','executive_of')
                      and r.from_person_id is not null
                """)
                cur.execute("""
                    insert into internal.relationships
                      (from_person_id, to_org_id, rel_type, title, confidence,
                       raw_file_id, source_record_locator)
                    select p.id, oi.org_id,
                           case when s.control_person = 'Y'
                                  or s.ownership_code = any(%(codes)s)
                                then 'owner_of' else 'executive_of' end,
                           s.title, 1.0,
                           p.raw_file_id, p.source_record_locator
                    from _ab_stage s
                    join internal.people p on p.source_natural_key = s.natural_key
                    join internal.org_identifiers oi
                      on oi.id_type = 'crd' and oi.id_value = s.crd
                    on conflict on constraint uq_rel do nothing
                """, {"codes": sorted(_OWNER_CODES)})
                counts["relationships"] = cur.rowcount

                # Fund orgs: update existing (by private-fund id), insert new.
                cur.execute("""
                    update internal.organizations o
                    set name = s.fund_name, name_normalized = s.name_norm,
                        state = case when s.country in ('United States') then s.state end,
                        country = case when s.country = 'United States' then 'US'
                                       else coalesce(upper(left(s.country, 2)), 'US') end,
                        fund_size = s.gav,
                        focus_areas = case when s.fund_type is not null
                                        then array[s.fund_type] else '{}' end,
                        raw_file_id = z.rfid,
                        source_record_locator = 'row:FundID=' || s.fund_id,
                        last_verified_at = now()
                    from _fund_stage s
                    join internal.org_identifiers oi
                      on oi.id_type = 'sec_private_fund_id' and oi.id_value = s.fund_id
                    join _zip_rfid z on z.zip_name = s.zip_name
                    where o.id = oi.org_id
                """)
                funds_updated = cur.rowcount
                cur.execute("""
                    with new_rows as (
                      select s.*, z.rfid
                      from _fund_stage s
                      join _zip_rfid z on z.zip_name = s.zip_name
                      where not exists (
                        select 1 from internal.org_identifiers oi
                        where oi.id_type = 'sec_private_fund_id' and oi.id_value = s.fund_id)
                    ), ins as (
                      insert into internal.organizations
                        (name, name_normalized, org_type, state, country, fund_size,
                         focus_areas, raw_file_id, source_record_locator, last_verified_at)
                      select fund_name, name_norm, 'fund',
                             case when country = 'United States' then state end,
                             case when country = 'United States' then 'US'
                                  else coalesce(upper(left(country, 2)), 'US') end,
                             gav,
                             case when fund_type is not null then array[fund_type]
                                  else '{}' end,
                             rfid, 'row:FundID=' || fund_id, now()
                      from new_rows
                      returning id, source_record_locator, raw_file_id
                    )
                    insert into internal.org_identifiers
                      (org_id, id_type, id_value, raw_file_id, source_record_locator)
                    select id, 'sec_private_fund_id', substring(source_record_locator from 12),
                           raw_file_id, source_record_locator
                    from ins
                """)
                counts["funds"] = funds_updated + cur.rowcount

                # manages_fund edges.
                cur.execute("""
                    insert into internal.relationships
                      (from_org_id, to_org_id, rel_type, confidence,
                       raw_file_id, source_record_locator)
                    select a.org_id, f.org_id, 'manages_fund', 1.0,
                           f.raw_file_id, 'edge:CRD=' || e.adviser_crd || ':FundID=' || e.fund_id
                    from _fund_edges e
                    join internal.org_identifiers a
                      on a.id_type = 'crd' and a.id_value = e.adviser_crd
                    join internal.org_identifiers f
                      on f.id_type = 'sec_private_fund_id' and f.id_value = e.fund_id
                    on conflict on constraint uq_rel do nothing
                """)
                counts["fund_edges"] = cur.rowcount

                # Adviser classification + aggregate fund size.
                cur.execute("""
                    with vc_advisers as (
                      select distinct oi.org_id
                      from _fund_stage s
                      join internal.org_identifiers oi
                        on oi.id_type = 'crd' and oi.id_value = s.adviser_crd
                      where s.fund_type = 'Venture Capital Fund'
                    )
                    update internal.organizations o
                    set org_type = 'vc'
                    from vc_advisers v
                    where o.id = v.org_id and o.org_type = 'investment_adviser'
                """)
                vc_count = cur.rowcount
                cur.execute("""
                    update internal.organizations o
                    set org_type = 'vc'
                    where o.org_type = 'investment_adviser'
                      and (o.raw_source ->> 'era_2b') is not null
                      and (o.raw_source -> 'era_2b' ->> 'Q2B1') = 'Y'
                """)
                vc_count += cur.rowcount
                cur.execute("""
                    with pe_advisers as (
                      select distinct oi.org_id
                      from _fund_stage s
                      join internal.org_identifiers oi
                        on oi.id_type = 'crd' and oi.id_value = s.adviser_crd
                      where s.fund_type = 'Private Equity Fund'
                    )
                    update internal.organizations o
                    set org_type = 'pe'
                    from pe_advisers p
                    where o.id = p.org_id and o.org_type = 'investment_adviser'
                """)
                counts["classified_vc"] = vc_count
                counts["classified_pe"] = cur.rowcount
                cur.execute("""
                    with sums as (
                      select oi.org_id, sum(s.gav) as total_gav
                      from _fund_stage s
                      join internal.org_identifiers oi
                        on oi.id_type = 'crd' and oi.id_value = s.adviser_crd
                      where s.gav is not null
                      group by oi.org_id
                    )
                    update internal.organizations o
                    set fund_size = sums.total_gav
                    from sums
                    where o.id = sums.org_id
                """)
            conn.commit()
            ledger.complete_run(
                conn, run_id,
                inserted=counts["people"] + counts["funds"],
                notes=json.dumps(counts),
            )
            return counts
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
