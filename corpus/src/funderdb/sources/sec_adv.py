"""SEC Form ADV ingest — investment advisers (RIA + ERA).

Phase G3a — firm spine from the daily full-universe feed:
  https://reports.adviserinfo.sec.gov/reports/CompilationReports/
      IA_FIRM_SEC_Feed_MM_DD_YYYY.xml.gz  (~7MB gz, regenerated daily,
      retained only ~7 days server-side — snapshot promptly).
  Verified content (2026-07-25): 17,050 Registered + 6,588 ERA = 23,638 firms.
  Per firm: CRD, SEC number, names, address, phone, website, RAUM (Item5F
  Q5F2C), advises-private-funds (Item7B Q7B), registration type + status.

Phase G3b (separate module function, later): monthly filing zips with
Schedule A/B owners and Schedule D 7.B.1 private funds.

raw_source policy: compact extracted dict (~300B/row), not the full XML —
low-volume table, but no reason to duplicate Part 1A wholesale.
"""

from __future__ import annotations

import gzip
import json
from dataclasses import dataclass
from datetime import date, datetime

from lxml import etree

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..normalize import normalize_crd, normalize_name, parse_amount

DATASET = "sec_form_adv"
FEED_URL = (
    "https://reports.adviserinfo.sec.gov/reports/CompilationReports/"
    "IA_FIRM_SEC_Feed_{mm}_{dd}_{yyyy}.xml.gz"
)

_COUNTRY_MAP = {"United States": "US"}


@dataclass(frozen=True)
class AdvFirm:
    crd: str
    sec_number: str | None
    name: str
    legal_name: str | None
    name_normalized: str
    street: str | None
    city: str | None
    state: str | None
    zip: str | None
    country: str
    phone: str | None
    website: str | None
    is_era: bool
    aum: int | None
    raw: dict


def stage_feed(feed_date: date | None = None) -> staging.StagedFile:
    """Download (or reuse) the daily firm feed. Defaults to the newest staged
    file; if none exists, fetches today's."""
    settings = get_settings()
    feed_dir = settings.raw_dir / DATASET
    if feed_date is None:
        existing = sorted(feed_dir.glob("*_IA_FIRM_SEC_Feed_*.xml.gz"))
        if existing:
            path = existing[-1]
            return staging.StagedFile(
                DATASET, None, path, staging._sha256_of(path), path.stat().st_size
            )
        feed_date = datetime.now().date()
    url = FEED_URL.format(
        mm=f"{feed_date.month:02d}", dd=f"{feed_date.day:02d}", yyyy=feed_date.year
    )
    return staging.stage_download(DATASET, url, timeout=300.0)


def parse_firms(path) -> list[AdvFirm]:
    firms: list[AdvFirm] = []
    seen: set[str] = set()
    with gzip.open(path, "rb") as fh:
        for _, el in etree.iterparse(fh, tag="Firm"):
            info = el.find("Info")
            rgstn = el.find("Rgstn")
            addr = el.find("MainAddr")
            crd = normalize_crd(info.get("FirmCrdNb") or "") if info is not None else None
            if info is None or crd is None or crd in seen:
                el.clear()
                continue
            seen.add(crd)
            name = (info.get("BusNm") or info.get("LegalNm") or "").strip()
            if not name:
                el.clear()
                continue
            website = None
            web_el = el.find(".//Part1A/Item1/WebAddrs/WebAddr")
            if web_el is not None and web_el.text:
                website = web_el.text.strip()[:500]
            item5f = el.find(".//Part1A/Item5F")
            aum = parse_amount(item5f.get("Q5F2C") or "") if item5f is not None else None
            item7b = el.find(".//Part1A/Item7B")
            q7b = item7b.get("Q7B") if item7b is not None else None
            item2b = el.find(".//Part1A/Item2B")
            firm_type = rgstn.get("FirmType") if rgstn is not None else None
            country_raw = (addr.get("Cntry") or "").strip() if addr is not None else ""
            firms.append(
                AdvFirm(
                    crd=crd,
                    sec_number=(info.get("SECNb") or "").strip() or None,
                    name=name,
                    legal_name=(info.get("LegalNm") or "").strip() or None,
                    name_normalized=normalize_name(name),
                    street=(addr.get("Strt1") or "").strip() or None if addr is not None else None,
                    city=(addr.get("City") or "").strip() or None if addr is not None else None,
                    state=(addr.get("State") or "").strip() or None if addr is not None else None,
                    zip=(addr.get("PostlCd") or "").strip() or None if addr is not None else None,
                    country=_COUNTRY_MAP.get(country_raw, country_raw[:2].upper() or "US"),
                    phone=(addr.get("PhNb") or "").strip() or None if addr is not None else None,
                    website=website,
                    is_era=firm_type == "ERA",
                    aum=aum,
                    raw={
                        "crd": crd,
                        "firm_type": firm_type,
                        "rgstn_status": rgstn.get("St") if rgstn is not None else None,
                        "rgstn_date": rgstn.get("Dt") if rgstn is not None else None,
                        "advises_private_funds": q7b,
                        "era_2b": dict(item2b.attrib) if item2b is not None else None,
                        "raum": aum,
                    },
                )
            )
            el.clear()
    return firms


_STAGE_DDL = """
create temp table _adv_stage (
  crd         text primary key,
  sec_number  text,
  name        text not null,
  legal_name  text,
  name_norm   text not null,
  street      text,
  city        text,
  state       text,
  zip         text,
  country     text,
  phone       text,
  website     text,
  is_era      boolean not null,
  aum         numeric,
  raw         jsonb
) on commit drop
"""

_UPDATE_SQL = """
update internal.organizations o
set name = s.name, legal_name = s.legal_name, name_normalized = s.name_norm,
    street = s.street, city = s.city, state = s.state, zip = s.zip,
    country = s.country, website = s.website,
    aum = s.aum, is_era = s.is_era,
    raw_file_id = %(rfid)s,
    source_record_locator = 'row:CRD=' || s.crd,
    raw_source = s.raw,
    last_verified_at = now()
from _adv_stage s
join internal.org_identifiers oi on oi.id_type = 'crd' and oi.id_value = s.crd
where o.id = oi.org_id
"""

_INSERT_SQL = """
with new_rows as (
  select s.* from _adv_stage s
  where not exists (
    select 1 from internal.org_identifiers oi
    where oi.id_type = 'crd' and oi.id_value = s.crd)
), ins as (
  insert into internal.organizations
    (name, legal_name, name_normalized, org_type, street, city, state, zip, country,
     website, aum, is_era,
     raw_file_id, source_record_locator, raw_source, last_verified_at)
  select name, legal_name, name_norm, 'investment_adviser', street, city, state, zip,
         country, website, aum, is_era,
         %(rfid)s, 'row:CRD=' || crd, raw, now()
  from new_rows
  returning id, source_record_locator
)
insert into internal.org_identifiers (org_id, id_type, id_value, raw_file_id, source_record_locator)
select id, 'crd', substring(source_record_locator from 9), %(rfid)s, source_record_locator
from ins
"""

_SEC_NUMBER_SQL = """
insert into internal.org_identifiers (org_id, id_type, id_value, raw_file_id, source_record_locator)
select oi.org_id, 'sec_file_number', s.sec_number, %(rfid)s, 'row:CRD=' || s.crd
from _adv_stage s
join internal.org_identifiers oi on oi.id_type = 'crd' and oi.id_value = s.crd
where s.sec_number is not null
on conflict (id_type, id_value) do nothing
"""

_PHONE_SQL = """
insert into internal.contact_channels
  (org_id, channel_type, value, is_role_based, privacy_tier, publishability,
   raw_file_id, source_record_locator)
select oi.org_id, 'phone', s.phone, true, 'green', 'internal_only',
       %(rfid)s, 'row:CRD=' || s.crd
from _adv_stage s
join internal.org_identifiers oi on oi.id_type = 'crd' and oi.id_value = s.crd
where s.phone is not null
on conflict (org_id, person_id, channel_type, value) do nothing
"""


def ingest(feed_date: date | None = None) -> dict:
    staged = stage_feed(feed_date)
    firms = parse_firms(staged.path)
    with connect() as conn:
        raw_file_id = staging.register_raw_file(
            conn, staged, license_code="us_public_domain",
            as_of_date=feed_date, content_type="application/gzip",
        )
        conn.commit()
        run_id = ledger.start_run(conn, raw_file_id, DATASET)
        try:
            with conn.cursor() as cur:
                cur.execute(_STAGE_DDL)
                with cur.copy(
                    "copy _adv_stage (crd, sec_number, name, legal_name, name_norm, "
                    "street, city, state, zip, country, phone, website, is_era, aum, raw) "
                    "from stdin"
                ) as copy:
                    for f in firms:
                        copy.write_row((
                            f.crd, f.sec_number, f.name, f.legal_name, f.name_normalized,
                            f.street, f.city, f.state, f.zip, f.country, f.phone,
                            f.website, f.is_era, f.aum, json.dumps(f.raw),
                        ))
                cur.execute(_UPDATE_SQL, {"rfid": raw_file_id})
                updated = cur.rowcount
                cur.execute(_INSERT_SQL, {"rfid": raw_file_id})
                inserted = cur.rowcount
                cur.execute(_SEC_NUMBER_SQL, {"rfid": raw_file_id})
                cur.execute(_PHONE_SQL, {"rfid": raw_file_id})
            conn.commit()
            ledger.complete_run(
                conn, run_id, inserted=inserted, updated=updated,
                notes=f"{staged.path.name}: {len(firms)} firms parsed",
            )
            return {"parsed": len(firms), "inserted": inserted, "updated": updated}
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
