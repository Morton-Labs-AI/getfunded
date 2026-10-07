"""SEC Form D quarterly structured data sets — Reg D exempt offerings.

Source: https://www.sec.gov/files/structureddata/data/form-d-data-sets/{yyyy}q{n}_d.zip
(quarterly, ~3.6MB each, TSVs: FORMDSUBMISSION / ISSUERS / OFFERING /
RELATEDPERSONS; requires a declared User-Agent). Phase-1 scope: 2024Q1 ->
present; 2008+ backfill is Phase 2.

Loads (processing quarters chronologically):
  - issuers -> organizations (org_type 'fund' for pooled investment funds,
    'company' otherwise) + cik identifiers
  - offerings -> funding_events(event_type='reg_d_offering'); recipient = the
    issuer; funder intentionally NULL (investors are unnamed in Form D).
    Amendment chains (D/A with PREVIOUSACCESSIONNUMBER) supersede: inserting
    the amendment deletes the predecessor event, so current state = latest.
  - related persons -> people + executive_of/director_of edges

Prelude re-test lives here: Form D issuers are the fund side of managers that
never file ADV (family-office-exempt structures).
"""

from __future__ import annotations

import csv
import io
import zipfile
from collections import defaultdict
from datetime import date, datetime

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..normalize import normalize_cik, normalize_name, parse_amount

DATASET = "sec_form_d"
URL = "https://www.sec.gov/files/structureddata/data/form-d-data-sets/{q}_d.zip"

_EXEC_WORDS = ("EXECUTIVE", "OFFICER")
_DIR_WORDS = ("DIRECTOR", "TRUSTEE")


def quarters(start: str = "2024q1") -> list[str]:
    """Quarter labels from start through the last fully-posted quarter
    (posted ~5 weeks after quarter end)."""
    today = datetime.now().date()
    out = []
    y, q = int(start[:4]), int(start[5])
    while True:
        q_end = date(y + (1 if q == 4 else 0), 1 if q == 4 else q * 3 + 1, 1)
        if (today - q_end).days < 40:
            break
        out.append(f"{y}q{q}")
        y, q = (y + 1, 1) if q == 4 else (y, q + 1)
    return out


def _rows(zf: zipfile.ZipFile, name_part: str):
    for member in zf.namelist():
        if name_part in member.upper():
            with zf.open(member) as fh:
                yield from csv.DictReader(
                    io.TextIOWrapper(fh, encoding="latin-1"), delimiter="\t"
                )


def _parse_sale_date(raw: str) -> date | None:
    raw = (raw or "").strip()
    for fmt in ("%d-%b-%Y", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


_STAGE_DDL = """
create temp table _fd_issuers (
  accession  text not null,
  cik        text not null,
  name       text not null,
  name_norm  text not null,
  city       text,
  state      text,
  is_fund    boolean not null,
  fund_type  text,
  primary key (accession, cik)
) on commit drop;

create temp table _fd_offerings (
  accession    text primary key,
  prev_accession text,
  cik          text not null,
  sale_date    date,
  amount_sold  numeric,
  total_offering numeric,
  industry     text,
  fund_type    text
) on commit drop;

create temp table _fd_people (
  natural_key text primary key,
  cik         text not null,
  full_name   text not null,
  rel_type    text not null,
  title       text
) on commit drop
"""


def ingest(start: str = "2024q1") -> dict:
    settings = get_settings()
    headers = {"User-Agent": settings.require_sec_user_agent()}
    totals: dict[str, int] = defaultdict(int)

    with connect() as conn:
        for q in quarters(start):
            staged = staging.stage_download(
                DATASET, URL.format(q=q), filename=f"{q}_d.zip",
                headers=headers, timeout=300.0,
            )
            raw_file_id = staging.register_raw_file(
                conn, staged, license_code="us_public_domain",
                content_type="application/zip",
            )
            conn.commit()
            run_id = ledger.start_run(conn, raw_file_id, DATASET)
            try:
                with zipfile.ZipFile(staged.path) as zf:
                    # OFFERING first: industry/fund type keyed by accession.
                    offering: dict[str, dict] = {}
                    for row in _rows(zf, "OFFERING"):
                        acc = (row.get("ACCESSIONNUMBER") or "").strip()
                        if acc:
                            offering[acc] = row

                    issuers: list[tuple] = []
                    primary_cik: dict[str, str] = {}
                    for row in _rows(zf, "ISSUERS"):
                        acc = (row.get("ACCESSIONNUMBER") or "").strip()
                        cik = normalize_cik(row.get("CIK") or "")
                        name = (row.get("ENTITYNAME") or "").strip()
                        if not acc or not cik or not name:
                            continue
                        off = offering.get(acc, {})
                        industry = (off.get("INDUSTRYGROUPTYPE") or "").strip()
                        fund_type = (off.get("INVESTMENTFUNDTYPE") or "").strip() or None
                        is_fund = industry == "Pooled Investment Fund"
                        if (row.get("ISPRIMARYISSUER_FLAG") or "Y").strip() != "N":
                            primary_cik.setdefault(acc, cik)
                        issuers.append((acc, cik, name[:400], normalize_name(name),
                                        (row.get("CITY") or "").strip() or None,
                                        (row.get("STATEORCOUNTRY") or "").strip()[:2] or None,
                                        is_fund, fund_type))

                    offerings: list[tuple] = []
                    for acc, off in offering.items():
                        cik = primary_cik.get(acc)
                        if not cik:
                            continue
                        offerings.append((
                            acc,
                            (off.get("PREVIOUSACCESSIONNUMBER") or "").strip() or None,
                            cik,
                            _parse_sale_date(off.get("SALE_DATE") or ""),
                            parse_amount(off.get("TOTALAMOUNTSOLD") or ""),
                            parse_amount(off.get("TOTALOFFERINGAMOUNT") or ""),
                            (off.get("INDUSTRYGROUPTYPE") or "").strip() or None,
                            (off.get("INVESTMENTFUNDTYPE") or "").strip() or None,
                        ))

                    people: dict[str, tuple] = {}
                    for row in _rows(zf, "RELATEDPERSONS"):
                        acc = (row.get("ACCESSIONNUMBER") or "").strip()
                        cik = primary_cik.get(acc)
                        if not cik:
                            continue
                        first = (row.get("FIRSTNAME") or "").strip()
                        last = (row.get("LASTNAME") or "").strip()
                        if not last:
                            continue
                        full = f"{first} {last}".strip().title()
                        rels = " ".join(
                            (row.get(k) or "") for k in row if k and "RELATIONSHIP" in k
                        ).upper()
                        rel_type = ("director_of" if any(w in rels for w in _DIR_WORDS)
                                    and not any(w in rels for w in _EXEC_WORDS)
                                    else "executive_of")
                        key = f"formd:{cik}:{normalize_name(full)}"
                        people.setdefault(key, (key, cik, full, rel_type,
                                                (row.get("RELATIONSHIPCLARIFICATION") or
                                                 "").strip()[:200] or None))

                with conn.cursor() as cur:
                    cur.execute("set local statement_timeout = '30min'")
                    cur.execute(_STAGE_DDL)
                    with cur.copy(
                        "copy _fd_issuers (accession, cik, name, name_norm, city,"
                        " state, is_fund, fund_type) from stdin"
                    ) as copy:
                        seen = set()
                        for t in issuers:
                            if (t[0], t[1]) in seen:
                                continue
                            seen.add((t[0], t[1]))
                            copy.write_row(t)
                    with cur.copy(
                        "copy _fd_offerings (accession, prev_accession, cik, sale_date,"
                        " amount_sold, total_offering, industry, fund_type) from stdin"
                    ) as copy:
                        for t in offerings:
                            copy.write_row(t)
                    with cur.copy(
                        "copy _fd_people (natural_key, cik, full_name, rel_type, title)"
                        " from stdin"
                    ) as copy:
                        for t in people.values():
                            copy.write_row(t)
                    cur.execute("analyze _fd_issuers")
                    cur.execute("analyze _fd_offerings")
                    cur.execute("analyze _fd_people")

                    # Issuer orgs: update-then-insert via cik crosswalk (latest
                    # quarter wins for name/address).
                    cur.execute("""
                        with latest as (
                          select distinct on (cik) *
                          from _fd_issuers order by cik, accession desc
                        )
                        update internal.organizations o
                        set name = l.name, name_normalized = l.name_norm,
                            city = l.city, state = l.state,
                            focus_areas = case when l.fund_type is not null
                                            then array[l.fund_type] else o.focus_areas end,
                            raw_file_id = %(rfid)s,
                            source_record_locator = 'accession:' || l.accession,
                            last_verified_at = now()
                        from latest l
                        join internal.org_identifiers oi
                          on oi.id_type = 'cik' and oi.id_value = l.cik
                        where o.id = oi.org_id
                    """, {"rfid": raw_file_id})
                    updated = cur.rowcount
                    cur.execute("""
                        with latest as (
                          select distinct on (cik) *
                          from _fd_issuers order by cik, accession desc
                        ), new_rows as (
                          select l.* from latest l
                          where not exists (
                            select 1 from internal.org_identifiers oi
                            where oi.id_type = 'cik' and oi.id_value = l.cik)
                        ), ins as (
                          insert into internal.organizations
                            (name, name_normalized, org_type, city, state, focus_areas,
                             raw_file_id, source_record_locator, last_verified_at)
                          select name, name_norm,
                                 case when is_fund then 'fund' else 'company' end,
                                 city, state,
                                 case when fund_type is not null then array[fund_type]
                                      else '{}' end,
                                 %(rfid)s, 'accession:' || accession || ':cik:' || cik, now()
                          from new_rows
                          returning id, source_record_locator
                        )
                        insert into internal.org_identifiers
                          (org_id, id_type, id_value, raw_file_id, source_record_locator)
                        select id, 'cik',
                               substring(source_record_locator from position(':cik:' in source_record_locator) + 5),
                               %(rfid)s, source_record_locator
                        from ins
                    """, {"rfid": raw_file_id})
                    totals["issuer_orgs"] += updated + cur.rowcount

                    # Amendment supersession: drop predecessor events.
                    cur.execute("""
                        delete from internal.funding_events fe
                        using _fd_offerings s
                        where s.prev_accession is not null
                          and fe.source_record_key = 'form_d:' || s.prev_accession
                    """)
                    totals["superseded"] += cur.rowcount

                    cur.execute("""
                        insert into internal.funding_events
                          (event_type, recipient_org_id, recipient_name, event_date,
                           amount, purpose_text, source_record_key,
                           raw_file_id, source_record_locator)
                        select 'reg_d_offering', oi.org_id, o.name, s.sale_date,
                               nullif(s.amount_sold, 0),
                               trim(coalesce(s.industry, '') ||
                                    coalesce(' / ' || s.fund_type, '')),
                               'form_d:' || s.accession,
                               %(rfid)s, 'accession:' || s.accession
                        from _fd_offerings s
                        join internal.org_identifiers oi
                          on oi.id_type = 'cik' and oi.id_value = s.cik
                        join internal.organizations o on o.id = oi.org_id
                        on conflict (source_record_key) do nothing
                    """, {"rfid": raw_file_id})
                    totals["offerings"] += cur.rowcount

                    cur.execute("""
                        insert into internal.people
                          (full_name, primary_org_id, primary_title, source_natural_key,
                           raw_file_id, source_record_locator)
                        select s.full_name, oi.org_id, s.title, s.natural_key,
                               %(rfid)s, 'related_person:' || s.natural_key
                        from _fd_people s
                        join internal.org_identifiers oi
                          on oi.id_type = 'cik' and oi.id_value = s.cik
                        on conflict (source_natural_key) where source_natural_key is not null
                        do update set primary_title = excluded.primary_title
                    """, {"rfid": raw_file_id})
                    totals["people"] += cur.rowcount

                    cur.execute("""
                        insert into internal.relationships
                          (from_person_id, to_org_id, rel_type, title, confidence,
                           raw_file_id, source_record_locator)
                        select p.id, oi.org_id, s.rel_type, s.title, 1.0,
                               %(rfid)s, 'related_person:' || s.natural_key
                        from _fd_people s
                        join internal.people p on p.source_natural_key = s.natural_key
                        join internal.org_identifiers oi
                          on oi.id_type = 'cik' and oi.id_value = s.cik
                        on conflict on constraint uq_rel do nothing
                    """, {"rfid": raw_file_id})
                    totals["relationships"] += cur.rowcount
                conn.commit()
                ledger.complete_run(
                    conn, run_id, inserted=len(offerings),
                    notes=f"{q}: {len(offerings)} offerings, {len(people)} people",
                )
                print(f"{q}: offerings={len(offerings):,} issuers={len(issuers):,} "
                      f"people={len(people):,}", flush=True)
                totals["quarters"] += 1
            except Exception as exc:
                try:
                    conn.rollback()
                    ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                except Exception:
                    pass
                raise
    return dict(totals)
