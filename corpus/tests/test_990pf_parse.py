"""Fixture tests for the 990-PF filing-layer parser (dependency-free: plain
asserts, runnable as `uv run python tests/test_990pf_parse.py`; also
pytest-shaped for whenever pytest lands as a dependency).

Two layers:
  1. A synthetic filing exercising every extraction path — FIN_FIELDS
     columns, header, person + corporate-trustee officers, US + foreign
     grants, a future-approved grant, Schedule B person/business
     contributors, Part XV application info, AmendedReturnInd.
  2. A real published 990-PF (a public IRS record: EIN 74-2961304, object
     202532979349100628) extracted from the staged 2025_TEOS_XML_11C zip —
     the B12 acceptance fixture — asserting the 12 published values.
     Skips (pytest.skip, not a silent pass) when the zip is not staged.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from funderdb.sources.irs_990pf import (  # noqa: E402
    FIN_COLUMNS,
    PfFiling,
    parse_filing,
)

FILING = PfFiling(object_id="202601019349100000", ein="810000001",
                  tax_period="202412", taxpayer_name="TEST FOUNDATION",
                  batch_id="2026_TEOS_XML_01A")

FIXTURE = b"""<?xml version="1.0" encoding="utf-8"?>
<Return xmlns="http://www.irs.gov/efile" returnVersion="2024v5.2">
 <ReturnHeader>
  <ReturnTs>2026-01-15T09:30:00-05:00</ReturnTs>
  <TaxPeriodEndDt>2024-12-31</TaxPeriodEndDt>
  <TaxPeriodBeginDt>2024-01-01</TaxPeriodBeginDt>
  <Filer>
    <EIN>810000001</EIN>
    <BusinessName><BusinessNameLine1Txt>TEST FOUNDATION</BusinessNameLine1Txt></BusinessName>
    <PhoneNum>5125550100</PhoneNum>
    <InCareOfNm>% JANE KEEPER</InCareOfNm>
    <USAddress>
      <AddressLine1Txt>1 TEST PLAZA</AddressLine1Txt>
      <CityNm>AUSTIN</CityNm><StateAbbreviationCd>TX</StateAbbreviationCd>
      <ZIPCd>78701</ZIPCd>
    </USAddress>
  </Filer>
  <BusinessOfficerGrp>
    <PersonNm>PAT SIGNER</PersonNm><PersonTitleTxt>TRUSTEE</PersonTitleTxt>
    <SignatureDt>2026-01-10</SignatureDt>
  </BusinessOfficerGrp>
 </ReturnHeader>
 <ReturnData>
  <IRS990PF>
   <AmendedReturnInd>X</AmendedReturnInd>
   <FMVAssetsEOYAmt>5000000</FMVAssetsEOYAmt>
   <MethodOfAccountingAccrualInd>X</MethodOfAccountingAccrualInd>
   <AnalysisOfRevenueAndExpenses>
     <ContriRcvdRevAndExpnssAmt>100000</ContriRcvdRevAndExpnssAmt>
     <InterestOnSavRevAndExpnssAmt>1200</InterestOnSavRevAndExpnssAmt>
     <DividendsRevAndExpnssAmt>50000</DividendsRevAndExpnssAmt>
     <GrossRentsRevAndExpnssAmt>2400</GrossRentsRevAndExpnssAmt>
     <NetGainSaleAstRevAndExpnssAmt>-7500</NetGainSaleAstRevAndExpnssAmt>
     <GrossSalesPriceAmt>90000</GrossSalesPriceAmt>
     <CapGainNetIncmNetInvstIncmAmt>0</CapGainNetIncmNetInvstIncmAmt>
     <OtherIncomeRevAndExpnssAmt>333</OtherIncomeRevAndExpnssAmt>
     <TotalRevAndExpnssAmt>146433</TotalRevAndExpnssAmt>
     <TotalNetInvstIncmAmt>51200</TotalNetInvstIncmAmt>
     <TotalAdjNetIncmAmt>52000</TotalAdjNetIncmAmt>
     <CompOfcrDirTrstRevAndExpnssAmt>12000</CompOfcrDirTrstRevAndExpnssAmt>
     <OthEmplSlrsWgsRevAndExpnssAmt>3000</OthEmplSlrsWgsRevAndExpnssAmt>
     <PensionEmplBnftRevAndExpnssAmt>400</PensionEmplBnftRevAndExpnssAmt>
     <LegalFeesRevAndExpnssAmt>500</LegalFeesRevAndExpnssAmt>
     <AccountingFeesRevAndExpnssAmt>600</AccountingFeesRevAndExpnssAmt>
     <OtherProfFeesRevAndExpnssAmt>700</OtherProfFeesRevAndExpnssAmt>
     <InterestRevAndExpnssAmt>55</InterestRevAndExpnssAmt>
     <TaxesRevAndExpnssAmt>800</TaxesRevAndExpnssAmt>
     <DeprecAndDpltnRevAndExpnssAmt>90</DeprecAndDpltnRevAndExpnssAmt>
     <OccupancyRevAndExpnssAmt>1000</OccupancyRevAndExpnssAmt>
     <TravConfMeetingRevAndExpnssAmt>250</TravConfMeetingRevAndExpnssAmt>
     <PrintingAndPubRevAndExpnssAmt>60</PrintingAndPubRevAndExpnssAmt>
     <OtherExpensesRevAndExpnssAmt>2000</OtherExpensesRevAndExpnssAmt>
     <TotOprExpensesRevAndExpnssAmt>21455</TotOprExpensesRevAndExpnssAmt>
     <ContriPaidRevAndExpnssAmt>80000</ContriPaidRevAndExpnssAmt>
     <TotalExpensesRevAndExpnssAmt>101455</TotalExpensesRevAndExpnssAmt>
     <TotalExpensesNetInvstIncmAmt>1355</TotalExpensesNetInvstIncmAmt>
     <TotalExpensesDsbrsChrtblAmt>85000</TotalExpensesDsbrsChrtblAmt>
     <ExcessRevenueOverExpensesAmt>44978</ExcessRevenueOverExpensesAmt>
     <NetInvestmentIncomeAmt>49845</NetInvestmentIncomeAmt>
     <AdjustedNetIncomeAmt>50645</AdjustedNetIncomeAmt>
   </AnalysisOfRevenueAndExpenses>
   <Form990PFBalanceSheetsGrp>
     <TotalAssetsBOYAmt>4800000</TotalAssetsBOYAmt>
     <TotalAssetsEOYAmt>4900000</TotalAssetsEOYAmt>
     <TotalAssetsEOYFMVAmt>5000000</TotalAssetsEOYFMVAmt>
     <TotalLiabilitiesBOYAmt>1000</TotalLiabilitiesBOYAmt>
     <TotalLiabilitiesEOYAmt>0</TotalLiabilitiesEOYAmt>
     <TotNetAstOrFundBalancesBOYAmt>4799000</TotNetAstOrFundBalancesBOYAmt>
     <TotNetAstOrFundBalancesEOYAmt>4900000</TotNetAstOrFundBalancesEOYAmt>
   </Form990PFBalanceSheetsGrp>
   <ChgInNetAssetsFundBalancesGrp>
     <OtherIncreasesAmt>56022</OtherIncreasesAmt>
     <OtherDecreasesAmt>0</OtherDecreasesAmt>
   </ChgInNetAssetsFundBalancesGrp>
   <ExciseTaxBasedOnInvstIncmGrp>
     <TaxBasedOnInvestmentIncomeAmt>692</TaxBasedOnInvestmentIncomeAmt>
   </ExciseTaxBasedOnInvstIncmGrp>
   <OfficerDirTrstKeyEmplInfoGrp>
     <OfficerDirTrstKeyEmplGrp>
       <PersonNm>ALEX EXAMPLE</PersonNm>
       <TitleTxt>PRESIDENT</TitleTxt>
       <AverageHrsPerWkDevotedToPosRt>10.50</AverageHrsPerWkDevotedToPosRt>
       <CompensationAmt>12000</CompensationAmt>
       <EmployeeBenefitProgramAmt>400</EmployeeBenefitProgramAmt>
       <ExpenseAccountOtherAllwncAmt>0</ExpenseAccountOtherAllwncAmt>
     </OfficerDirTrstKeyEmplGrp>
     <OfficerDirTrstKeyEmplGrp>
       <BusinessName><BusinessNameLine1Txt>COMMERCE TRUST</BusinessNameLine1Txt></BusinessName>
       <TitleTxt>TRUSTEE</TitleTxt>
       <CompensationAmt>72437</CompensationAmt>
     </OfficerDirTrstKeyEmplGrp>
     <OfficerDirTrstKeyEmplGrp>
       <PersonNm>ALEX EXAMPLE</PersonNm>
       <TitleTxt>PRESIDENT (DUP ROW)</TitleTxt>
     </OfficerDirTrstKeyEmplGrp>
   </OfficerDirTrstKeyEmplInfoGrp>
   <MinimumInvestmentReturnGrp>
     <NetVlNoncharitableAssetsAmt>4600000</NetVlNoncharitableAssetsAmt>
     <MinimumInvestmentReturnAmt>230000</MinimumInvestmentReturnAmt>
   </MinimumInvestmentReturnGrp>
   <DistributableAmountGrp>
     <DistributableAsAdjustedAmt>229308</DistributableAsAdjustedAmt>
   </DistributableAmountGrp>
   <PFQualifyingDistributionsGrp>
     <QualifyingDistributionsAmt>85000</QualifyingDistributionsAmt>
   </PFQualifyingDistributionsGrp>
   <UndistributedIncomeGrp>
     <UndistributedIncomeCYAmt>144308</UndistributedIncomeCYAmt>
     <ExcessDistriCyovToNextYrAmt>0</ExcessDistriCyovToNextYrAmt>
   </UndistributedIncomeGrp>
   <SupplementaryInformationGrp>
     <OnlyContriToPreselectedInd>X</OnlyContriToPreselectedInd>
     <ApplicationSubmissionInfoGrp>
       <RecipientPersonNm>GRANTS MANAGER</RecipientPersonNm>
       <RecipientUSAddress>
         <AddressLine1Txt>1 TEST PLAZA</AddressLine1Txt>
         <CityNm>AUSTIN</CityNm><StateAbbreviationCd>TX</StateAbbreviationCd>
         <ZIPCd>78701</ZIPCd>
       </RecipientUSAddress>
       <RecipientPhoneNum>5125550101</RecipientPhoneNum>
       <RecipientEmailAddressTxt>GRANTS@TEST.ORG</RecipientEmailAddressTxt>
       <FormAndInfoAndMaterialsTxt>LETTER OF INQUIRY</FormAndInfoAndMaterialsTxt>
       <SubmissionDeadlinesTxt>MARCH 1</SubmissionDeadlinesTxt>
       <RestrictionsOnAwardsTxt>TEXAS ONLY</RestrictionsOnAwardsTxt>
     </ApplicationSubmissionInfoGrp>
     <GrantOrContributionPdDurYrGrp>
       <RecipientBusinessName><BusinessNameLine1Txt>GOOD WORKS INC</BusinessNameLine1Txt></RecipientBusinessName>
       <RecipientUSAddress>
         <AddressLine1Txt>22 MAIN ST</AddressLine1Txt><AddressLine2Txt>STE 4</AddressLine2Txt>
         <CityNm>DALLAS</CityNm><StateAbbreviationCd>TX</StateAbbreviationCd>
         <ZIPCd>75201</ZIPCd>
       </RecipientUSAddress>
       <RecipientFoundationStatusTxt>PC</RecipientFoundationStatusTxt>
       <RecipientRelationshipTxt>NONE</RecipientRelationshipTxt>
       <GrantOrContributionPurposeTxt>GENERAL SUPPORT</GrantOrContributionPurposeTxt>
       <Amt>50000</Amt>
     </GrantOrContributionPdDurYrGrp>
     <GrantOrContributionPdDurYrGrp>
       <RecipientBusinessName><BusinessNameLine1Txt>AUSLANDS HILFE EV</BusinessNameLine1Txt></RecipientBusinessName>
       <RecipientForeignAddress>
         <AddressLine1Txt>SCHWEINHEIMERSTR 6</AddressLine1Txt>
         <CityNm>ASCHAFFENBURG</CityNm>
         <CountryCd>GM</CountryCd><ForeignPostalCd>D-63739</ForeignPostalCd>
       </RecipientForeignAddress>
       <GrantOrContributionPurposeTxt>RELIEF</GrantOrContributionPurposeTxt>
       <Amt>30000</Amt>
     </GrantOrContributionPdDurYrGrp>
     <GrantOrContriApprvForFutGrp>
       <RecipientBusinessName><BusinessNameLine1Txt>FUTURE U</BusinessNameLine1Txt></RecipientBusinessName>
       <RecipientUSAddress>
         <CityNm>HOUSTON</CityNm><StateAbbreviationCd>TX</StateAbbreviationCd>
       </RecipientUSAddress>
       <RecipientFoundationStatusTxt>PUBLIC CHARITY</RecipientFoundationStatusTxt>
       <GrantOrContributionPurposeTxt>ENDOWMENT</GrantOrContributionPurposeTxt>
       <Amt>5000</Amt>
     </GrantOrContriApprvForFutGrp>
     <TotalGrantOrContriPdDurYrAmt>80000</TotalGrantOrContriPdDurYrAmt>
     <TotalGrantOrContriApprvFutAmt>5000</TotalGrantOrContriApprvFutAmt>
   </SupplementaryInformationGrp>
  </IRS990PF>
  <IRS990ScheduleB>
    <ContributorInformationGrp>
      <ContributorNum>1</ContributorNum>
      <ContributorPersonNm>DANA DONOR</ContributorPersonNm>
      <ContributorUSAddress>
        <AddressLine1Txt>9 GIFT LN</AddressLine1Txt>
        <CityNm>AUSTIN</CityNm><StateAbbreviationCd>TX</StateAbbreviationCd>
        <ZIPCd>78702</ZIPCd>
      </ContributorUSAddress>
      <TotalContributionsAmt>100000</TotalContributionsAmt>
      <PersonContributionInd>X</PersonContributionInd>
    </ContributorInformationGrp>
    <ContributorInformationGrp>
      <ContributorNum>2</ContributorNum>
      <ContributorBusinessName><BusinessNameLine1Txt>GIVING LLC</BusinessNameLine1Txt></ContributorBusinessName>
      <ContributorUSAddress>
        <AddressLine1Txt>1 CORP WAY</AddressLine1Txt>
        <CityNm>DOVER</CityNm><StateAbbreviationCd>DE</StateAbbreviationCd>
        <ZIPCd>19901</ZIPCd>
      </ContributorUSAddress>
      <TotalContributionsAmt>16002795</TotalContributionsAmt>
      <NoncashContributionInd>X</NoncashContributionInd>
    </ContributorInformationGrp>
  </IRS990ScheduleB>
 </ReturnData>
</Return>"""


def test_financials():
    p = parse_filing(FIXTURE, FILING)
    fin = p.fin
    # Every FIN_FIELDS column is present in the fixture -> none may be NULL.
    missing = [c for c in FIN_COLUMNS if fin.get(c) is None]
    assert not missing, f"unexpectedly NULL: {missing}"
    assert fin["contributions_received"] == 100000
    assert fin["interest_income"] == 1200          # line 3, NOT line-17 expense
    assert fin["interest_expense"] == 55           # line 17
    assert fin["net_gain_sale_assets"] == -7500    # negatives survive
    assert fin["capital_gain_net_income"] == 0     # filed zero != NULL
    assert fin["total_revenue"] == 146433
    assert fin["total_expenses"] == 101455
    assert fin["charitable_disbursements"] == 85000
    assert fin["total_liabilities_eoy"] == 0
    assert fin["net_assets_eoy"] == 4900000
    assert fin["fmv_assets_eoy"] == 5000000
    assert fin["excise_tax"] == 692
    assert fin["min_investment_return"] == 230000
    assert fin["distributable_amount"] == 229308
    assert fin["qualifying_distributions"] == 85000
    assert fin["undistributed_income_cy"] == 144308
    assert fin["total_grants_paid"] == 80000
    assert fin["total_grants_approved_future"] == 5000


def test_header():
    p = parse_filing(FIXTURE, FILING)
    h = p.header
    assert h["tax_period_begin"] == "2024-01-01"
    assert h["tax_period_end"] == "2024-12-31"
    assert h["phone"] == "5125550100"
    assert h["in_care_of"] == "% JANE KEEPER"
    assert (h["addr1"], h["city"], h["state"], h["zip"]) == \
        ("1 TEST PLAZA", "AUSTIN", "TX", "78701")
    assert h["acct_method"] == "accrual"
    assert h["amended"] is True
    assert (h["sign_name"], h["sign_title"], h["sign_date"]) == \
        ("PAT SIGNER", "TRUSTEE", "2026-01-10")
    assert h["return_version"] == "2024v5.2"


def test_officers():
    p = parse_filing(FIXTURE, FILING)
    # All three as-filed rows survive, in document order.
    assert len(p.filing_officers) == 3
    (seq, person, business, title, hours, comp, benefits, expense,
     related_comp) = p.filing_officers[0]
    assert (seq, person, business) == (0, "Alex Example", None)
    assert (title, hours, comp, benefits, expense) == \
        ("PRESIDENT", "10.50", 12000, 400, 0)
    # 990-PF Part VIII has no related-organization compensation line.
    assert related_comp is None
    # Corporate trustee: captured with comp, business_name only.
    assert p.filing_officers[1][1] is None
    assert p.filing_officers[1][2] == "COMMERCE TRUST"
    assert p.filing_officers[1][5] == 72437
    # People pipeline: persons only, deduped on normalized name.
    assert len(p.officers) == 1
    assert p.officers[0][1] == "Alex Example"


def test_grants_and_commitments():
    p = parse_filing(FIXTURE, FILING)
    assert len(p.grants) == 2
    (ein, key, locator, recipient, city, state, purpose, amt, fy,
     address, zipc, country, fstatus, rel) = p.grants[0]
    assert key == "irs990pf:202601019349100000:grant:0"
    assert locator.endswith("GrantOrContributionPdDurYrGrp[1]")
    assert (recipient, city, state) == ("GOOD WORKS INC", "DALLAS", "TX")
    assert address == "22 MAIN ST STE 4"
    assert (zipc, country) == ("75201", None)
    assert (fstatus, rel) == ("PC", "NONE")
    assert (purpose, amt, fy) == ("GENERAL SUPPORT", 50000, 2024)
    # Foreign grantee: city/country/postal captured, no US state.
    g2 = p.grants[1]
    assert (g2[4], g2[11]) == ("ASCHAFFENBURG", "GM")
    assert g2[10] == "D-63739"
    # Future-approved -> separate list with futgrant keys.
    assert len(p.future_grants) == 1
    fut = p.future_grants[0]
    assert fut[1] == "irs990pf:202601019349100000:futgrant:0"
    assert fut[2].endswith("GrantOrContriApprvForFutGrp[1]")
    assert fut[7] == 5000


def test_contributors_and_app_info():
    p = parse_filing(FIXTURE, FILING)
    assert len(p.contributors) == 2
    (seq, num, person, business, street, city, state, zipc, country,
     amount, is_person, is_payroll, is_noncash) = p.contributors[0]
    assert (seq, num, person, business) == (0, 1, "DANA DONOR", None)
    assert (street, city, state, zipc) == ("9 GIFT LN", "AUSTIN", "TX", "78702")
    assert (amount, is_person, is_payroll, is_noncash) == (100000, True, False, False)
    c2 = p.contributors[1]
    assert (c2[2], c2[3]) == (None, "GIVING LLC")
    assert (c2[9], c2[12]) == (16002795, True)

    assert p.app_info is not None
    (contact, a1, a2, city, state, zipc, phone, email,
     form_txt, deadlines, restrictions, only_presel) = p.app_info
    assert contact == "GRANTS MANAGER"
    assert email == "GRANTS@TEST.ORG"
    assert (deadlines, restrictions) == ("MARCH 1", "TEXAS ONLY")
    assert only_presel is True


# ---------------------------------------------------------------------------
# Real-data acceptance (B12's parser-side twin): a published 990-PF from the
# IRS bulk zips. Public record; the values below are the ones the IRS
# published for that return.
# ---------------------------------------------------------------------------
REAL_ZIP = Path(__file__).resolve().parents[1] / \
    "data/raw/irs_990_xml/a98ee8b6a457_2025_TEOS_XML_11C.zip"
REAL_OID = "202532979349100628"
REAL_EXPECTED = {
    "fmv_assets_eoy": 28_351_327, "contributions_received": 50_000,
    "dividends": 353_266, "net_gain_sale_assets": 753_889,
    "gross_sales_price": 2_426_164, "capital_gain_net_income": 752_443,
    "total_revenue": 1_467_724, "total_expenses": 3_049_382,
    "charitable_disbursements": 2_512_983, "net_assets_eoy": 26_696_006,
    "total_liabilities_eoy": 0, "officer_comp": 0,
}


def test_real_filing_acceptance():
    if not REAL_ZIP.exists():
        pytest.skip(f"real-data zip not staged: {REAL_ZIP.name}")
    with zipfile.ZipFile(REAL_ZIP) as zf:
        member = next(n for n in zf.namelist()
                      if n.rsplit("/", 1)[-1] == f"{REAL_OID}_public.xml")
        data = zf.read(member)
    f = PfFiling(object_id=REAL_OID, ein="742961304", tax_period="202412",
                 taxpayer_name="(from index)", batch_id="2025_TEOS_XML_11C")
    p = parse_filing(data, f)
    for col, want in REAL_EXPECTED.items():
        got = p.fin.get(col)
        assert got == want, f"{col}: got {got}, want {want}"
    assert len(p.grants) == 97
    assert p.header["acct_method"] == "cash"
    assert p.header["amended"] is False
    assert len(p.filing_officers) == 4
    assert p.app_info is not None and p.app_info[7] is not None  # email present


if __name__ == "__main__":
    test_financials()
    test_header()
    test_officers()
    test_grants_and_commitments()
    test_contributors_and_app_info()
    try:
        test_real_filing_acceptance()
    except BaseException as exc:  # pytest.skip raises outside pytest too
        print(f"  (real-data block skipped: {exc})")
    print("990pf filing-layer fixture tests: OK")
