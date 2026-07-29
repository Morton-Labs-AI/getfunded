"""IRS 990-PF bulk XML e-file ingest — officers + grants-paid.

Index-driven (never glob the zips):
  https://apps.irs.gov/pub/epostcard/990/xml/{YEAR}/index_{YEAR}.csv
  -> filter RETURN_TYPE='990PF', group by XML_BATCH_ID, fetch only PF-bearing
  batch zips, extract only needed {OBJECT_ID}_public.xml members.

Verified element paths (2024v5.5 schema; single namespace http://www.irs.gov/efile):
  officers: ReturnData/IRS990PF/OfficerDirTrstKeyEmplInfoGrp/OfficerDirTrstKeyEmplGrp
            -> PersonNm, TitleTxt, CompensationAmt
  grants:   ReturnData/IRS990PF/SupplementaryInformationGrp/GrantOrContributionPdDurYrGrp
            -> RecipientPersonNm | RecipientBusinessName/BusinessNameLine1Txt,
               RecipientUSAddress (CityNm, StateAbbreviationCd),
               GrantOrContributionPurposeTxt, Amt

Idempotency: internal.processed_filings (object_id pk) — filings are immutable;
seen => skip. One transaction per batch zip. Grants carry NO raw_source
(high volume); locator identifies the XML element path.
"""

from __future__ import annotations

import csv
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from lxml import etree

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..normalize import normalize_ein, normalize_name, parse_amount

DATASET = "irs_990_xml"
NS = "{http://www.irs.gov/efile}"
INDEX_URL = "https://apps.irs.gov/pub/epostcard/990/xml/{year}/index_{year}.csv"
BATCH_URL = "https://apps.irs.gov/pub/epostcard/990/xml/{year}/{batch}.zip"


@dataclass(frozen=True)
class PfFiling:
    object_id: str
    ein: str
    tax_period: str
    taxpayer_name: str
    batch_id: str


def stage_index(year: int) -> staging.StagedFile:
    return staging.stage_download(
        DATASET, INDEX_URL.format(year=year), filename=f"index_{year}.csv", timeout=300.0
    )


def load_pf_index(year: int) -> list[PfFiling]:
    staged = stage_index(year)
    out: list[PfFiling] = []
    with staged.path.open(encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            if (row.get("RETURN_TYPE") or "").strip() != "990PF":
                continue
            ein = normalize_ein(row.get("EIN") or "")
            oid = (row.get("OBJECT_ID") or "").strip()
            batch = (row.get("XML_BATCH_ID") or "").strip()
            if not ein or not oid or not batch:
                continue
            out.append(PfFiling(
                object_id=oid, ein=ein,
                tax_period=(row.get("TAX_PERIOD") or "").strip(),
                taxpayer_name=(row.get("TAXPAYER_NAME") or "").strip(),
                batch_id=batch,
            ))
    return out


def stage_batch(year: int, batch_id: str) -> staging.StagedFile:
    # The 2024 index writes some batch ids lowercase ('2024_TEOS_XML_05a')
    # while the published zips are uppercase ('...05A.zip') — normalize.
    batch = batch_id.strip().upper()
    return staging.stage_download(
        DATASET, BATCH_URL.format(year=year, batch=batch),
        filename=f"{batch}.zip", timeout=600.0,
    )


def stage_all(years: tuple[int, ...]) -> None:
    for year in years:
        filings = load_pf_index(year)
        batches = sorted({f.batch_id for f in filings})
        print(f"{year}: {len(filings):,} 990-PF filings across {len(batches)} batches")
        for b in batches:
            s = stage_batch(year, b)
            print(f"  {s.path.name}  {s.byte_size:,}")


@dataclass
class Parsed:
    officers: list[tuple] = field(default_factory=list)   # (ein, name, norm, title, natural_key)
    grants: list[tuple] = field(default_factory=list)     # (ein, key, locator, recipient, city, state, purpose, amt, fy)


def _text(el, *names) -> str | None:
    for name in names:
        found = el.find(NS + name)
        if found is not None and found.text and found.text.strip():
            return found.text.strip()
    return None


def parse_filing(data: bytes, filing: PfFiling) -> Parsed:
    p = Parsed()
    root = etree.fromstring(data)
    ret_data = root.find(f"{NS}ReturnData")
    pf = ret_data.find(f"{NS}IRS990PF") if ret_data is not None else None
    if pf is None:
        return p
    fy = int(filing.tax_period[:4]) if filing.tax_period[:4].isdigit() else None

    info = pf.find(f"{NS}OfficerDirTrstKeyEmplInfoGrp")
    if info is not None:
        seen: set[str] = set()
        for grp in info.findall(f"{NS}OfficerDirTrstKeyEmplGrp"):
            name = _text(grp, "PersonNm")
            if not name:
                continue
            norm = normalize_name(name)
            key = f"irs990pf:{filing.ein}:{norm}"
            if key in seen:
                continue
            seen.add(key)
            p.officers.append((filing.ein, name.title(), norm, _text(grp, "TitleTxt"), key))

    supp = pf.find(f"{NS}SupplementaryInformationGrp")
    if supp is not None:
        for i, grp in enumerate(supp.findall(f"{NS}GrantOrContributionPdDurYrGrp")):
            recipient = _text(grp, "RecipientPersonNm")
            if recipient is None:
                biz = grp.find(f"{NS}RecipientBusinessName")
                if biz is not None:
                    recipient = _text(biz, "BusinessNameLine1Txt", "BusinessNameLine1")
            if not recipient:
                continue
            addr = grp.find(f"{NS}RecipientUSAddress")
            city = _text(addr, "CityNm") if addr is not None else None
            state = _text(addr, "StateAbbreviationCd") if addr is not None else None
            p.grants.append((
                filing.ein,
                f"irs990pf:{filing.object_id}:grant:{i}",
                f"xpath:/Return/ReturnData/IRS990PF/SupplementaryInformationGrp/"
                f"GrantOrContributionPdDurYrGrp[{i + 1}]",
                recipient[:500], city, state,
                _text(grp, "GrantOrContributionPurposeTxt"),
                parse_amount(_text(grp, "Amt") or ""),
                fy,
            ))
    return p


_ORG_STAGE_DDL = """
create temp table _pf_orgs (
  ein        text primary key,
  name       text not null,
  name_norm  text not null
) on commit drop
"""

_PEOPLE_STAGE_DDL = """
create temp table _pf_people (
  natural_key text primary key,
  ein         text not null,
  full_name   text not null,
  title       text
) on commit drop
"""

_GRANT_STAGE_DDL = """
create temp table _pf_grants (
  record_key text primary key,
  ein        text not null,
  locator    text not null,
  recipient  text not null,
  city       text,
  state      text,
  purpose    text,
  amount     numeric,
  fy         smallint
) on commit drop
"""


def _load_batch(conn, raw_file_id: int, filings: list[PfFiling], parsed: list[Parsed]) -> dict:
    counts = {"orgs_created": 0, "people": 0, "relationships": 0, "grants": 0}
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute(_ORG_STAGE_DDL)
        cur.execute(_PEOPLE_STAGE_DDL)
        cur.execute(_GRANT_STAGE_DDL)

        by_ein = {f.ein: f for f in filings}
        with cur.copy("copy _pf_orgs (ein, name, name_norm) from stdin") as copy:
            for ein, f in by_ein.items():
                name = f.taxpayer_name or f"EIN {ein}"
                copy.write_row((ein, name.title(), normalize_name(name)))

        seen_people: set[str] = set()
        with cur.copy("copy _pf_people (natural_key, ein, full_name, title) from stdin") as copy:
            for p in parsed:
                for ein, name, _norm, title, key in p.officers:
                    if key in seen_people:
                        continue
                    seen_people.add(key)
                    copy.write_row((key, ein, name, title))

        with cur.copy(
            "copy _pf_grants (record_key, ein, locator, recipient, city, state,"
            " purpose, amount, fy) from stdin"
        ) as copy:
            for p in parsed:
                for ein, key, locator, recipient, city, state, purpose, amt, fy in p.grants:
                    copy.write_row((key, ein, locator, recipient, city, state,
                                    purpose, amt, fy))

        cur.execute("analyze _pf_orgs"); cur.execute("analyze _pf_people")
        cur.execute("analyze _pf_grants")

        # Foundations present in filings but missing from BMF (new/terminated).
        cur.execute("""
            with new_rows as (
              select s.* from _pf_orgs s
              where not exists (
                select 1 from internal.org_identifiers oi
                where oi.id_type = 'ein' and oi.id_value = s.ein)
            ), ins as (
              insert into internal.organizations
                (name, name_normalized, org_type,
                 raw_file_id, source_record_locator, last_verified_at)
              select name, name_norm, 'private_foundation',
                     %(rfid)s, 'row:EIN=' || ein, now()
              from new_rows
              returning id, source_record_locator
            )
            insert into internal.org_identifiers
              (org_id, id_type, id_value, raw_file_id, source_record_locator)
            select id, 'ein', substring(source_record_locator from 9),
                   %(rfid)s, source_record_locator
            from ins
        """, {"rfid": raw_file_id})
        counts["orgs_created"] = cur.rowcount

        cur.execute("""
            insert into internal.people
              (full_name, primary_org_id, primary_title, source_natural_key,
               raw_file_id, source_record_locator)
            select s.full_name, oi.org_id, s.title, s.natural_key,
                   %(rfid)s, 'officer:' || s.natural_key
            from _pf_people s
            join internal.org_identifiers oi
              on oi.id_type = 'ein' and oi.id_value = s.ein
            on conflict (source_natural_key) where source_natural_key is not null
            do update set primary_title = excluded.primary_title,
                          raw_file_id = excluded.raw_file_id
        """, {"rfid": raw_file_id})
        counts["people"] = cur.rowcount

        cur.execute("""
            insert into internal.relationships
              (from_person_id, to_org_id, rel_type, title, confidence,
               raw_file_id, source_record_locator)
            select p.id, oi.org_id, 'officer_of', s.title, 1.0,
                   %(rfid)s, 'officer:' || s.natural_key
            from _pf_people s
            join internal.people p on p.source_natural_key = s.natural_key
            join internal.org_identifiers oi
              on oi.id_type = 'ein' and oi.id_value = s.ein
            on conflict on constraint uq_rel do nothing
        """, {"rfid": raw_file_id})
        counts["relationships"] = cur.rowcount

        cur.execute("""
            insert into internal.funding_events
              (event_type, funder_org_id, recipient_name, recipient_city,
               recipient_state, fiscal_year, amount, purpose_text,
               source_record_key, raw_file_id, source_record_locator)
            select 'grant', oi.org_id, s.recipient, s.city, s.state,
                   s.fy, s.amount, s.purpose,
                   s.record_key, %(rfid)s, s.locator
            from _pf_grants s
            join internal.org_identifiers oi
              on oi.id_type = 'ein' and oi.id_value = s.ein
            on conflict (source_record_key) do nothing
        """, {"rfid": raw_file_id})
        counts["grants"] = cur.rowcount

        cur.execute("""
            insert into internal.processed_filings
              (object_id, ein, return_type, tax_period, raw_file_id)
            select unnest(%(oids)s::text[]), unnest(%(eins)s::text[]), '990PF',
                   unnest(%(periods)s::text[]), %(rfid)s
            on conflict (object_id) do nothing
        """, {
            "oids": [f.object_id for f in filings],
            "eins": [f.ein for f in filings],
            "periods": [f.tax_period for f in filings],
            "rfid": raw_file_id,
        })
    return counts


def _iter_wanted_members(path: Path, todo: list[PfFiling], totals: dict):
    """Yield (filing, xml_bytes) for the filings we need from a batch zip.

    Fast path: stdlib zipfile random access. Some IRS batches are entirely
    Deflate64 (compress type 9 — e.g. 2026_TEOS_XML_05A), which stdlib zipfile
    cannot decompress; those fall back to a sequential stream-unzip pass over
    the whole archive, keeping only wanted members.
    """
    wanted = {f.object_id: f for f in todo}
    with zipfile.ZipFile(path) as zf:
        infos = zf.infolist()
        deflate64 = any(i.compress_type == 9 for i in infos[:200])
        # 2024-era zips nest members in a '<batch>/' folder; 2025+ are flat.
        # Map basename -> full member path so both layouts resolve.
        member_by_base = {
            i.filename.rsplit("/", 1)[-1]: i.filename
            for i in infos if not i.is_dir()
        }
    present = {
        oid: (f, member_by_base[f"{oid}_public.xml"])
        for oid, f in wanted.items()
        if f"{oid}_public.xml" in member_by_base
    }
    if not present:
        return
    if not deflate64:
        with zipfile.ZipFile(path) as zf:
            for oid, (f, member) in present.items():
                try:
                    yield f, zf.read(member)
                except (NotImplementedError, zipfile.BadZipFile):
                    totals["member_errors"] += 1
        return

    # Deflate64 archive (e.g. 2026_TEOS_XML_05A). Prefer 7zz (C-speed random
    # access); fall back to a sequential stream-unzip pass (pure Python,
    # ~10min per 500MB archive).
    import shutil
    if shutil.which("7zz"):
        yield from _extract_via_7zz(path, present, totals)
        return

    from stream_unzip import stream_unzip

    by_base = {f"{oid}_public.xml": (oid, f) for oid, (f, _m) in present.items()}
    with path.open("rb") as fh:
        def chunks():
            while c := fh.read(1 << 20):
                yield c

        for name, _size, member_chunks in stream_unzip(chunks()):
            nm = name.decode("utf-8", "replace") if isinstance(name, bytes) else name
            base = nm.rsplit("/", 1)[-1]
            if base in by_base:
                yield by_base[base][1], b"".join(member_chunks)
            else:
                for _ in member_chunks:  # stream must be fully consumed
                    pass


def _extract_via_7zz(path: Path, present: dict[str, tuple[PfFiling, str]], totals: dict):
    """`present` maps object_id -> (filing, full member path inside the zip).
    7zz 'e' flattens on extraction, so outputs are basenames either way."""
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory(prefix="funderdb_7z_") as tmp:
        listfile = Path(tmp) / "members.txt"
        listfile.write_text("\n".join(member for _f, member in present.values()))
        outdir = Path(tmp) / "out"
        outdir.mkdir()
        subprocess.run(
            ["7zz", "e", str(path), f"-o{outdir}", f"@{listfile}", "-y", "-bso0", "-bsp0"],
            check=True, capture_output=True,
        )
        for oid, (f, _member) in present.items():
            out = outdir / f"{oid}_public.xml"
            if out.exists():
                yield f, out.read_bytes()
            else:
                totals["member_errors"] += 1


def ingest(years: tuple[int, ...] = (2026, 2025)) -> dict:
    totals: dict[str, int] = defaultdict(int)
    with connect() as conn:
        for year in years:
            filings = load_pf_index(year)
            with conn.cursor() as cur:
                cur.execute("select object_id from internal.processed_filings")
                done = {r[0] for r in cur.fetchall()}
            # The index's XML_BATCH_ID labels are unreliable (~30% of 05A-labeled
            # 2026 filings are physically elsewhere), so processing is
            # membership-driven: every remaining filing is offered to every
            # batch zip; each contributes what it actually contains.
            remaining = {f.object_id: f for f in filings if f.object_id not in done}
            batch_ids = sorted({f.batch_id for f in filings})

            for batch_id in batch_ids:
                todo = list(remaining.values())
                if not todo:
                    totals["batches_skipped"] += 1
                    continue
                try:
                    staged = stage_batch(year, batch_id)
                except Exception as exc:
                    # Membership-driven processing tolerates a missing zip:
                    # other batches may carry the filings; the year-end missing
                    # count reports what nothing carried.
                    print(f"{batch_id}: download failed ({exc}) — skipping batch",
                          flush=True)
                    totals["batches_unavailable"] += 1
                    continue
                raw_file_id = staging.register_raw_file(
                    conn, staged, license_code="us_public_domain",
                    content_type="application/zip",
                )
                conn.commit()
                run_id = ledger.start_run(conn, raw_file_id, DATASET)
                try:
                    parsed: list[Parsed] = []
                    found: list[PfFiling] = []
                    for f, data in _iter_wanted_members(staged.path, todo, totals):
                        try:
                            parsed.append(parse_filing(data, f))
                            found.append(f)
                        except etree.XMLSyntaxError:
                            totals["xml_errors"] += 1
                    # Load in slices — one transaction per ~5k filings keeps
                    # WAL spikes small (a 39k-filing single transaction filled
                    # the disk faster than Supabase autoscaling could grow it).
                    chunk = 5000
                    agg: dict[str, int] = defaultdict(int)
                    for i in range(0, len(found), chunk):
                        counts = _load_batch(
                            conn, raw_file_id,
                            found[i:i + chunk], parsed[i:i + chunk],
                        )
                        conn.commit()
                        for k, v in counts.items():
                            agg[k] += v
                        for f in found[i:i + chunk]:
                            remaining.pop(f.object_id, None)
                    ledger.complete_run(
                        conn, run_id,
                        inserted=agg["grants"] + agg["people"],
                        notes=f"{batch_id}: {len(found)} filings; {dict(agg)}",
                    )
                    for k, v in agg.items():
                        totals[k] += v
                    totals["filings_processed"] += len(found)
                    print(f"{batch_id}: filings={len(found):,} {dict(agg)}", flush=True)
                except Exception as exc:
                    try:
                        conn.rollback()
                        ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                    except Exception:
                        pass
                    raise
            totals[f"missing_after_all_batches_{year}"] = len(remaining)
    return dict(totals)
