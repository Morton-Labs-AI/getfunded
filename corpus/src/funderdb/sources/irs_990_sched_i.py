"""IRS 990 (public charity) Schedule I ingest — grants to domestic orgs.

Shares DATASET='irs_990_xml' with the 990-PF loader: the same index CSVs,
the same batch zips (every TEOS batch carries both return types — measured
2026-07-29 across all staged indexes), the same staging area. After the PF
back-years run, this loader needs ZERO new downloads.

Verified element paths (TY2015+ MeF schema, single namespace):
  ReturnData/IRS990ScheduleI/RecipientTable ->
    RecipientBusinessName/BusinessNameLine1Txt (fallback BusinessNameLine1),
    RecipientEIN (older vintages: EINOfRecipient),
    USAddress (CityNm, StateAbbreviationCd),
    CashGrantAmt, NonCashAssistanceAmt, PurposeOfGrantTxt
  Cross-check accumulator: ReturnData/IRS990/CYGrantsAndSimilarPaidAmt
  (reported skew, never a per-filing gate).

Scope decisions (per the Phase-2 plan):
- Filer slice IS the Schedule I presence: filings without a RecipientTable
  parse to zero grants and are marked processed (re-runs skip them).
- Mega-DAF sponsors (Fidelity/Schwab/Vanguard Charitable, National
  Philanthropic Trust) are excluded by EIN — resolved from the DB at run
  time, never hard-coded — and deferred to Phase 3.
- Filers with > 50,000 recipient rows are skipped but marked processed
  (Phase 3 targets those object_ids explicitly).
- Part III (grants to individuals) is out of scope: no recipient orgs.
- Schedule I carries the recipient EIN -> recipient_org_id is set directly
  at load (source-asserted, the crosswalk's confidence-1.0 standard);
  EIN-less rows stay NULL for the deterministic name tiers.
- No officer parsing (990 Part VII is out of G5 scope).
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from lxml import etree

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..normalize import normalize_ein, normalize_name, parse_amount
from .irs_990pf import (DATASET, NS, PfFiling, _iter_wanted_members, _text,
                        batch_ids_for, canonical_batch, load_index, stage_batch)

ROW_CAP = 50_000

MEGA_DAF_NAME_PATTERNS = [
    "%fidelity%charitable%",
    "%schwab charitable%",
    "%vanguard charitable%",
    "%national philanthropic trust%",
]


def mega_daf_eins(conn) -> set[str]:
    """Sponsor EINs resolved from the DB by name — never hard-coded."""
    with conn.cursor() as cur:
        cur.execute("""
            select distinct i.id_value
            from internal.organizations o
            join internal.org_identifiers i
              on i.org_id = o.id and i.id_type = 'ein'
            where o.name ilike any (%s)""", (MEGA_DAF_NAME_PATTERNS,))
        return {r[0] for r in cur.fetchall()}


@dataclass
class ParsedSchedI:
    # (ein, key, locator, recipient, recipient_ein, city, state, purpose, amt, fy)
    grants: list[tuple] = field(default_factory=list)
    reported_total: int = 0
    over_cap: bool = False


def parse_filing_990(data: bytes, filing: PfFiling) -> ParsedSchedI:
    p = ParsedSchedI()
    root = etree.fromstring(data)
    ret_data = root.find(f"{NS}ReturnData")
    if ret_data is None:
        return p
    main = ret_data.find(f"{NS}IRS990")
    if main is not None:
        reported = parse_amount(_text(main, "CYGrantsAndSimilarPaidAmt") or "")
        if reported:
            p.reported_total = int(reported)
    schedi = ret_data.find(f"{NS}IRS990ScheduleI")
    if schedi is None:
        return p
    rows = schedi.findall(f"{NS}RecipientTable")
    if len(rows) > ROW_CAP:
        p.over_cap = True
        return p
    fy = int(filing.tax_period[:4]) if filing.tax_period[:4].isdigit() else None
    for i, grp in enumerate(rows):
        biz = grp.find(f"{NS}RecipientBusinessName")
        recipient = _text(biz, "BusinessNameLine1Txt", "BusinessNameLine1") \
            if biz is not None else None
        if not recipient:
            continue
        cash = parse_amount(_text(grp, "CashGrantAmt") or "")
        noncash = parse_amount(_text(grp, "NonCashAssistanceAmt") or "")
        # Cash + non-cash; NULL when the filing reports neither.
        amount = (cash or 0) + (noncash or 0) if (cash or noncash) else None
        addr = grp.find(f"{NS}USAddress")
        p.grants.append((
            filing.ein,
            f"irs990:{filing.object_id}:schedi:{i}",
            f"xpath:/Return/ReturnData/IRS990ScheduleI/RecipientTable[{i + 1}]",
            recipient[:500],
            normalize_ein(_text(grp, "RecipientEIN", "EINOfRecipient") or "") or None,
            _text(addr, "CityNm") if addr is not None else None,
            _text(addr, "StateAbbreviationCd") if addr is not None else None,
            _text(grp, "PurposeOfGrantTxt"),
            amount,
            fy,
        ))
    return p


_ORG_STAGE_DDL = """
create temp table _si_orgs (
  ein        text primary key,
  name       text not null,
  name_norm  text not null
) on commit drop
"""

_GRANT_STAGE_DDL = """
create temp table _si_grants (
  record_key    text primary key,
  ein           text not null,
  locator       text not null,
  recipient     text not null,
  recipient_ein text,
  city          text,
  state         text,
  purpose       text,
  amount        numeric,
  fy            smallint
) on commit drop
"""


def _load_batch(conn, raw_file_id: int, filings: list[PfFiling],
                parsed: list[ParsedSchedI]) -> dict:
    counts = {"orgs_created": 0, "grants": 0, "grants_ein_resolved": 0}
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute(_ORG_STAGE_DDL)
        cur.execute(_GRANT_STAGE_DDL)

        by_ein = {f.ein: f for f in filings}
        with cur.copy("copy _si_orgs (ein, name, name_norm) from stdin") as copy:
            for ein, f in by_ein.items():
                name = f.taxpayer_name or f"EIN {ein}"
                copy.write_row((ein, name.title(), normalize_name(name)))

        with cur.copy(
            "copy _si_grants (record_key, ein, locator, recipient, recipient_ein,"
            " city, state, purpose, amount, fy) from stdin"
        ) as copy:
            for p in parsed:
                # Parse tuples lead with the filer EIN; the stage table leads
                # with record_key — unpack and reorder (the raw tuple once
                # went straight through and EINs collided in the key column).
                for (ein, key, locator, recipient, r_ein, city, state,
                     purpose, amount, fy) in p.grants:
                    copy.write_row((key, ein, locator, recipient, r_ein,
                                    city, state, purpose, amount, fy))

        cur.execute("analyze _si_orgs")

        cur.execute("analyze _si_grants")

        # Filers missing from the BMF spine — created as public charities
        # (990 filers are not PFs; existing EINs are reused as-is, never
        # demoted, per the G3 rule).
        cur.execute("""
            with new_rows as (
              select s.* from _si_orgs s
              where not exists (
                select 1 from internal.org_identifiers oi
                where oi.id_type = 'ein' and oi.id_value = s.ein)
            ), ins as (
              insert into internal.organizations
                (name, name_normalized, org_type,
                 raw_file_id, source_record_locator, last_verified_at)
              select name, name_norm, 'public_charity',
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

        # recipient_org_id resolves directly through the filer-asserted EIN;
        # the left join keeps EIN-less rows for the name tiers. No stub orgs:
        # an EIN absent from org_identifiers stays unresolved.
        cur.execute("""
            insert into internal.funding_events
              (event_type, funder_org_id, recipient_org_id, recipient_name,
               recipient_city, recipient_state, fiscal_year, amount,
               purpose_text, source_record_key, raw_file_id,
               source_record_locator)
            select 'grant', oi.org_id, ri.org_id, s.recipient, s.city, s.state,
                   s.fy, s.amount, s.purpose,
                   s.record_key, %(rfid)s, s.locator
            from _si_grants s
            join internal.org_identifiers oi
              on oi.id_type = 'ein' and oi.id_value = s.ein
            left join internal.org_identifiers ri
              on ri.id_type = 'ein' and ri.id_value = s.recipient_ein
            on conflict (source_record_key) do nothing
        """, {"rfid": raw_file_id})
        counts["grants"] = cur.rowcount

        cur.execute("""
            select count(*) from _si_grants s
            join internal.org_identifiers ri
              on ri.id_type = 'ein' and ri.id_value = s.recipient_ein""")
        counts["grants_ein_resolved"] = cur.fetchone()[0]

        # Spine rows (index-only) already exist — flip their marker; keep the
        # original zip pointer on rows a previous grants pass already saw.
        cur.execute("""
            insert into internal.filings as f
              (object_id, ein, return_type, tax_period, raw_file_id,
               grants_processed_at)
            select unnest(%(oids)s::text[]), unnest(%(eins)s::text[]), '990',
                   unnest(%(periods)s::text[]), %(rfid)s, now()
            on conflict (object_id) do update set
              grants_processed_at = coalesce(f.grants_processed_at, now()),
              raw_file_id = case when f.grants_processed_at is null
                                 then excluded.raw_file_id
                                 else f.raw_file_id end
        """, {
            "oids": [f.object_id for f in filings],
            "eins": [f.ein for f in filings],
            "periods": [f.tax_period for f in filings],
            "rfid": raw_file_id,
        })
    return counts


def _staged_zip(batch_id: str):
    """Already-staged batch zip path, or None — never downloads (dry-run)."""
    settings = get_settings()
    dest = settings.raw_dir / DATASET
    hits = sorted(p for p in dest.glob(f"*_{canonical_batch(batch_id)}.zip")
                  if not p.name.startswith(".partial"))
    return hits[-1] if hits else None


def dry_run(years: tuple[int, ...], limit: int | None = None) -> dict:
    """Measure Schedule I prevalence over ALREADY-STAGED zips. No DB, no
    downloads (missing zips are counted, not fetched)."""
    totals: dict[str, int] = defaultdict(int)
    dist: list[int] = []
    for year in years:
        filings = load_index(year, return_type="990")
        totals[f"indexed_990_{year}"] = len(filings)
        batch_ids = batch_ids_for(year, filings)
        remaining = {f.object_id: f for f in filings}
        for batch_id in batch_ids:
            path = _staged_zip(batch_id)
            if path is None:
                totals["zips_not_staged"] += 1
                continue
            todo = list(remaining.values())
            if not todo:
                break
            for f, data in _iter_wanted_members(path, todo, totals):
                remaining.pop(f.object_id, None)
                try:
                    p = parse_filing_990(data, f)
                except etree.XMLSyntaxError:
                    totals["xml_errors"] += 1
                    continue
                totals["filings_scanned"] += 1
                if p.over_cap:
                    totals["filers_over_50k"] += 1
                elif p.grants:
                    totals["schedi_filings"] += 1
                    totals["recipient_rows"] += len(p.grants)
                    totals["rows_with_ein"] += sum(1 for g in p.grants if g[4])
                    dist.append(len(p.grants))
                if limit and totals["filings_scanned"] >= limit:
                    break
            if limit and totals["filings_scanned"] >= limit:
                break
    if dist:
        dist.sort()
        totals["rows_per_schedi_filing_p50"] = dist[len(dist) // 2]
        totals["rows_per_schedi_filing_p99"] = dist[int(len(dist) * 0.99)]
        totals["rows_per_schedi_filing_max"] = dist[-1]
    return dict(totals)


def ingest(years: tuple[int, ...] = (2026, 2025)) -> dict:
    totals: dict[str, int] = defaultdict(int)
    with connect() as conn:
        daf_eins = mega_daf_eins(conn)
        totals["mega_daf_eins_resolved"] = len(daf_eins)
        for year in years:
            filings = load_index(year, return_type="990")
            with conn.cursor() as cur:
                cur.execute("select object_id from internal.filings "
                            "where grants_processed_at is not null")
                done = {r[0] for r in cur.fetchall()}
            skipped_daf = [f for f in filings
                           if f.ein in daf_eins and f.object_id not in done]
            totals["mega_daf_skipped"] += len(skipped_daf)
            remaining = {
                f.object_id: f for f in filings
                if f.object_id not in done and f.ein not in daf_eins
            }
            batch_ids = batch_ids_for(year, filings)

            for batch_id in batch_ids:
                todo = list(remaining.values())
                if not todo:
                    totals["batches_skipped"] += 1
                    continue
                try:
                    staged = stage_batch(year, batch_id)
                except Exception as exc:
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
                    parsed: list[ParsedSchedI] = []
                    found: list[PfFiling] = []
                    reported_sum = 0
                    for f, data in _iter_wanted_members(staged.path, todo, totals):
                        try:
                            p = parse_filing_990(data, f)
                        except etree.XMLSyntaxError:
                            totals["xml_errors"] += 1
                            continue
                        if p.over_cap:
                            totals["filers_skipped_over_50k"] += 1
                        reported_sum += p.reported_total
                        parsed.append(p)
                        found.append(f)
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
                        conn, run_id, inserted=agg["grants"],
                        notes=f"{batch_id} schedI: {len(found)} filings; "
                              f"{dict(agg)}; reported_total={reported_sum}",
                    )
                    for k, v in agg.items():
                        totals[k] += v
                    totals["filings_processed"] += len(found)
                    print(f"{batch_id}: filings={len(found):,} {dict(agg)}",
                          flush=True)
                except Exception as exc:
                    try:
                        conn.rollback()
                        ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                    except Exception:
                        pass
                    raise
            totals[f"missing_after_all_batches_{year}"] = len(remaining)
        # Amended-return supersession + org_id backfill + MV refresh.
        from .irs_filings import reconcile

        for k, v in reconcile(conn).items():
            totals[f"reconcile_{k}"] = v
    return dict(totals)
