"""Form 990 core-form financials — the public-charity side of the filing layer.

1,881,691 Form 990 filings sat in the spine carrying grants (Schedule I) but
no financials at all, so every charity profile showed em-dashes where revenue,
expenses and net assets belong. That is the gap that made "a foundation
vetting a nonprofit" the weakest direction in the product.

Design note that makes everything downstream free: the 990's Part I summary
lines map onto columns internal.filing_financials ALREADY has, under names
that were return-type-agnostic from the start (total_revenue, total_expenses,
total_assets_eoy, net_assets_eoy...). So mv_org_latest_financials, the browse
distributions screen, the UI's financial trends and the CC-BY export all light
up for charities with no change. Only genuinely 990-specific concepts —
the Part IX functional-expense split above all — needed new columns (0021).

Scope: Part I summary, Part VIII revenue rollups, Part IX functional expenses,
Part X balance sheet, Part VII Section A officers. NOT Schedule I (that is
irs_990_sched_i's job and already ran), not Schedule J detail, not the
narrative parts.

Runs only over ALREADY-STAGED zips and never inserts grant rows.
"""

from __future__ import annotations

from collections import defaultdict

from lxml import etree

from .. import ledger
from ..db import connect
from .irs_990pf import (
    NS,
    Parsed,
    PfFiling,
    _int,
    _iter_wanted_members,
    _load_details,
    _raw_file_id_for_zip,
    _staged_zip,
    _text,
    batch_ids_for,
    load_index,
)

# filing_financials column -> (group or None, element). Group None = a direct
# child of IRS990. Verified against real 2025 filings.
F990_FIELDS: list[tuple[str, str | None, str]] = [
    # Part I summary — these land in the SHARED columns, which is what makes
    # every downstream consumer work unchanged.
    ("total_revenue",                 None, "CYTotalRevenueAmt"),
    ("total_expenses",                None, "CYTotalExpensesAmt"),
    ("contributions_received",        None, "CYContributionsGrantsAmt"),
    ("contributions_paid",            None, "CYGrantsAndSimilarPaidAmt"),
    ("excess_revenue_over_expenses",  None, "CYRevenuesLessExpensesAmt"),
    ("other_salaries",                None, "CYSalariesCompEmpBnftPaidAmt"),
    ("other_expenses",                None, "CYOtherExpensesAmt"),
    # Part X balance sheet (direct children on the 990, unlike the 990-PF
    # where they sit inside Form990PFBalanceSheetsGrp).
    ("total_assets_boy",              None, "TotalAssetsBOYAmt"),
    ("total_assets_eoy",              None, "TotalAssetsEOYAmt"),
    ("total_liabilities_boy",         None, "TotalLiabilitiesBOYAmt"),
    ("total_liabilities_eoy",         None, "TotalLiabilitiesEOYAmt"),
    ("net_assets_boy",                None, "NetAssetsOrFundBalancesBOYAmt"),
    ("net_assets_eoy",                None, "NetAssetsOrFundBalancesEOYAmt"),
    # 990-specific revenue detail
    ("program_service_revenue",       None, "CYProgramServiceRevenueAmt"),
    ("investment_income",             None, "CYInvestmentIncomeAmt"),
    ("other_revenue",                 None, "CYOtherRevenueAmt"),
    ("unrelated_business_revenue",    "TotalRevenueGrp", "UnrelatedBusinessRevenueAmt"),
    # Part IX functional expenses — the vetting ratio
    ("expenses_program_services",     "TotalFunctionalExpensesGrp", "ProgramServicesAmt"),
    ("expenses_management",           "TotalFunctionalExpensesGrp", "ManagementAndGeneralAmt"),
    ("expenses_fundraising",          "TotalFunctionalExpensesGrp", "FundraisingAmt"),
    # Headcount + compensation totals
    ("total_employees",               None, "TotalEmployeeCnt"),
    ("total_volunteers",              None, "TotalVolunteersCnt"),
    ("total_reportable_comp",         None, "TotalReportableCompFromOrgAmt"),
]
F990_COLUMNS = [c for c, _, _ in F990_FIELDS]


def parse_filing_990_detail(data: bytes, filing: PfFiling) -> Parsed:
    """Financials + Part VII officers + header for one Form 990.

    Returns the same Parsed shape the 990-PF path uses, so _load_details
    (irs_990pf) writes it with no branching. grants/future_grants/contributors
    stay empty: Schedule I is a separate, already-completed pass and Schedule B
    contributor detail is redacted for public charities.
    """
    from .irs_990pf import _parse_header

    p = Parsed()
    root = etree.fromstring(data)
    ret_data = root.find(f"{NS}ReturnData")
    f990 = ret_data.find(f"{NS}IRS990") if ret_data is not None else None
    if f990 is None:
        return p

    p.header = _parse_header(root, f990)

    groups: dict[str, object] = {}
    for _, g, _ in F990_FIELDS:
        if g is not None and g not in groups:
            groups[g] = f990.find(NS + g)
    p.fin = {}
    for col, g, name in F990_FIELDS:
        parent = f990 if g is None else groups[g]
        p.fin[col] = _int(parent, name) if parent is not None else None

    # Part VII Section A: officers, directors, trustees and key employees.
    for seq, grp in enumerate(f990.findall(f"{NS}Form990PartVIISectionAGrp")):
        name = _text(grp, "PersonNm")
        business = None
        if name is None:
            biz = grp.find(f"{NS}BusinessName")
            if biz is not None:
                business = _text(biz, "BusinessNameLine1Txt", "BusinessNameLine1")
        if not name and not business:
            continue
        hours = _text(grp, "AverageHoursPerWeekRt")
        if hours is not None:
            try:
                if abs(float(hours)) >= 1_000_000:
                    hours = None
            except ValueError:
                hours = None
        p.filing_officers.append((
            seq, name.title() if name else None, business,
            _text(grp, "TitleTxt"), hours,
            _int(grp, "ReportableCompFromOrgAmt"),
            _int(grp, "OtherCompensationAmt"),
            None,  # expense_account: not reported on Form 990 Part VII
            _int(grp, "ReportableCompFromRltdOrgAmt"),
        ))
    return p


def reparse_details(years: tuple[int, ...] = (2026, 2025, 2024)) -> dict:
    """Core-form financial pass over ALREADY-STAGED zips, newest-first.

    Never downloads, never touches grant rows. Idempotent via
    filings.details_parsed_at, which is disjoint from the 990-PF pass because
    the two filter on different return_types.
    """
    totals: dict[str, int] = defaultdict(int)
    with connect() as conn:
        for year in years:
            idx = load_index(year, return_type="990")
            with conn.cursor() as cur:
                cur.execute("""
                    select object_id from internal.filings
                    where return_type = '990' and details_parsed_at is null""")
                todo_set = {r[0] for r in cur.fetchall()}
            remaining = {f.object_id: f for f in idx if f.object_id in todo_set}
            totals[f"todo_{year}"] = len(remaining)
            for batch_id in batch_ids_for(year, idx):
                if not remaining:
                    break
                path = _staged_zip(batch_id)
                if path is None:
                    totals["zips_not_staged"] += 1
                    continue
                todo = list(remaining.values())
                raw_file_id = _raw_file_id_for_zip(conn, path, year, batch_id)
                run_id = ledger.start_run(conn, raw_file_id, "irs_990_xml")
                try:
                    parsed: list[Parsed] = []
                    found: list[PfFiling] = []
                    errors: list[tuple[PfFiling, str]] = []
                    for f, data in _iter_wanted_members(path, todo, totals):
                        try:
                            parsed.append(parse_filing_990_detail(data, f))
                            found.append(f)
                        except etree.XMLSyntaxError as exc:
                            errors.append((f, f"XMLSyntaxError: {exc}"))
                            totals["xml_errors"] += 1
                    chunk = 5000
                    agg: dict[str, int] = defaultdict(int)
                    for i in list(range(0, len(found), chunk)) or [0]:
                        with conn.cursor() as cur:
                            cur.execute("set local statement_timeout = '30min'")
                            counts = _load_details(
                                cur, raw_file_id, found[i:i + chunk],
                                parsed[i:i + chunk],
                                errors=errors if i == 0 else [],
                                update_grants=False,
                                fin_columns=F990_COLUMNS)
                        conn.commit()
                        for k, v in counts.items():
                            agg[k] += v
                        for f in found[i:i + chunk]:
                            remaining.pop(f.object_id, None)
                    for f, _e in errors:
                        remaining.pop(f.object_id, None)
                    ledger.complete_run(
                        conn, run_id, inserted=agg["financials"],
                        notes=f"{batch_id} 990-detail: {len(found)} filings; "
                              f"{dict(agg)}; xml_errors={len(errors)}")
                    for k, v in agg.items():
                        totals[k] += v
                    totals["filings_detailed"] += len(found)
                    print(f"{batch_id}: 990 detail filings={len(found):,} {dict(agg)}",
                          flush=True)
                except Exception as exc:
                    try:
                        conn.rollback()
                        ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                    except Exception:
                        pass
                    raise
            totals[f"detail_pending_after_{year}"] = len(remaining)
    return dict(totals)
