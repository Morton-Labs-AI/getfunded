"""SBIR/STTR award data — federal non-dilutive awards to small businesses.

Source: https://data.www.sbir.gov/mod_awarddatapublic_no_abstract/award_data_no_abstract.csv
(~65MB, ~280k awards since 1983; the no-abstract variant avoids embedded-newline
hazards; refresh cadence irregular). Public domain.

Loads:
  - awardee companies -> organizations('company') + uei/duns identifiers where
    present (name+state upsert otherwise)
  - agencies -> matched to seeded gov_agency orgs (created if unseeded)
  - awards -> funding_events('sbir_award'/'sttr_award'), funder = agency,
    program_id linked to the seeded SBIR/STTR programs where mappable
  - POC + PI -> people + poc_for edges; emails/phones -> contact_channels at
    privacy_tier='yellow', publishability='internal_only' (government-disclosed
    professional contacts; never auto-published)

Dedupe key (no stable award ID in the bulk file):
  sha256(company|agency|contract|phase|program|year) — collisions counted.
"""

from __future__ import annotations

import csv
import hashlib
from collections import defaultdict

from .. import ledger, staging
from ..db import connect
from ..normalize import normalize_name, parse_amount

DATASET = "sbir_awards"
URL = ("https://data.www.sbir.gov/mod_awarddatapublic_no_abstract/"
       "award_data_no_abstract.csv")

# CSV "Agency" string -> normalized name of the seeded agency org.
AGENCY_MAP = {
    "DEPARTMENT OF ENERGY": "U S DEPARTMENT OF ENERGY OFFICE OF SCIENCE",
    "DEPARTMENT OF DEFENSE": "U S DEPARTMENT OF DEFENSE",
    "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION":
        "NATIONAL AERONAUTICS AND SPACE ADMINISTRATION",
    "NATIONAL SCIENCE FOUNDATION": "NATIONAL SCIENCE FOUNDATION",
    "DEPARTMENT OF HEALTH AND HUMAN SERVICES": "NATIONAL INSTITUTES OF HEALTH",
}

# (agency csv string, program) -> seed program source_record_key
PROGRAM_MAP = {
    ("DEPARTMENT OF ENERGY", "SBIR"): "seed:doe-sbir",
    ("DEPARTMENT OF ENERGY", "STTR"): "seed:doe-sttr",
    ("NATIONAL SCIENCE FOUNDATION", "SBIR"): "seed:nsf-sbir",
    ("NATIONAL SCIENCE FOUNDATION", "STTR"): "seed:nsf-sbir",
    ("DEPARTMENT OF HEALTH AND HUMAN SERVICES", "SBIR"): "seed:nih-sbir",
    ("DEPARTMENT OF HEALTH AND HUMAN SERVICES", "STTR"): "seed:nih-sbir",
    ("NATIONAL AERONAUTICS AND SPACE ADMINISTRATION", "SBIR"): "seed:nasa-sbir",
    ("NATIONAL AERONAUTICS AND SPACE ADMINISTRATION", "STTR"): "seed:nasa-sbir",
    ("DEPARTMENT OF DEFENSE", "SBIR"): "seed:dod-sbir",
    ("DEPARTMENT OF DEFENSE", "STTR"): "seed:dod-sbir",
}

_STAGE_DDL = """
create temp table _sb_awards (
  record_key text primary key,
  company    text not null,
  comp_norm  text not null,
  uei        text,
  duns       text,
  website    text,
  city       text,
  state      text,
  agency_raw text not null,
  agency_norm text not null,
  program    text,
  program_key text,
  phase      text,
  title      text,
  amount     numeric,
  award_year smallint,
  event_type text not null
) on commit drop;

create temp table _sb_people (
  natural_key text primary key,
  comp_norm   text not null,
  state       text,
  full_name   text not null,
  title       text,
  email       text,
  phone       text
) on commit drop
""".strip()


def _award_key(row: dict) -> str:
    basis = "|".join((row.get(k) or "").strip().upper() for k in
                     ("Company", "Agency", "Contract", "Phase", "Program", "Award Year"))
    return "sbir:" + hashlib.sha256(basis.encode()).hexdigest()[:32]


def _get(row: dict, *names: str) -> str | None:
    for n in names:
        for key in row:
            if key and key.strip().lower() == n.lower():
                v = (row[key] or "").strip()
                return v or None
    return None


def ingest(chunk_rows: int = 60000) -> dict:
    staged = staging.stage_download(DATASET, URL, timeout=900.0)
    totals: dict[str, int] = defaultdict(int)

    with connect() as conn:
        raw_file_id = staging.register_raw_file(
            conn, staged, license_code="us_public_domain", content_type="text/csv",
        )
        conn.commit()
        run_id = ledger.start_run(conn, raw_file_id, DATASET)
        try:
            with staged.path.open(encoding="utf-8", errors="replace") as fh:
                reader = csv.DictReader(fh)
                batch_awards: dict[str, tuple] = {}
                batch_people: dict[str, tuple] = {}

                def flush() -> None:
                    if not batch_awards:
                        return
                    counts = _load_chunk(conn, raw_file_id,
                                         list(batch_awards.values()),
                                         list(batch_people.values()))
                    conn.commit()
                    for k, v in counts.items():
                        totals[k] += v
                    batch_awards.clear()
                    batch_people.clear()

                for row in reader:
                    company = _get(row, "Company")
                    agency_raw = (_get(row, "Agency") or "").upper()
                    if not company or not agency_raw:
                        totals["rows_skipped"] += 1
                        continue
                    key = _award_key(row)
                    if key in batch_awards:
                        totals["dupe_keys"] += 1
                        continue
                    program = (_get(row, "Program") or "").upper()
                    comp_norm = normalize_name(company)
                    state = _get(row, "State")
                    batch_awards[key] = (
                        key, company[:400], comp_norm,
                        _get(row, "UEI"), _get(row, "Duns", "DUNS"),
                        _get(row, "Company Website"),
                        _get(row, "City"), state,
                        agency_raw, AGENCY_MAP.get(agency_raw, agency_raw.title()),
                        program or None,
                        PROGRAM_MAP.get((agency_raw, program)),
                        _get(row, "Phase"),
                        _get(row, "Award Title"),
                        parse_amount(_get(row, "Award Amount") or ""),
                        int(y) if (y := _get(row, "Award Year")) and y.isdigit() else None,
                        "sttr_award" if program == "STTR" else "sbir_award",
                    )
                    for prefix in ("Contact", "PI"):
                        name = _get(row, f"{prefix} Name")
                        if not name:
                            continue
                        pkey = f"sbir:{comp_norm}:{normalize_name(name)}"
                        if pkey not in batch_people:
                            batch_people[pkey] = (
                                pkey, comp_norm, state, name.title(),
                                _get(row, f"{prefix} Title"),
                                _get(row, f"{prefix} Email"),
                                _get(row, f"{prefix} Phone"),
                            )
                    if len(batch_awards) >= chunk_rows:
                        flush()
                flush()
            ledger.complete_run(
                conn, run_id,
                inserted=totals["events"],
                notes=str({k: v for k, v in totals.items()}),
            )
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
    return dict(totals)


def _load_chunk(conn, raw_file_id: int, awards: list[tuple], people: list[tuple]) -> dict:
    counts: dict[str, int] = defaultdict(int)
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute(_STAGE_DDL)
        with cur.copy(
            "copy _sb_awards (record_key, company, comp_norm, uei, duns, website,"
            " city, state, agency_raw, agency_norm, program, program_key, phase,"
            " title, amount, award_year, event_type) from stdin"
        ) as copy:
            for t in awards:
                copy.write_row(t)
        with cur.copy(
            "copy _sb_people (natural_key, comp_norm, state, full_name, title,"
            " email, phone) from stdin"
        ) as copy:
            for t in people:
                copy.write_row(t)
        cur.execute("analyze _sb_awards"); cur.execute("analyze _sb_people")

        # Agencies: create any not already present (matched on normalized name).
        cur.execute("""
            insert into internal.organizations
              (name, name_normalized, org_type, raw_file_id,
               source_record_locator, last_verified_at)
            select distinct on (agency_norm)
                   initcap(agency_norm), upper(agency_norm), 'gov_agency',
                   %(rfid)s, 'row:Agency=' || agency_raw, now()
            from _sb_awards s
            where not exists (
              select 1 from internal.organizations o
              where o.org_type = 'gov_agency'
                and o.name_normalized = upper(s.agency_norm))
        """, {"rfid": raw_file_id})
        counts["agencies_created"] += cur.rowcount

        # Companies: upsert by UEI identifier when present, else by (name, state).
        cur.execute("""
            with latest as (
              select distinct on (comp_norm, coalesce(state, '')) *
              from _sb_awards order by comp_norm, coalesce(state, ''), award_year desc
            ), ins as (
              insert into internal.organizations
                (name, name_normalized, org_type, city, state, website,
                 raw_file_id, source_record_locator, last_verified_at)
              select l.company, l.comp_norm, 'company', l.city, l.state, l.website,
                     %(rfid)s, 'row:key=' || l.record_key, now()
              from latest l
              where not exists (
                      select 1 from internal.org_identifiers oi
                      where oi.id_type = 'uei' and oi.id_value = l.uei and l.uei is not null)
                and not exists (
                      select 1 from internal.organizations o
                      where o.org_type = 'company'
                        and o.name_normalized = l.comp_norm
                        and coalesce(o.state, '') = coalesce(l.state, ''))
              returning id, name_normalized, coalesce(state, '') as st
            )
            select count(*) from ins
        """, {"rfid": raw_file_id})
        fetched = cur.fetchone()
        counts["companies_created"] += int(fetched[0]) if fetched else 0

        # UEI/DUNS identifiers for companies that have them.
        cur.execute("""
            insert into internal.org_identifiers
              (org_id, id_type, id_value, raw_file_id, source_record_locator)
            select distinct on (s.uei) o.id, 'uei', s.uei, %(rfid)s, 'row:key=' || s.record_key
            from _sb_awards s
            join internal.organizations o
              on o.org_type = 'company' and o.name_normalized = s.comp_norm
             and coalesce(o.state, '') = coalesce(s.state, '')
            where s.uei is not null
            on conflict (id_type, id_value) do nothing
        """, {"rfid": raw_file_id})
        cur.execute("""
            insert into internal.org_identifiers
              (org_id, id_type, id_value, raw_file_id, source_record_locator)
            select distinct on (s.duns) o.id, 'duns', s.duns, %(rfid)s, 'row:key=' || s.record_key
            from _sb_awards s
            join internal.organizations o
              on o.org_type = 'company' and o.name_normalized = s.comp_norm
             and coalesce(o.state, '') = coalesce(s.state, '')
            where s.duns is not null
            on conflict (id_type, id_value) do nothing
        """, {"rfid": raw_file_id})

        # Awards -> funding_events (funder = agency, program linked if mapped).
        cur.execute("""
            insert into internal.funding_events
              (event_type, funder_org_id, program_id, recipient_org_id,
               recipient_name, recipient_city, recipient_state, fiscal_year,
               amount, purpose_text, source_record_key,
               raw_file_id, source_record_locator)
            select s.event_type, ag.id, fp.id, co.id,
                   s.company, s.city, s.state, s.award_year,
                   s.amount,
                   trim(coalesce(s.title, '') ||
                        coalesce(' [' || s.phase || ']', '')),
                   s.record_key, %(rfid)s, 'row:key=' || s.record_key
            from _sb_awards s
            join internal.organizations ag
              on ag.org_type = 'gov_agency' and ag.name_normalized = upper(s.agency_norm)
            left join internal.funding_programs fp on fp.source_record_key = s.program_key
            left join internal.organizations co
              on co.org_type = 'company' and co.name_normalized = s.comp_norm
             and coalesce(co.state, '') = coalesce(s.state, '')
            on conflict (source_record_key) do nothing
        """, {"rfid": raw_file_id})
        counts["events"] += cur.rowcount

        # POC/PI people + poc_for edges + yellow/internal contact channels.
        cur.execute("""
            insert into internal.people
              (full_name, primary_org_id, primary_title, source_natural_key,
               raw_file_id, source_record_locator)
            select s.full_name, co.id, s.title, s.natural_key,
                   %(rfid)s, 'poc:' || s.natural_key
            from _sb_people s
            join internal.organizations co
              on co.org_type = 'company' and co.name_normalized = s.comp_norm
             and coalesce(co.state, '') = coalesce(s.state, '')
            on conflict (source_natural_key) where source_natural_key is not null
            do update set primary_title = excluded.primary_title
        """, {"rfid": raw_file_id})
        counts["people"] += cur.rowcount

        cur.execute("""
            insert into internal.relationships
              (from_person_id, to_org_id, rel_type, title, confidence,
               raw_file_id, source_record_locator)
            select p.id, co.id, 'poc_for', s.title, 1.0,
                   %(rfid)s, 'poc:' || s.natural_key
            from _sb_people s
            join internal.people p on p.source_natural_key = s.natural_key
            join internal.organizations co
              on co.org_type = 'company' and co.name_normalized = s.comp_norm
             and coalesce(co.state, '') = coalesce(s.state, '')
            on conflict on constraint uq_rel do nothing
        """, {"rfid": raw_file_id})

        for channel, col in (("email", "email"), ("phone", "phone")):
            cur.execute(f"""
                insert into internal.contact_channels
                  (person_id, channel_type, value, is_role_based, privacy_tier,
                   publishability, raw_file_id, source_record_locator)
                select p.id, %(channel)s, s.{col}, false, 'yellow', 'internal_only',
                       %(rfid)s, 'poc:' || s.natural_key
                from _sb_people s
                join internal.people p on p.source_natural_key = s.natural_key
                where s.{col} is not null
                on conflict (org_id, person_id, channel_type, value) do nothing
            """, {"rfid": raw_file_id, "channel": channel})
            counts["contacts"] += cur.rowcount
    return counts
