-- 0021: public-charity 990 core-form financials.
--
-- WHY: a foundation vetting a prospective grantee needs revenue, expenses,
-- net assets and — above all — the program-vs-administrative expense split.
-- None of it existed: 1,881,691 Form 990 filings sat in the spine with zero
-- financials, so every charity profile showed em-dashes where the numbers
-- belong. Benchmark F7's second clause asserts that absence, so landing this
-- MAKES F7 FAIL until its honesty copy is updated — which is the mechanism
-- working, not a regression.
--
-- DESIGN: reuse internal.filing_financials rather than a parallel table. The
-- 990's Part I summary lines map one-to-one onto columns that already exist
-- and are already return-type-agnostic in name:
--
--   CYTotalRevenueAmt              -> total_revenue
--   CYTotalExpensesAmt             -> total_expenses
--   CYContributionsGrantsAmt       -> contributions_received
--   CYGrantsAndSimilarPaidAmt      -> contributions_paid
--   CYRevenuesLessExpensesAmt      -> excess_revenue_over_expenses
--   TotalAssetsBOYAmt/EOYAmt       -> total_assets_boy/eoy
--   TotalLiabilitiesBOYAmt/EOYAmt  -> total_liabilities_boy/eoy
--   NetAssetsOrFundBalances*Amt    -> net_assets_boy/eoy
--
-- Because of that, mv_org_latest_financials, the browse distributions filter,
-- the UI's financial trends and the CC-BY export all light up for charities
-- with NO downstream change. 990-PF-only columns stay NULL on 990 rows and
-- vice versa — the same NULL-means-absent contract as everywhere else.
--
-- Only genuinely 990-specific concepts get new columns.

alter table internal.filing_financials
  -- Part I / Part VIII revenue detail
  add column program_service_revenue    bigint,  -- CYProgramServiceRevenueAmt
  add column investment_income          bigint,  -- CYInvestmentIncomeAmt
  add column other_revenue              bigint,  -- CYOtherRevenueAmt
  add column unrelated_business_revenue bigint,  -- TotalRevenueGrp/UnrelatedBusinessRevenueAmt
  -- Part IX functional expense split — the vetting question. A charity
  -- spending 90% on program services reads very differently from one
  -- spending 40%, and no other field in the database answers it.
  add column expenses_program_services  bigint,  -- TotalFunctionalExpensesGrp/ProgramServicesAmt
  add column expenses_management        bigint,  -- .../ManagementAndGeneralAmt
  add column expenses_fundraising       bigint,  -- .../FundraisingAmt
  -- Part I headcount + Part VII compensation totals
  add column total_employees            integer, -- TotalEmployeeCnt
  add column total_volunteers           integer, -- TotalVolunteersCnt
  add column total_reportable_comp      bigint;  -- TotalReportableCompFromOrgAmt

comment on column internal.filing_financials.expenses_program_services is
  'Form 990 Part IX column (B). Program-services share of total functional '
  'expenses — the single most-requested charity vetting ratio. NULL on '
  '990-PF filings, which have no functional-expense split.';

-- Part VII reports compensation from the filer AND from related organizations
-- separately; collapsing them would understate what an officer is actually
-- paid across the group.
alter table internal.filing_officers
  add column related_org_compensation bigint;

comment on column internal.filing_officers.related_org_compensation is
  'Form 990 Part VII ReportableCompFromRltdOrgAmt. Kept separate from '
  'compensation: an officer paid $1 by the charity and $400k by its related '
  'entity is a materially different fact from one paid nothing.';

-- Extend the public views with the new columns. Recreated rather than
-- replaced because column lists change; behaviour is otherwise identical.
drop view public.filing_financials;
create view public.filing_financials as
  select ff.object_id, ff.ein,
         ff.contributions_received, ff.interest_income, ff.dividends,
         ff.gross_rents, ff.net_gain_sale_assets, ff.gross_sales_price,
         ff.capital_gain_net_income, ff.other_income, ff.total_revenue,
         ff.total_revenue_net_invst, ff.total_revenue_adj_net,
         ff.officer_comp, ff.other_salaries, ff.pension_benefits,
         ff.legal_fees, ff.accounting_fees, ff.other_prof_fees,
         ff.interest_expense, ff.taxes, ff.depreciation, ff.occupancy,
         ff.travel_conferences, ff.printing_publications, ff.other_expenses,
         ff.total_operating_expenses, ff.contributions_paid, ff.total_expenses,
         ff.total_expenses_net_invst, ff.charitable_disbursements,
         ff.excess_revenue_over_expenses, ff.net_investment_income,
         ff.adjusted_net_income,
         ff.total_assets_boy, ff.total_assets_eoy, ff.total_assets_eoy_fmv,
         ff.total_liabilities_boy, ff.total_liabilities_eoy,
         ff.net_assets_boy, ff.net_assets_eoy,
         ff.other_increases, ff.other_decreases, ff.fmv_assets_eoy,
         ff.excise_tax, ff.net_noncharitable_assets, ff.min_investment_return,
         ff.distributable_amount, ff.qualifying_distributions,
         ff.undistributed_income_cy, ff.excess_distribution_carryover,
         ff.total_grants_paid, ff.total_grants_approved_future,
         -- 990 core form (NULL on 990-PF rows)
         ff.program_service_revenue, ff.investment_income, ff.other_revenue,
         ff.unrelated_business_revenue, ff.expenses_program_services,
         ff.expenses_management, ff.expenses_fundraising,
         ff.total_employees, ff.total_volunteers, ff.total_reportable_comp,
         ff.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url,
         lm.license_code, lm.license_name
  from internal.filing_financials ff
  join internal.raw_files rf on rf.id = ff.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

drop view public.filing_officers;
create view public.filing_officers as
  select fo.id, fo.object_id, fo.ein, fo.seq, fo.person_name, fo.business_name,
         fo.title, fo.avg_hours_per_week, fo.compensation,
         fo.related_org_compensation,
         fo.employee_benefits, fo.expense_account,
         fo.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.filing_officers fo
  join internal.raw_files rf on rf.id = fo.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;
