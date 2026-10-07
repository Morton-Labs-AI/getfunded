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
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import httpx
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
_FEED_NAME_RE = re.compile(r"IA_FIRM_SEC_Feed_(\d{2})_(\d{2})_(\d{4})\.xml\.gz$")

# A staged feed older than this is considered stale: `ingest adv` fetches the
# newest available day instead of silently reusing it. Override with
# --max-age-days; `--refresh` forces the fetch regardless.
DEFAULT_MAX_AGE = timedelta(days=7)
# The host regenerates the feed daily and keeps ~7 days; when today's file is
# not published yet we walk back this many days to find the newest one.
_LOOKBACK_DAYS = 7

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


def feed_date_of(name: str | Path) -> date | None:
    """Vintage of a staged feed file, read from its dated filename (never from
    the hash prefix the staged name starts with)."""
    m = _FEED_NAME_RE.search(Path(name).name)
    if not m:
        return None
    mm, dd, yyyy = (int(x) for x in m.groups())
    try:
        return date(yyyy, mm, dd)
    except ValueError:
        return None


def feed_url(feed_date: date) -> str:
    return FEED_URL.format(
        mm=f"{feed_date.month:02d}", dd=f"{feed_date.day:02d}", yyyy=feed_date.year
    )


def newest_staged_feed(feed_dir: Path) -> tuple[date, Path] | None:
    """Newest staged feed BY FEED DATE. Ties (same day staged twice) go to the
    later fetch per the sidecar. Hash order never enters into it."""
    dated: list[tuple[date, float, Path]] = []
    for p in feed_dir.glob("*_IA_FIRM_SEC_Feed_*.xml.gz"):
        if p.name.startswith((".partial", ".corrupt")):
            continue
        d = feed_date_of(p)
        if d is None:
            continue
        dated.append((d, p.stat().st_mtime, p))
    if not dated:
        return None
    d, _, p = max(dated, key=lambda t: (t[0], t[1]))
    return d, p


def stage_feed(feed_date: date | None = None, *, refresh: bool = False,
               max_age: timedelta = DEFAULT_MAX_AGE) -> staging.StagedFile:
    """Stage the daily firm feed with an explicit vintage.

    * ``feed_date`` given: that day's file (immutable once published; cached
      copies are reused).
    * otherwise: the newest staged feed is reused while its feed date is
      within ``max_age``; past that, or with ``refresh=True``, the newest
      available day is fetched (today, walking back up to a week).
    """
    settings = get_settings()
    headers = {"User-Agent": settings.require_sec_user_agent()}
    feed_dir = settings.raw_dir / DATASET
    if feed_date is not None:
        return staging.stage_download(DATASET, feed_url(feed_date), headers=headers,
                                      timeout=300.0)

    newest = newest_staged_feed(feed_dir)
    today = datetime.now(timezone.utc).date()
    if newest is not None and not refresh:
        d, path = newest
        if today - d <= max_age:
            return staging.staged_from_path(DATASET, path, feed_url(d))
        print(f"  staged ADV feed {d.isoformat()} is older than {max_age.days} days; "
              "fetching the newest available feed", file=sys.stderr)

    last_err: Exception | None = None
    for back in range(_LOOKBACK_DAYS + 1):
        d = today - timedelta(days=back)
        try:
            return staging.stage_download(DATASET, feed_url(d), headers=headers,
                                          timeout=300.0)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise
            last_err = exc
    if newest is not None:
        d, path = newest
        print(f"  WARNING: no ADV feed published in the last {_LOOKBACK_DAYS} days; "
              f"using STALE staged feed {d.isoformat()}", file=sys.stderr)
        return staging.staged_from_path(DATASET, path, feed_url(d))
    raise RuntimeError(
        f"no ADV firm feed found for the last {_LOOKBACK_DAYS} days ({last_err!r})")


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
    last_verified_at = %(verified_at)s
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
         %(rfid)s, 'row:CRD=' || crd, raw, %(verified_at)s
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


def ingest(feed_date: date | None = None, *, refresh: bool = False,
           max_age: timedelta = DEFAULT_MAX_AGE) -> dict:
    staged = stage_feed(feed_date, refresh=refresh, max_age=max_age)
    firms = parse_firms(staged.path)
    # The feed DATE is the vintage: rows are "verified" as of the day the SEC
    # generated the file, not the day we happened to parse it.
    vintage = feed_date_of(staged.path) or staged.vintage_date
    verified_at = (datetime.combine(vintage, time.min, tzinfo=timezone.utc)
                   if vintage else staging.verified_at(staged))
    with connect() as conn:
        raw_file_id = staging.register_raw_file(
            conn, staged, license_code="us_public_domain",
            as_of_date=vintage, content_type="application/gzip",
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
                params = {"rfid": raw_file_id, "verified_at": verified_at}
                cur.execute(_UPDATE_SQL, params)
                updated = cur.rowcount
                cur.execute(_INSERT_SQL, params)
                inserted = cur.rowcount
                cur.execute(_SEC_NUMBER_SQL, {"rfid": raw_file_id})
                cur.execute(_PHONE_SQL, {"rfid": raw_file_id})
            conn.commit()
            ledger.complete_run(
                conn, run_id, inserted=inserted, updated=updated,
                notes=f"{staged.path.name}: {len(firms)} firms parsed",
            )
            return {"parsed": len(firms), "inserted": inserted, "updated": updated,
                    "feed_date": vintage.isoformat() if vintage else None,
                    "from_cache": staged.from_cache}
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
