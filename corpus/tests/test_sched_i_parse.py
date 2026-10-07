"""Fixture test for the Schedule I parser (dependency-free: plain asserts,
runnable as `uv run python tests/test_sched_i_parse.py`; also pytest-shaped
for whenever pytest lands as a dependency)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from funderdb.sources import irs_990_sched_i as si  # noqa: E402
from funderdb.sources.irs_990pf import PfFiling  # noqa: E402

FILING = PfFiling(object_id="202601019349300000", ein="810123456",
                  tax_period="202412", taxpayer_name="TEST CHARITY INC",
                  batch_id="2026_TEOS_XML_01A")

FIXTURE = b"""<?xml version="1.0" encoding="utf-8"?>
<Return xmlns="http://www.irs.gov/efile">
 <ReturnData>
  <IRS990><CYGrantsAndSimilarPaidAmt>150000</CYGrantsAndSimilarPaidAmt></IRS990>
  <IRS990ScheduleI>
    <RecipientTable>
      <RecipientBusinessName><BusinessNameLine1Txt>Stellar Test University</BusinessNameLine1Txt></RecipientBusinessName>
      <RecipientEIN>123456789</RecipientEIN>
      <USAddress><CityNm>Princeton</CityNm><StateAbbreviationCd>NJ</StateAbbreviationCd></USAddress>
      <CashGrantAmt>100000</CashGrantAmt>
      <NonCashAssistanceAmt>25000</NonCashAssistanceAmt>
      <PurposeOfGrantTxt>basic research</PurposeOfGrantTxt>
    </RecipientTable>
    <RecipientTable>
      <RecipientBusinessName><BusinessNameLine1>Old Vintage Charity</BusinessNameLine1></RecipientBusinessName>
      <CashGrantAmt>25000</CashGrantAmt>
    </RecipientTable>
    <RecipientTable>
      <RecipientBusinessName><BusinessNameLine1Txt>No Amount Org</BusinessNameLine1Txt></RecipientBusinessName>
    </RecipientTable>
  </IRS990ScheduleI>
 </ReturnData>
</Return>"""

NO_SCHED_I = b"""<?xml version="1.0" encoding="utf-8"?>
<Return xmlns="http://www.irs.gov/efile">
 <ReturnData>
  <IRS990><CYGrantsAndSimilarPaidAmt>999</CYGrantsAndSimilarPaidAmt></IRS990>
 </ReturnData>
</Return>"""


def test_parse_basic():
    p = si.parse_filing_990(FIXTURE, FILING)
    assert p.reported_total == 150000
    assert not p.over_cap
    assert len(p.grants) == 3
    ein, key, locator, recipient, r_ein, city, state, purpose, amount, fy = p.grants[0]
    assert ein == "810123456"
    assert key == "irs990:202601019349300000:schedi:0"
    assert locator.endswith("RecipientTable[1]")
    assert recipient == "Stellar Test University"
    assert r_ein == "123456789"
    assert (city, state) == ("Princeton", "NJ")
    assert purpose == "basic research"
    assert amount == 125000  # cash + non-cash
    assert fy == 2024
    # Fallback name element (older vintages) + no EIN.
    assert p.grants[1][3] == "Old Vintage Charity"
    assert p.grants[1][4] is None
    assert p.grants[1][8] == 25000
    # Neither cash nor non-cash reported -> NULL, not 0.
    assert p.grants[2][8] is None


def test_no_schedule_i():
    p = si.parse_filing_990(NO_SCHED_I, FILING)
    assert p.grants == [] and not p.over_cap and p.reported_total == 999


def test_row_cap():
    orig = si.ROW_CAP
    si.ROW_CAP = 2
    try:
        p = si.parse_filing_990(FIXTURE, FILING)
        assert p.over_cap and p.grants == []
    finally:
        si.ROW_CAP = orig


if __name__ == "__main__":
    test_parse_basic()
    test_no_schedule_i()
    test_row_cap()
    print("sched_i parser fixture tests: 3/3 OK")
