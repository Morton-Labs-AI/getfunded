"""IRS 990-PF bulk XML e-file ingest — the full filing layer.

Index-driven (never glob the zips):
  https://apps.irs.gov/pub/epostcard/990/xml/{YEAR}/index_{YEAR}.csv
  -> filter RETURN_TYPE='990PF', group by XML_BATCH_ID, fetch only PF-bearing
  batch zips, extract only needed {OBJECT_ID}_public.xml members.

Extraction (element names verified against real filings; see FIN_FIELDS):
  financials: Part I/II/III/VI/X/XI/XII/XIII/XV -> internal.filing_financials
  header:     ReturnHeader (period dates, filer phone/address, signing officer)
              + accounting method + AmendedReturnInd -> internal.filings
  officers:   OfficerDirTrstKeyEmplGrp -> PersonNm|BusinessName, TitleTxt,
              AverageHrsPerWkDevotedToPosRt, CompensationAmt, benefits,
              expense account -> internal.filing_officers (corporate trustees
              stay here — never in internal.people); persons also feed the
              people/relationships pipeline as before
  grants:     GrantOrContributionPdDurYrGrp -> recipient (US+foreign address,
              zip, country), purpose, Amt, foundation status, relationship
  commitments: GrantOrContriApprvForFutGrp -> event_type 'grant_commitment'
  Schedule B: ContributorInformationGrp -> internal.filing_contributors
              (unredacted in public 990-PF XML)
  Part XV:    ApplicationSubmissionInfoGrp -> internal.filing_application_info

Idempotency: internal.filings.grants_processed_at (object_id pk) — filings are
immutable (amendments get a NEW object_id; supersession is irs_filings.
reconcile()'s job); marker set => skip. Spine rows loaded from index CSVs
alone have the marker NULL and are picked up here. One transaction per ~5k
filings. Grants carry NO raw_source (high volume); locator identifies the XML
element path.
"""

from __future__ import annotations

import csv
import re
import zipfile
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
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

# ---------------------------------------------------------------------------
# Index years 2017-2020 ("legacy" years).
#
# From 2021 the IRS names every zip {YEAR}_TEOS_XML_{NN}{A-H}.zip and
# probe_batches() can find them. The four years before that use two older
# schemes whose names cannot be guessed, so they are recorded here: zip stem
# -> size in bytes, HEAD-checked against apps.irs.gov on 2026-10-08. The IRS
# downloads page lists the 2019 and 2020 files; the 2017 and 2018 files are no
# longer listed there but are still served. The 2016 files are gone.
#
#   download990xml_{YEAR}_{N}.zip   the year's returns, in object-id order
#   {YEAR}_TEOS_XML_CT{N}.zip       later additions for the same year
#
# Measured on the real files (docs/DATA-SOURCES.md has the numbers):
#   * members are flat `{OBJECT_ID}_public.xml`, the 2025+ layout;
#   * a zip holds returns by OBJECT-ID year, not by index year. Index year Y
#     also lists the returns posted early in Y whose object ids start with
#     Y-1, and those sit in the Y-1 zips. So a legacy index is complete only
#     after the previous year's zips were read as well;
#   * 2018_TEOS_XML_CT1, 2018_TEOS_XML_CT3 and 2020_TEOS_XML_CT1 are Deflate64
#     (see _iter_wanted_members); every other legacy zip is plain Deflate;
#   * the 2020 zips hold about 47,750 990-PF returns that are in no index at
#     all (the 2020 index stops listing 990-PFs in late September 2020).
# The main zips come first on purpose: the CT zips mostly repeat them.
# ---------------------------------------------------------------------------
LEGACY_BATCHES: dict[int, dict[str, int]] = {
    2020: {
        "download990xml_2020_1": 410_636_484,
        "download990xml_2020_2": 403_633_186,
        "download990xml_2020_3": 402_519_268,
        "download990xml_2020_4": 412_449_605,
        "download990xml_2020_5": 407_097_915,
        "download990xml_2020_6": 404_259_826,
        "download990xml_2020_7": 406_249_542,
        "download990xml_2020_8": 164_852_375,
        "2020_TEOS_XML_CT1": 374_013_631,
    },
    2019: {
        "download990xml_2019_1": 405_230_455,
        "download990xml_2019_2": 402_125_774,
        "download990xml_2019_3": 403_135_309,
        "download990xml_2019_4": 407_401_876,
        "download990xml_2019_5": 399_048_882,
        "download990xml_2019_6": 394_490_221,
        "download990xml_2019_7": 406_778_542,
        "download990xml_2019_8": 190_353_313,
        "2019_TEOS_XML_CT1": 15_817,
    },
    2018: {
        "download990xml_2018_1": 405_852_961,
        "download990xml_2018_2": 402_189_942,
        "download990xml_2018_3": 407_493_755,
        "download990xml_2018_4": 404_723_587,
        "download990xml_2018_5": 408_094_770,
        "download990xml_2018_6": 406_406_859,
        "download990xml_2018_7": 301_672_836,
        "2018_TEOS_XML_CT1": 408_154_337,
        "2018_TEOS_XML_CT2": 408_862_000,
        "2018_TEOS_XML_CT3": 420_140_132,
    },
    2017: {
        "download990xml_2017_1": 410_883_001,
        "download990xml_2017_2": 410_054_163,
        "download990xml_2017_3": 411_234_704,
        "download990xml_2017_4": 411_728_756,
        "download990xml_2017_5": 408_880_532,
        "download990xml_2017_6": 411_037_347,
        "download990xml_2017_7": 170_853_823,
        "2017_TEOS_XML_CT1": 23_112_306,
    },
}

# RETURN_TYPE codes the 2017-2020 indexes use for the two forms this pipeline
# loads. '990O' is a full Form 990 filed by an organization that is not a
# 501(c)(3); '990PR' (2020 index only, 30,085 rows) is a 990-PF published in
# 2020_TEOS_XML_CT1. Both were checked against ReturnTypeCd in the XML. From
# 2021 the index writes plain '990' and '990PF' for all of them.
INDEX_RETURN_TYPE_ALIASES = {"990PR": "990PF", "990O": "990"}

_YEAR_IN_NAME = re.compile(r"(?<!\d)(20\d\d)(?!\d)")


def canonical_return_type(raw: str | None) -> str:
    """The form an index RETURN_TYPE code stands for ('990PR' -> '990PF')."""
    rt = (raw or "").strip()
    return INDEX_RETURN_TYPE_ALIASES.get(rt, rt)


def canonical_batch(batch_id: str) -> str:
    """The zip stem as the IRS host spells it.

    TEOS labels are upper-case on the host while the 2024 index writes some of
    them lower-case ('2024_TEOS_XML_05a'). The legacy 'download990xml_...'
    stems are lower-case on the host, and the host is case-sensitive."""
    b = batch_id.strip()
    return b.lower() if b.lower().startswith("download990xml_") else b.upper()


def batch_year(batch_id: str, default: int) -> int:
    """The year folder a zip lives in. It is the year in the zip's own name,
    which for legacy zips can differ from the index year that needs it."""
    m = _YEAR_IN_NAME.search(batch_id)
    return int(m.group(1)) if m else default


def batch_url(batch_id: str, year: int) -> str:
    batch = canonical_batch(batch_id)
    return BATCH_URL.format(year=batch_year(batch, year), batch=batch)


def legacy_batches(year: int) -> list[str]:
    """Recorded zip stems for a legacy year, in processing order ([] from 2021)."""
    return list(LEGACY_BATCHES.get(year, ()))


@dataclass(frozen=True)
class PfFiling:
    object_id: str
    ein: str
    tax_period: str
    taxpayer_name: str
    batch_id: str


# The IRS appends to the CURRENT year's index as filings are processed and
# occasionally corrects past years, so index CSVs are mutable feeds. A current-
# year copy is re-checked weekly; past years quarterly.
INDEX_MAX_AGE_CURRENT = timedelta(days=7)
INDEX_MAX_AGE_PAST = timedelta(days=90)


def stage_index(year: int, refresh: bool = False) -> staging.StagedFile:
    current = year >= date.today().year
    return staging.stage_download(
        DATASET, INDEX_URL.format(year=year), filename=f"index_{year}.csv", timeout=300.0,
        mutable=True, refresh=refresh,
        max_age=INDEX_MAX_AGE_CURRENT if current else INDEX_MAX_AGE_PAST,
    )


def iter_index(year: int, refresh: bool = False):
    """Yield ``(form, PfFiling)`` for every usable row of one index CSV.

    ``form`` is the canonical return type (see INDEX_RETURN_TYPE_ALIASES), so
    callers compare against '990PF' / '990' whatever the index year wrote.
    Rows of forms the pipeline does not load ('990EZ', '990T', ...) are
    yielded too: the backfill needs to tell "indexed as another form" from
    "in no index at all"."""
    staged = stage_index(year, refresh=refresh)
    with staged.path.open(encoding="utf-8", errors="replace") as fh:
        for row in csv.DictReader(fh):
            ein = normalize_ein(row.get("EIN") or "")
            oid = (row.get("OBJECT_ID") or "").strip()
            if not ein or not oid:
                continue
            yield canonical_return_type(row.get("RETURN_TYPE")), PfFiling(
                object_id=oid, ein=ein,
                tax_period=(row.get("TAX_PERIOD") or "").strip(),
                taxpayer_name=(row.get("TAXPAYER_NAME") or "").strip(),
                batch_id=(row.get("XML_BATCH_ID") or "").strip(),
            )


def load_index(year: int, return_type: str = "990PF",
               refresh: bool = False) -> list[PfFiling]:
    """Index rows for one RETURN_TYPE. The Schedule I loader shares this with
    return_type='990'; PfFiling is return-type-agnostic.

    Pre-2024 indexes (2017-2023) carry NO XML_BATCH_ID column — those rows
    get batch_id='' and callers discover the batch zips via probe_batches()
    (processing is membership-driven anyway, so the label only enumerates
    downloads). The 2017-2020 indexes also spell two return types differently;
    iter_index() folds them in (990PR -> 990PF, 990O -> 990)."""
    return [f for form, f in iter_index(year, refresh=refresh) if form == return_type]


def load_pf_index(year: int, refresh: bool = False) -> list[PfFiling]:
    return load_index(year, return_type="990PF", refresh=refresh)


def probe_batches(year: int) -> list[str]:
    """Discover a year's batch zips by HEAD probe (pre-2024 indexes don't
    name them). Numbers are contiguous from 01; letters are contiguous per
    number (e.g. 11A-11D). Only a 200 counts — the IRS host 302s missing
    zips to an error page.

    2017-2020 use older names that follow no pattern, so they come from
    LEGACY_BATCHES instead of a probe. The previous year's zips are appended
    because they hold the returns a legacy index lists first (object ids that
    start with year-1); without them those rows would never find their XML."""
    import httpx

    if year in LEGACY_BATCHES:
        return legacy_batches(year) + legacy_batches(year - 1)

    found: list[str] = []
    with httpx.Client(headers={"User-Agent": get_settings().http_user_agent}, timeout=30.0,
                      follow_redirects=False) as client:
        for i in range(1, 31):
            first = f"{year}_TEOS_XML_{i:02d}A"
            if client.head(BATCH_URL.format(year=year, batch=first)).status_code != 200:
                break
            found.append(first)
            for letter in "BCDEFGH":
                batch = f"{year}_TEOS_XML_{i:02d}{letter}"
                if client.head(BATCH_URL.format(year=year, batch=batch)).status_code != 200:
                    break
                found.append(batch)
    return found


def batch_ids_for(year: int, filings: list[PfFiling]) -> list[str]:
    """Batch ids from the index when present; probed from the host when the
    index predates XML_BATCH_ID."""
    ids = sorted({f.batch_id for f in filings if f.batch_id})
    if ids:
        return ids
    ids = probe_batches(year)
    print(f"{year}: index carries no batch ids (pre-2024 layout); "
          f"probed {len(ids)} zips: {ids[:4]}…", flush=True)
    return ids


def stage_batch(year: int, batch_id: str) -> staging.StagedFile:
    # canonical_batch() fixes the case of the label (the 2024 index writes
    # some lower-case); batch_url() takes the year folder from the zip's own
    # name, which matters for legacy zips read on behalf of the next index.
    batch = canonical_batch(batch_id)
    return staging.stage_download(
        DATASET, batch_url(batch, year),
        filename=f"{batch}.zip", timeout=600.0,
    )


def stage_all(years: tuple[int, ...]) -> None:
    for year in years:
        filings = load_pf_index(year)
        batches = batch_ids_for(year, filings)
        print(f"{year}: {len(filings):,} 990-PF filings across {len(batches)} batches")
        for b in batches:
            s = stage_batch(year, b)
            print(f"  {s.path.name}  {s.byte_size:,}")


@dataclass
class Parsed:
    officers: list[tuple] = field(default_factory=list)   # people pipeline, PERSONS only: (ein, name, norm, title, natural_key)
    filing_officers: list[tuple] = field(default_factory=list)  # as-filed rows incl. corporate trustees
    grants: list[tuple] = field(default_factory=list)     # paid grants (see _GRANT_COLS)
    future_grants: list[tuple] = field(default_factory=list)   # Part XV approved-for-future -> grant_commitment
    contributors: list[tuple] = field(default_factory=list)    # Schedule B (unredacted for PFs)
    app_info: tuple | None = None                         # Part XV how-to-apply
    header: dict = field(default_factory=dict)            # ReturnHeader + accounting method + amended
    fin: dict = field(default_factory=dict)               # FIN_FIELDS column -> int


def _text(el, *names) -> str | None:
    for name in names:
        found = el.find(NS + name)
        if found is not None and found.text and found.text.strip():
            return found.text.strip()
    return None


def _int(el, *names) -> int | None:
    t = _text(el, *names)
    if t is None:
        return None
    try:
        return int(t)
    except ValueError:
        try:
            return int(float(t))
        except ValueError:
            return None


def _checked(el, name) -> bool:
    """MeF checkbox: element present (text 'X'/'1'/'true') means checked."""
    found = el.find(NS + name) if el is not None else None
    return found is not None and (found.text or "").strip() not in ("", "0", "false")


# ---------------------------------------------------------------------------
# Financial-statement map: filing_financials column -> (group, element).
# Group None = direct child of IRS990PF. Element names verified against real
# filings (a published 2024v5.2 return, object 202532979349100628, all 12 acceptance values +
# batch sweeps). The classic trap, preserved here so nobody "fixes" it:
# line-3 interest INCOME is InterestOnSavRevAndExpnssAmt;
# InterestRevAndExpnssAmt is line-17 interest EXPENSE.
# ---------------------------------------------------------------------------
_REV = "AnalysisOfRevenueAndExpenses"
_BAL = "Form990PFBalanceSheetsGrp"
FIN_FIELDS: list[tuple[str, str | None, str]] = [
    # Part I revenue (column (a) unless noted)
    ("contributions_received",       _REV, "ContriRcvdRevAndExpnssAmt"),
    ("interest_income",              _REV, "InterestOnSavRevAndExpnssAmt"),
    ("dividends",                    _REV, "DividendsRevAndExpnssAmt"),
    ("gross_rents",                  _REV, "GrossRentsRevAndExpnssAmt"),
    ("net_gain_sale_assets",         _REV, "NetGainSaleAstRevAndExpnssAmt"),
    ("gross_sales_price",            _REV, "GrossSalesPriceAmt"),
    ("capital_gain_net_income",      _REV, "CapGainNetIncmNetInvstIncmAmt"),
    ("other_income",                 _REV, "OtherIncomeRevAndExpnssAmt"),
    ("total_revenue",                _REV, "TotalRevAndExpnssAmt"),
    ("total_revenue_net_invst",      _REV, "TotalNetInvstIncmAmt"),
    ("total_revenue_adj_net",        _REV, "TotalAdjNetIncmAmt"),
    # Part I expenses
    ("officer_comp",                 _REV, "CompOfcrDirTrstRevAndExpnssAmt"),
    ("other_salaries",               _REV, "OthEmplSlrsWgsRevAndExpnssAmt"),
    ("pension_benefits",             _REV, "PensionEmplBnftRevAndExpnssAmt"),
    ("legal_fees",                   _REV, "LegalFeesRevAndExpnssAmt"),
    ("accounting_fees",              _REV, "AccountingFeesRevAndExpnssAmt"),
    ("other_prof_fees",              _REV, "OtherProfFeesRevAndExpnssAmt"),
    ("interest_expense",             _REV, "InterestRevAndExpnssAmt"),
    ("taxes",                        _REV, "TaxesRevAndExpnssAmt"),
    ("depreciation",                 _REV, "DeprecAndDpltnRevAndExpnssAmt"),
    ("occupancy",                    _REV, "OccupancyRevAndExpnssAmt"),
    ("travel_conferences",           _REV, "TravConfMeetingRevAndExpnssAmt"),
    ("printing_publications",        _REV, "PrintingAndPubRevAndExpnssAmt"),
    ("other_expenses",               _REV, "OtherExpensesRevAndExpnssAmt"),
    ("total_operating_expenses",     _REV, "TotOprExpensesRevAndExpnssAmt"),
    ("contributions_paid",           _REV, "ContriPaidRevAndExpnssAmt"),
    ("total_expenses",               _REV, "TotalExpensesRevAndExpnssAmt"),
    ("total_expenses_net_invst",     _REV, "TotalExpensesNetInvstIncmAmt"),
    ("charitable_disbursements",     _REV, "TotalExpensesDsbrsChrtblAmt"),
    ("excess_revenue_over_expenses", _REV, "ExcessRevenueOverExpensesAmt"),
    ("net_investment_income",        _REV, "NetInvestmentIncomeAmt"),
    ("adjusted_net_income",          _REV, "AdjustedNetIncomeAmt"),
    # Part II balance sheets
    ("total_assets_boy",             _BAL, "TotalAssetsBOYAmt"),
    ("total_assets_eoy",             _BAL, "TotalAssetsEOYAmt"),
    ("total_assets_eoy_fmv",         _BAL, "TotalAssetsEOYFMVAmt"),
    ("total_liabilities_boy",        _BAL, "TotalLiabilitiesBOYAmt"),
    ("total_liabilities_eoy",        _BAL, "TotalLiabilitiesEOYAmt"),
    ("net_assets_boy",               _BAL, "TotNetAstOrFundBalancesBOYAmt"),
    ("net_assets_eoy",               _BAL, "TotNetAstOrFundBalancesEOYAmt"),
    # Part III change in net assets
    ("other_increases", "ChgInNetAssetsFundBalancesGrp", "OtherIncreasesAmt"),
    ("other_decreases", "ChgInNetAssetsFundBalancesGrp", "OtherDecreasesAmt"),
    # Return-header FMV box
    ("fmv_assets_eoy",               None, "FMVAssetsEOYAmt"),
    # Part VI excise tax
    ("excise_tax", "ExciseTaxBasedOnInvstIncmGrp", "TaxBasedOnInvestmentIncomeAmt"),
    # Part X minimum investment return
    ("net_noncharitable_assets", "MinimumInvestmentReturnGrp", "NetVlNoncharitableAssetsAmt"),
    ("min_investment_return",    "MinimumInvestmentReturnGrp", "MinimumInvestmentReturnAmt"),
    # Part XI / XII / XIII
    ("distributable_amount",     "DistributableAmountGrp",     "DistributableAsAdjustedAmt"),
    ("qualifying_distributions", "PFQualifyingDistributionsGrp", "QualifyingDistributionsAmt"),
    ("undistributed_income_cy",  "UndistributedIncomeGrp",     "UndistributedIncomeCYAmt"),
    ("excess_distribution_carryover", "UndistributedIncomeGrp", "ExcessDistriCyovToNextYrAmt"),
    # Part XV reported totals (cross-checks for our grant rows)
    ("total_grants_paid",            "SupplementaryInformationGrp", "TotalGrantOrContriPdDurYrAmt"),
    ("total_grants_approved_future", "SupplementaryInformationGrp", "TotalGrantOrContriApprvFutAmt"),
]
FIN_COLUMNS = [c for c, _, _ in FIN_FIELDS]

# Groups that were renamed between schema versions: the name FIN_FIELDS uses
# -> the older names, tried in order when the current one is absent.
#
# Part XII "Qualifying Distributions" is QualifyingDistriPartXIIGrp in every
# returnVersion from 2014v6.0 to 2019v5.1 (read from the XML) and
# PFQualifyingDistributionsGrp in the newer schema FIN_FIELDS was written
# against. The switch is at 2021v4.0: in the database loaded before this alias
# existed, 0 of 114,618 returns of version 2020v4.x have the column and 92% of
# 2021v4.x returns do. Measured 2026-10-08 on
# 46,765 990-PF returns from five 2017-2020 zips: qualifying_distributions was
# filled on 0% of them before this alias and on 84-100% after in every
# version with more than 100 returns. It was the only column at zero because
# of a rename (2018v3.0 also shows total_grants_approved_future at zero, but
# those returns carry no future-grant element under any name).
#
# Do NOT replace this with a search for QualifyingDistributionsAmt anywhere in
# the form. The same element name also sits in QlfyUndSect4940eReducedTaxGrp
# (old Part V) and in UndistributedIncomeGrp (Part XIII), where it is a
# different line.
_GROUP_ALIASES: dict[str, tuple[str, ...]] = {
    "PFQualifyingDistributionsGrp": ("QualifyingDistriPartXIIGrp",),
}


def _parse_financials(pf) -> dict:
    groups: dict[str, object] = {}
    for _, g, _ in FIN_FIELDS:
        if g is not None and g not in groups:
            el = pf.find(NS + g)
            if el is None:
                for old in _GROUP_ALIASES.get(g, ()):
                    el = pf.find(NS + old)
                    if el is not None:
                        break
            groups[g] = el
    out: dict[str, int | None] = {}
    for col, g, name in FIN_FIELDS:
        parent = pf if g is None else groups[g]
        out[col] = _int(parent, name) if parent is not None else None
    return out


def _parse_header(root, pf) -> dict:
    h: dict = {}
    hdr = root.find(f"{NS}ReturnHeader")
    if hdr is not None:
        h["return_ts"] = _text(hdr, "ReturnTs")
        h["tax_period_begin"] = _text(hdr, "TaxPeriodBeginDt")
        h["tax_period_end"] = _text(hdr, "TaxPeriodEndDt")
        filer = hdr.find(f"{NS}Filer")
        if filer is not None:
            h["phone"] = _text(filer, "PhoneNum")
            h["in_care_of"] = _text(filer, "InCareOfNm")
            addr = filer.find(f"{NS}USAddress")
            foreign = filer.find(f"{NS}ForeignAddress") if addr is None else None
            a = addr if addr is not None else foreign
            if a is not None:
                h["addr1"] = _text(a, "AddressLine1Txt", "AddressLine1")
                h["addr2"] = _text(a, "AddressLine2Txt", "AddressLine2")
                h["city"] = _text(a, "CityNm")
                h["state"] = _text(a, "StateAbbreviationCd", "ProvinceOrStateNm")
                h["zip"] = _text(a, "ZIPCd", "ForeignPostalCd")
                h["country"] = _text(a, "CountryCd") if foreign is not None else None
        officer = hdr.find(f"{NS}BusinessOfficerGrp")
        if officer is not None:
            h["sign_name"] = _text(officer, "PersonNm")
            h["sign_title"] = _text(officer, "PersonTitleTxt")
            h["sign_date"] = _text(officer, "SignatureDt")
    h["return_version"] = root.get("returnVersion")
    h["amended"] = _checked(pf, "AmendedReturnInd") or (
        hdr is not None and _checked(hdr, "AmendedReturnInd"))
    if _checked(pf, "MethodOfAccountingCashInd"):
        h["acct_method"] = "cash"
    elif _checked(pf, "MethodOfAccountingAccrualInd"):
        h["acct_method"] = "accrual"
    elif pf.find(f"{NS}MethodOfAccountingOtherDesc") is not None or \
            _checked(pf, "MethodOfAccountingOtherInd"):
        h["acct_method"] = "other"
    else:
        h["acct_method"] = None
    return h


def _parse_grant_grp(grp) -> tuple | None:
    """Shared shape for paid grants and future commitments:
    (recipient, city, state, purpose, amount, address, zip, country,
     foundation_status, relationship)."""
    recipient = _text(grp, "RecipientPersonNm")
    if recipient is None:
        biz = grp.find(f"{NS}RecipientBusinessName")
        if biz is not None:
            recipient = _text(biz, "BusinessNameLine1Txt", "BusinessNameLine1")
    if not recipient:
        return None
    us = grp.find(f"{NS}RecipientUSAddress")
    foreign = grp.find(f"{NS}RecipientForeignAddress") if us is None else None
    a = us if us is not None else foreign
    address = city = state = zipc = country = None
    if a is not None:
        line1 = _text(a, "AddressLine1Txt", "AddressLine1")
        line2 = _text(a, "AddressLine2Txt", "AddressLine2")
        address = " ".join(x for x in (line1, line2) if x) or None
        city = _text(a, "CityNm")
        state = _text(a, "StateAbbreviationCd", "ProvinceOrStateNm")
        zipc = _text(a, "ZIPCd", "ForeignPostalCd")
        country = _text(a, "CountryCd") if foreign is not None else None
    return (recipient[:500], city, state,
            _text(grp, "GrantOrContributionPurposeTxt"),
            parse_amount(_text(grp, "Amt") or ""),
            address, zipc, country,
            _text(grp, "RecipientFoundationStatusTxt"),
            _text(grp, "RecipientRelationshipTxt"))


def _parse_contributor(grp) -> tuple | None:
    """(contributor_num, person_name, business_name, street, city, state, zip,
    country, amount, is_person, is_payroll, is_noncash)"""
    person = _text(grp, "ContributorPersonNm")
    business = None
    if person is None:
        biz = grp.find(f"{NS}ContributorBusinessName")
        if biz is not None:
            business = _text(biz, "BusinessNameLine1Txt", "BusinessNameLine1")
    if not person and not business:
        return None
    us = grp.find(f"{NS}ContributorUSAddress")
    foreign = grp.find(f"{NS}ContributorForeignAddress") if us is None else None
    a = us if us is not None else foreign
    street = city = state = zipc = country = None
    if a is not None:
        line1 = _text(a, "AddressLine1Txt", "AddressLine1")
        line2 = _text(a, "AddressLine2Txt", "AddressLine2")
        street = " ".join(x for x in (line1, line2) if x) or None
        city = _text(a, "CityNm")
        state = _text(a, "StateAbbreviationCd", "ProvinceOrStateNm")
        zipc = _text(a, "ZIPCd", "ForeignPostalCd")
        country = _text(a, "CountryCd") if foreign is not None else None
    num = _int(grp, "ContributorNum")
    if num is not None and abs(num) > 2_147_483_647:
        num = None  # filer-entered serials get int4 headroom, not more
    return (num, person, business, street, city, state,
            zipc, country, _int(grp, "TotalContributionsAmt"),
            _checked(grp, "PersonContributionInd"),
            _checked(grp, "PayrollContributionInd"),
            _checked(grp, "NoncashContributionInd"))


_PERIOD_END = re.compile(r"^(\d{4})-(\d{2})-\d{2}$")


def filing_from_header(object_id: str, data: bytes) -> tuple[str, PfFiling] | None:
    """``(form, PfFiling)`` read from a return's own ReturnHeader.

    For returns that are in a published zip but in no index CSV (about 47,750
    990-PFs in the 2020 zips). The header carries everything the index row
    would have given the loaders: the form (ReturnTypeCd), the EIN, the tax
    period (the YYYYMM of TaxPeriodEndDt, which is how the index writes
    TAX_PERIOD) and the filer name. Measured 2026-10-08 on 42,851 990-PF
    returns that ARE indexed, from four zips of 2017-2020: form, EIN and tax
    period agree with the index on every one. None when the header is
    unusable."""
    root = etree.fromstring(data)
    hdr = root.find(f"{NS}ReturnHeader")
    if hdr is None:
        return None
    form = _text(hdr, "ReturnTypeCd")
    filer = hdr.find(f"{NS}Filer")
    if not form or filer is None:
        return None
    ein = normalize_ein(_text(filer, "EIN") or "")
    if not ein:
        return None
    m = _PERIOD_END.match(_text(hdr, "TaxPeriodEndDt") or "")
    name = None
    biz = filer.find(f"{NS}BusinessName")
    if biz is not None:
        name = " ".join(x for x in (
            _text(biz, "BusinessNameLine1Txt", "BusinessNameLine1"),
            _text(biz, "BusinessNameLine2Txt", "BusinessNameLine2")) if x) or None
    return form, PfFiling(
        object_id=object_id, ein=ein,
        tax_period=(m.group(1) + m.group(2)) if m else "",
        taxpayer_name=name or "", batch_id="",
    )


def parse_filing(data: bytes, filing: PfFiling) -> Parsed:
    p = Parsed()
    root = etree.fromstring(data)
    ret_data = root.find(f"{NS}ReturnData")
    pf = ret_data.find(f"{NS}IRS990PF") if ret_data is not None else None
    if pf is None:
        return p
    fy = int(filing.tax_period[:4]) if filing.tax_period[:4].isdigit() else None

    p.header = _parse_header(root, pf)
    p.fin = _parse_financials(pf)

    info = pf.find(f"{NS}OfficerDirTrstKeyEmplInfoGrp")
    if info is not None:
        seen: set[str] = set()
        for seq, grp in enumerate(info.findall(f"{NS}OfficerDirTrstKeyEmplGrp")):
            name = _text(grp, "PersonNm")
            business = None
            if name is None:
                biz = grp.find(f"{NS}BusinessName")
                if biz is not None:
                    business = _text(biz, "BusinessNameLine1Txt", "BusinessNameLine1")
            if not name and not business:
                continue
            hours = _text(grp, "AverageHrsPerWkDevotedToPosRt")
            if hours is not None:
                try:
                    if abs(float(hours)) >= 1_000_000:
                        hours = None  # filer-entered; keep COPY unbreakable
                except ValueError:
                    hours = None
            p.filing_officers.append((
                seq, name.title() if name else None, business,
                _text(grp, "TitleTxt"),
                hours,
                _int(grp, "CompensationAmt"),
                _int(grp, "EmployeeBenefitProgramAmt"),
                _int(grp, "ExpenseAccountOtherAllwncAmt"),
                None,  # related_org_compensation: 990-PF Part VIII has no such line
            ))
            if not name:
                continue  # corporate trustees never enter the people pipeline
            norm = normalize_name(name)
            key = f"irs990pf:{filing.ein}:{norm}"
            if key in seen:
                continue
            seen.add(key)
            p.officers.append((filing.ein, name.title(), norm, _text(grp, "TitleTxt"), key))

    supp = pf.find(f"{NS}SupplementaryInformationGrp")
    if supp is not None:
        for i, grp in enumerate(supp.findall(f"{NS}GrantOrContributionPdDurYrGrp")):
            g = _parse_grant_grp(grp)
            if g is None:
                continue
            recipient, city, state, purpose, amt, address, zipc, country, fstatus, rel = g
            p.grants.append((
                filing.ein,
                f"irs990pf:{filing.object_id}:grant:{i}",
                f"xpath:/Return/ReturnData/IRS990PF/SupplementaryInformationGrp/"
                f"GrantOrContributionPdDurYrGrp[{i + 1}]",
                recipient, city, state, purpose, amt, fy,
                address, zipc, country, fstatus, rel,
            ))
        for i, grp in enumerate(supp.findall(f"{NS}GrantOrContriApprvForFutGrp")):
            g = _parse_grant_grp(grp)
            if g is None:
                continue
            recipient, city, state, purpose, amt, address, zipc, country, fstatus, rel = g
            p.future_grants.append((
                filing.ein,
                f"irs990pf:{filing.object_id}:futgrant:{i}",
                f"xpath:/Return/ReturnData/IRS990PF/SupplementaryInformationGrp/"
                f"GrantOrContriApprvForFutGrp[{i + 1}]",
                recipient, city, state, purpose, amt, fy,
                address, zipc, country, fstatus, rel,
            ))
        app = supp.find(f"{NS}ApplicationSubmissionInfoGrp")
        only_presel = _checked(supp, "OnlyContriToPreselectedInd")
        if app is not None or only_presel:
            addr = app.find(f"{NS}RecipientUSAddress") if app is not None else None
            p.app_info = (
                _text(app, "RecipientPersonNm") if app is not None else None,
                _text(addr, "AddressLine1Txt", "AddressLine1") if addr is not None else None,
                _text(addr, "AddressLine2Txt", "AddressLine2") if addr is not None else None,
                _text(addr, "CityNm") if addr is not None else None,
                _text(addr, "StateAbbreviationCd") if addr is not None else None,
                _text(addr, "ZIPCd") if addr is not None else None,
                _text(app, "RecipientPhoneNum") if app is not None else None,
                _text(app, "RecipientEmailAddressTxt") if app is not None else None,
                _text(app, "FormAndInfoAndMaterialsTxt") if app is not None else None,
                _text(app, "SubmissionDeadlinesTxt") if app is not None else None,
                _text(app, "RestrictionsOnAwardsTxt") if app is not None else None,
                only_presel,
            )

    sched_b = ret_data.find(f"{NS}IRS990ScheduleB")
    if sched_b is not None:
        for i, grp in enumerate(sched_b.findall(f"{NS}ContributorInformationGrp")):
            c = _parse_contributor(grp)
            if c is not None:
                p.contributors.append((i,) + c)
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
  fy         smallint,
  address    text,
  zip        text,
  country    text,
  fstatus    text,
  rel        text
) on commit drop
"""

_FUTGRANT_STAGE_DDL = _GRANT_STAGE_DDL.replace("_pf_grants", "_pf_futgrants")

_GRANT_COLS = ("record_key, ein, locator, recipient, city, state, purpose,"
               " amount, fy, address, zip, country, fstatus, rel")

_FIN_STAGE_DDL = (
    "create temp table _pf_fin (object_id text primary key, ein text not null, "
    + ", ".join(f"{c} bigint" for c in FIN_COLUMNS)
    + ") on commit drop"
)

_OFF_STAGE_DDL = """
create temp table _pf_off (
  object_id text, seq integer, person_name text, business_name text,
  title text, hours numeric, comp bigint, benefits bigint, expense bigint,
  related_comp bigint,
  primary key (object_id, seq)
) on commit drop
"""

_CONTRIB_STAGE_DDL = """
create temp table _pf_contrib (
  object_id text, seq integer, contributor_num integer,
  person_name text, business_name text, street text, city text, state text,
  zip text, country text, amount bigint,
  is_person boolean, is_payroll boolean, is_noncash boolean,
  primary key (object_id, seq)
) on commit drop
"""

_APP_STAGE_DDL = """
create temp table _pf_app (
  object_id text primary key, ein text not null,
  contact_name text, addr_line1 text, addr_line2 text, city text, state text,
  zip text, phone text, email text, form_txt text, deadlines_txt text,
  restrictions_txt text, only_presel boolean
) on commit drop
"""

_HDR_STAGE_DDL = """
create temp table _pf_hdr (
  object_id text primary key,
  tax_period_begin date, tax_period_end date, return_ts timestamptz,
  return_version text, amended boolean, phone text, in_care_of text,
  addr1 text, addr2 text, city text, state text, zip text, country text,
  acct_method text, sign_name text, sign_title text, sign_date date,
  parse_error text
) on commit drop
"""


def _load_details(cur, raw_file_id: int, filings: list[PfFiling],
                  parsed: list[Parsed],
                  errors: list[tuple[PfFiling, str]] = (),
                  update_grants: bool = False,
                  fin_columns: list[str] | None = None) -> dict:
    """Detail tables + filing header for one chunk. Shared by the fresh ingest
    (_load_batch) and the re-parse pass (reparse_details). Caller owns the
    transaction; internal.filings rows must already exist (FK targets).

    ``errors`` are filings whose XML failed to parse — they get
    details_parsed_at set WITH detail_parse_error, so the pass never retries
    them forever. ``update_grants`` backfills the new grant-detail columns
    onto existing funding_events rows (re-parse path; the fresh path writes
    them inline).
    """
    # The 990 core form fills a different subset of filing_financials than the
    # 990-PF does, so the staging table and insert are driven by the caller's
    # column list rather than a hard-coded one.
    fin_columns = fin_columns or FIN_COLUMNS
    counts = {"financials": 0, "filing_officers": 0, "contributors": 0,
              "app_info": 0, "commitments": 0, "grant_detail_updates": 0}
    fin_ddl = ("create temp table _pf_fin (object_id text primary key, "
               "ein text not null, "
               + ", ".join(f"{c} bigint" for c in fin_columns)
               + ") on commit drop")
    for ddl in (fin_ddl, _OFF_STAGE_DDL, _CONTRIB_STAGE_DDL,
                _APP_STAGE_DDL, _HDR_STAGE_DDL, _FUTGRANT_STAGE_DDL):
        cur.execute(ddl)

    with cur.copy("copy _pf_fin from stdin") as copy:
        for f, p in zip(filings, parsed):
            if p.fin:
                copy.write_row((f.object_id, f.ein,
                                *(p.fin.get(c) for c in fin_columns)))

    with cur.copy("copy _pf_off from stdin") as copy:
        for f, p in zip(filings, parsed):
            for row in p.filing_officers:
                copy.write_row((f.object_id, *row))

    with cur.copy("copy _pf_contrib from stdin") as copy:
        for f, p in zip(filings, parsed):
            for row in p.contributors:
                copy.write_row((f.object_id, *row))

    with cur.copy("copy _pf_app from stdin") as copy:
        for f, p in zip(filings, parsed):
            if p.app_info is not None:
                copy.write_row((f.object_id, f.ein, *p.app_info))

    with cur.copy(f"copy _pf_futgrants ({_GRANT_COLS}) from stdin") as copy:
        for p in parsed:
            # Parser tuples lead with ein; the stage table leads with
            # record_key — reorder exactly like the paid-grants COPY.
            for (ein, key, locator, recipient, city, state, purpose, amt,
                 fy, address, zipc, country, fstatus, rel) in p.future_grants:
                copy.write_row((key, ein, locator, recipient, city, state,
                                purpose, amt, fy, address, zipc, country,
                                fstatus, rel))

    with cur.copy("copy _pf_hdr from stdin") as copy:
        for f, p in zip(filings, parsed):
            h = p.header
            copy.write_row((
                f.object_id, h.get("tax_period_begin"), h.get("tax_period_end"),
                h.get("return_ts"), h.get("return_version"), h.get("amended"),
                h.get("phone"), h.get("in_care_of"), h.get("addr1"),
                h.get("addr2"), h.get("city"), h.get("state"), h.get("zip"),
                h.get("country"), h.get("acct_method"), h.get("sign_name"),
                h.get("sign_title"), h.get("sign_date"), None,
            ))
        for f, err in errors:
            copy.write_row((f.object_id,) + (None,) * 17 + (err[:500],))

    fin_cols = ", ".join(fin_columns)
    # The 990 core form and the 990-PF fill disjoint marker columns; use one
    # of them rather than comparing list identity.
    locator = ("xpath:/Return/ReturnData/IRS990"
               if "expenses_program_services" in fin_columns
               else "xpath:/Return/ReturnData/IRS990PF")
    cur.execute(f"""
        insert into internal.filing_financials
          (object_id, ein, {fin_cols}, raw_file_id, source_record_locator)
        select s.object_id, s.ein, {", ".join("s." + c for c in fin_columns)},
               %(rfid)s, %(loc)s
        from _pf_fin s
        on conflict (object_id) do nothing
    """, {"rfid": raw_file_id, "loc": locator})
    counts["financials"] = cur.rowcount

    cur.execute("""
        insert into internal.filing_officers
          (object_id, ein, seq, person_name, business_name, title,
           avg_hours_per_week, compensation, employee_benefits, expense_account,
           related_org_compensation, raw_file_id, source_record_locator)
        select s.object_id, f.ein, s.seq, s.person_name, s.business_name,
               s.title, s.hours, s.comp, s.benefits, s.expense, s.related_comp,
               %(rfid)s,
               case when f.return_type = '990'
                    then 'xpath:/Return/ReturnData/IRS990/Form990PartVIISectionAGrp['
                         || (s.seq + 1) || ']'
                    else 'xpath:/Return/ReturnData/IRS990PF/OfficerDirTrstKeyEmplInfoGrp/'
                         || 'OfficerDirTrstKeyEmplGrp[' || (s.seq + 1) || ']'
               end
        from _pf_off s
        join internal.filings f on f.object_id = s.object_id
        on conflict (object_id, seq) do nothing
    """, {"rfid": raw_file_id})
    counts["filing_officers"] = cur.rowcount

    cur.execute("""
        insert into internal.filing_contributors
          (object_id, ein, seq, contributor_num, person_name, business_name,
           street, city, state, zip, country, total_contributions,
           is_person, is_payroll, is_noncash, raw_file_id, source_record_locator)
        select s.object_id, f.ein, s.seq, s.contributor_num, s.person_name,
               s.business_name, s.street, s.city, s.state, s.zip, s.country,
               s.amount, s.is_person, s.is_payroll, s.is_noncash, %(rfid)s,
               'xpath:/Return/ReturnData/IRS990ScheduleB/ContributorInformationGrp['
                 || (s.seq + 1) || ']'
        from _pf_contrib s
        join internal.filings f on f.object_id = s.object_id
        on conflict (object_id, seq) do nothing
    """, {"rfid": raw_file_id})
    counts["contributors"] = cur.rowcount

    cur.execute("""
        insert into internal.filing_application_info
          (object_id, ein, contact_name, addr_line1, addr_line2, city, state,
           zip, phone, email, form_and_info_txt, submission_deadlines_txt,
           restrictions_txt, only_preselected, raw_file_id, source_record_locator)
        select s.object_id, s.ein, s.contact_name, s.addr_line1, s.addr_line2,
               s.city, s.state, s.zip, s.phone, s.email, s.form_txt,
               s.deadlines_txt, s.restrictions_txt, s.only_presel, %(rfid)s,
               'xpath:/Return/ReturnData/IRS990PF/SupplementaryInformationGrp/'
                 || 'ApplicationSubmissionInfoGrp'
        from _pf_app s
        on conflict (object_id) do nothing
    """, {"rfid": raw_file_id})
    counts["app_info"] = cur.rowcount

    # Approved-for-future grants: distinct event_type, never for superseded
    # filings (reconcile() backstops any race).
    cur.execute("""
        insert into internal.funding_events
          (event_type, funder_org_id, recipient_name, recipient_city,
           recipient_state, fiscal_year, amount, purpose_text,
           recipient_address, recipient_zip, recipient_country,
           recipient_foundation_status, recipient_relationship,
           source_record_key, raw_file_id, source_record_locator)
        select 'grant_commitment', oi.org_id, s.recipient, s.city, s.state,
               s.fy, s.amount, s.purpose, s.address, s.zip, s.country,
               s.fstatus, s.rel, s.record_key, %(rfid)s, s.locator
        from _pf_futgrants s
        join internal.org_identifiers oi
          on oi.id_type = 'ein' and oi.id_value = s.ein
        join internal.filings fl
          on fl.object_id = split_part(s.record_key, ':', 2)
         and fl.superseded_by_object_id is null
        on conflict (source_record_key) do nothing
    """, {"rfid": raw_file_id})
    counts["commitments"] = cur.rowcount

    if update_grants:
        cur.execute("""
            update internal.funding_events fe
            set recipient_address           = s.address,
                recipient_zip               = s.zip,
                recipient_country           = s.country,
                recipient_foundation_status = s.fstatus,
                recipient_relationship      = s.rel
            from _pf_grants s
            where fe.source_record_key = s.record_key
              and (fe.recipient_address, fe.recipient_zip, fe.recipient_country,
                   fe.recipient_foundation_status, fe.recipient_relationship)
                  is distinct from
                  (s.address, s.zip, s.country, s.fstatus, s.rel)
        """)
        counts["grant_detail_updates"] = cur.rowcount

    cur.execute("""
        update internal.filings f
        set tax_period_begin   = coalesce(h.tax_period_begin, f.tax_period_begin),
            tax_period_end     = coalesce(h.tax_period_end, f.tax_period_end),
            return_ts          = h.return_ts,
            return_version     = h.return_version,
            amended_return     = h.amended,
            phone              = h.phone,
            in_care_of_name    = h.in_care_of,
            filer_addr_line1   = h.addr1,
            filer_addr_line2   = h.addr2,
            filer_city         = h.city,
            filer_state        = h.state,
            filer_zip          = h.zip,
            filer_country      = h.country,
            accounting_method  = h.acct_method,
            signing_officer_name  = h.sign_name,
            signing_officer_title = h.sign_title,
            signature_date     = h.sign_date,
            details_parsed_at  = now(),
            detail_parse_error = h.parse_error
        from _pf_hdr h
        where f.object_id = h.object_id
    """)
    return counts


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

        with cur.copy(f"copy _pf_grants ({_GRANT_COLS}) from stdin") as copy:
            for p in parsed:
                for (ein, key, locator, recipient, city, state, purpose, amt,
                     fy, address, zipc, country, fstatus, rel) in p.grants:
                    copy.write_row((key, ein, locator, recipient, city, state,
                                    purpose, amt, fy, address, zipc, country,
                                    fstatus, rel))

        cur.execute("analyze _pf_orgs")
        cur.execute("analyze _pf_people")
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
               recipient_address, recipient_zip, recipient_country,
               recipient_foundation_status, recipient_relationship,
               source_record_key, raw_file_id, source_record_locator)
            select 'grant', oi.org_id, s.recipient, s.city, s.state,
                   s.fy, s.amount, s.purpose,
                   s.address, s.zip, s.country, s.fstatus, s.rel,
                   s.record_key, %(rfid)s, s.locator
            from _pf_grants s
            join internal.org_identifiers oi
              on oi.id_type = 'ein' and oi.id_value = s.ein
            on conflict (source_record_key) do nothing
        """, {"rfid": raw_file_id})
        counts["grants"] = cur.rowcount

        # Spine rows (index-only) already exist — flip their marker and point
        # raw_file_id at the batch zip (more specific provenance than the
        # index CSV). Rows from a previous grants pass keep their original
        # zip pointer and timestamp.
        cur.execute("""
            insert into internal.filings as f
              (object_id, ein, return_type, tax_period, raw_file_id,
               grants_processed_at)
            select unnest(%(oids)s::text[]), unnest(%(eins)s::text[]), '990PF',
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

        # Financials + officers + Schedule B + how-to-apply + header, in the
        # same pass — fresh monthly ingests need no separate detail run.
        for k, v in _load_details(cur, raw_file_id, filings, parsed).items():
            if v:
                counts[k] = counts.get(k, 0) + v
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


# Members extracted per 7zz call. One call for a whole archive wrote every
# wanted member to the temp folder at once (2-3 GB for a 400 MB legacy zip);
# slices keep the temp folder near 200 MB, which is what makes the Deflate64
# zips safe on a small disk. Each call re-reads only the central directory.
_7ZZ_SLICE = 5000


def _extract_via_7zz(path: Path, present: dict[str, tuple[PfFiling, str]], totals: dict):
    """`present` maps object_id -> (filing, full member path inside the zip).
    7zz 'e' flattens on extraction, so outputs are basenames either way."""
    import subprocess
    import tempfile

    items = list(present.items())
    for start in range(0, len(items), _7ZZ_SLICE):
        part = items[start:start + _7ZZ_SLICE]
        with tempfile.TemporaryDirectory(prefix="funderdb_7z_") as tmp:
            listfile = Path(tmp) / "members.txt"
            listfile.write_text("\n".join(member for _oid, (_f, member) in part))
            outdir = Path(tmp) / "out"
            outdir.mkdir()
            subprocess.run(
                ["7zz", "e", str(path), f"-o{outdir}", f"@{listfile}", "-y", "-bso0", "-bsp0"],
                check=True, capture_output=True,
            )
            for oid, (f, _member) in part:
                out = outdir / f"{oid}_public.xml"
                if out.exists():
                    yield f, out.read_bytes()
                else:
                    totals["member_errors"] += 1


def ingest(years: tuple[int, ...] = (2026, 2025), limit: int | None = None,
           refresh: bool = False) -> dict:
    """Officers + grants for every indexed 990-PF whose XML a batch zip carries.

    ``limit`` caps the number of filings processed in THIS run (across years
    and batches) — the knob `funderdb bootstrap --profile small` uses to get
    a laptop-sized sample. Idempotency markers are per filing, so a later
    unlimited run simply continues where the limited one stopped.
    """
    totals: dict[str, int] = defaultdict(int)
    stop = False
    with connect() as conn:
        for year in years:
            if stop:
                break
            filings = load_pf_index(year, refresh=refresh)
            with conn.cursor() as cur:
                cur.execute("select object_id from internal.filings "
                            "where grants_processed_at is not null")
                done = {r[0] for r in cur.fetchall()}
            # The index's XML_BATCH_ID labels are unreliable (~30% of 05A-labeled
            # 2026 filings are physically elsewhere), so processing is
            # membership-driven: every remaining filing is offered to every
            # batch zip; each contributes what it actually contains.
            remaining = {f.object_id: f for f in filings if f.object_id not in done}
            batch_ids = batch_ids_for(year, filings)

            for batch_id in batch_ids:
                if limit is not None and totals["filings_processed"] >= limit:
                    print(f"--limit {limit} reached; stopping after "
                          f"{totals['filings_processed']:,} filings", flush=True)
                    stop = True
                    break
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
                        if (limit is not None
                                and totals["filings_processed"] + len(found) >= limit):
                            break
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
        # Amended-return supersession + org_id backfill + MV refresh.
        from .irs_filings import reconcile  # local import: irs_filings imports us

        for k, v in reconcile(conn).items():
            totals[f"reconcile_{k}"] = v
    return dict(totals)


def _staged_zip(batch_id: str) -> Path | None:
    """Already-staged batch zip path, or None — never downloads."""
    settings = get_settings()
    dest = settings.raw_dir / DATASET
    hits = sorted(p for p in dest.glob(f"*_{canonical_batch(batch_id)}.zip")
                  if not p.name.startswith(".partial"))
    return hits[-1] if hits else None


def _raw_file_id_for_zip(conn, path: Path, year: int, batch_id: str) -> int:
    """raw_files id for an already-staged batch zip. Almost always registered
    by the original grants ingest; hash+register covers staged-but-never-
    ingested archives (some 2021-2023 partials)."""
    with conn.cursor() as cur:
        cur.execute(
            "select id from internal.raw_files "
            "where dataset_name = %s and storage_path like %s",
            (DATASET, f"%/{path.name}"),
        )
        row = cur.fetchone()
    if row:
        return int(row[0])
    staged = staging.StagedFile(
        DATASET, batch_url(batch_id, year),
        path, staging._sha256_of(path), path.stat().st_size,
    )
    rfid = staging.register_raw_file(
        conn, staged, license_code="us_public_domain",
        content_type="application/zip",
    )
    conn.commit()
    return rfid


def load_detail_chunk(conn, raw_file_id: int, filings: list[PfFiling],
                      parsed: list[Parsed],
                      errors: list[tuple[PfFiling, str]] = ()) -> dict:
    """Detail-only load of one chunk of 990-PF filings whose grant rows already
    exist: detail tables, header, and the grant-detail columns backfilled onto
    the existing funding_events rows. Never inserts 'grant' rows. One
    transaction, committed here. Shared by reparse_details and the backfill."""
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute(_GRANT_STAGE_DDL)
        with cur.copy(
            f"copy _pf_grants ({_GRANT_COLS}) from stdin"
        ) as copy:
            for p in parsed:
                for row in p.grants:
                    (ein, key, locator, recipient, city,
                     state, purpose, amt, fy, address,
                     zipc, country, fstatus, rel) = row
                    copy.write_row((
                        key, ein, locator, recipient, city,
                        state, purpose, amt, fy, address,
                        zipc, country, fstatus, rel))
        counts = _load_details(
            cur, raw_file_id, filings, parsed,
            errors=errors, update_grants=True,
        )
    conn.commit()
    return counts


def reparse_details(years: tuple[int, ...] = (2026, 2025, 2024)) -> dict:
    """Financial/detail pass over ALREADY-STAGED zips.

    Never downloads and never inserts 'grant' rows — back-year grant volume
    stays behind the G2 disk gate while the small detail tables land for
    whatever XML is on disk. Idempotent via filings.details_parsed_at;
    XML-broken members get detail_parse_error so they are never retried
    forever. Existing grant rows receive the new detail columns in place.
    """
    totals: dict[str, int] = defaultdict(int)
    with connect() as conn:
        for year in years:
            filings_idx = load_pf_index(year)
            with conn.cursor() as cur:
                cur.execute("""
                    select object_id from internal.filings
                    where return_type = '990PF' and details_parsed_at is null
                """)
                todo_set = {r[0] for r in cur.fetchall()}
            remaining = {f.object_id: f for f in filings_idx
                         if f.object_id in todo_set}
            totals[f"todo_{year}"] = len(remaining)
            for batch_id in batch_ids_for(year, filings_idx):
                if not remaining:
                    break
                path = _staged_zip(batch_id)
                if path is None:
                    totals["zips_not_staged"] += 1
                    continue
                todo = list(remaining.values())
                raw_file_id = _raw_file_id_for_zip(conn, path, year, batch_id)
                run_id = ledger.start_run(conn, raw_file_id, DATASET)
                try:
                    parsed: list[Parsed] = []
                    found: list[PfFiling] = []
                    errors: list[tuple[PfFiling, str]] = []
                    for f, data in _iter_wanted_members(path, todo, totals):
                        try:
                            parsed.append(parse_filing(data, f))
                            found.append(f)
                        except etree.XMLSyntaxError as exc:
                            errors.append((f, f"XMLSyntaxError: {exc}"))
                            totals["xml_errors"] += 1
                    chunk = 5000
                    agg: dict[str, int] = defaultdict(int)
                    for i in list(range(0, len(found), chunk)) or [0]:
                        counts = load_detail_chunk(
                            conn, raw_file_id, found[i:i + chunk],
                            parsed[i:i + chunk],
                            errors=errors if i == 0 else [],
                        )
                        for k, v in counts.items():
                            agg[k] += v
                        for f in found[i:i + chunk]:
                            remaining.pop(f.object_id, None)
                    for f, _err in errors:
                        remaining.pop(f.object_id, None)
                    ledger.complete_run(
                        conn, run_id, inserted=agg["financials"],
                        updated=agg["grant_detail_updates"],
                        notes=f"{batch_id} 990pf-detail: {len(found)} filings; "
                              f"{dict(agg)}; xml_errors={len(errors)}",
                    )
                    for k, v in agg.items():
                        totals[k] += v
                    totals["filings_detailed"] += len(found)
                    print(f"{batch_id}: detail filings={len(found):,} {dict(agg)}",
                          flush=True)
                except Exception as exc:
                    try:
                        conn.rollback()
                        ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                    except Exception:
                        pass
                    raise
            totals[f"detail_pending_after_{year}"] = len(remaining)
        from .irs_filings import reconcile

        for k, v in reconcile(conn).items():
            totals[f"reconcile_{k}"] = v
    return dict(totals)


def coverage_add(by_version: dict, p: Parsed, columns: list[str] | None = None) -> None:
    """Count one parsed return into the per-returnVersion coverage histogram."""
    ver = p.header.get("return_version") or "?"
    v = by_version.setdefault(ver, {"n": 0, "cols": defaultdict(int)})
    v["n"] += 1
    for c in columns or FIN_COLUMNS:
        if p.fin.get(c) is not None:
            v["cols"][c] += 1


def print_coverage(by_version: dict, columns: list[str] | None = None,
                   headline: tuple[str, ...] = ("total_revenue", "total_assets_eoy",
                                                "fmv_assets_eoy")) -> None:
    """One line per returnVersion: how often the headline columns are filled,
    and how many columns are filled on NO return of that version. A column at
    zero in a well-populated version means an element was renamed."""
    columns = columns or FIN_COLUMNS
    for ver in sorted(by_version):
        v = by_version[ver]
        zero = [c for c in columns if v["cols"].get(c, 0) == 0]
        pct = lambda c: 100 * v["cols"].get(c, 0) / v["n"]  # noqa: E731
        print(f"  {ver}: n={v['n']:,}  "
              + "  ".join(f"{c}={pct(c):.1f}%" for c in headline)
              + f"  zero-coverage-cols={len(zero)}")
        if zero and v["n"] >= 50:
            print(f"    zero in this version: {', '.join(zero[:12])}"
                  f"{'…' if len(zero) > 12 else ''}")


def dry_run_details(years: tuple[int, ...], limit: int | None = None) -> dict:
    """Schema-drift instrument: parse staged zips (no DB, no downloads) and
    report FIN_FIELDS coverage per returnVersion. Zero-coverage columns in a
    well-populated version mean an element rename — fail loudly, not silently."""
    totals: dict[str, int] = defaultdict(int)
    by_version: dict[str, dict] = {}
    scanned = 0
    done = False
    for year in years:
        if done:
            break
        filings_idx = load_pf_index(year)
        remaining = {f.object_id: f for f in filings_idx}
        for batch_id in batch_ids_for(year, filings_idx):
            if done:
                break
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
                    p = parse_filing(data, f)
                except etree.XMLSyntaxError:
                    totals["xml_errors"] += 1
                    continue
                scanned += 1
                coverage_add(by_version, p)
                totals["officer_rows"] += len(p.filing_officers)
                totals["contributor_rows"] += len(p.contributors)
                totals["futgrant_rows"] += len(p.future_grants)
                totals["app_info_filings"] += 1 if p.app_info else 0
                totals["schedb_filings"] += 1 if p.contributors else 0
                if limit and scanned >= limit:
                    done = True
                    break
    totals["filings_scanned"] = scanned
    print(f"\nscanned {scanned:,} filings across {len(by_version)} returnVersions")
    print_coverage(by_version)
    return dict(totals)
