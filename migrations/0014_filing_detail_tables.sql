-- 0014: filing-scoped detail tables for the 990-PF extraction pass.
--
-- Amounts are bigint: IRS MeF amounts are whole-dollar XSD integers (documented
-- divergence from the numeric(16,2) house style — no cents exist to lose).
-- NULL means the element is absent from the return; 0 means a filed zero.
-- The UI renders that exact distinction (MDASH vs $0) — never coalesce.
--
-- Rows for superseded filings are KEPT here (the original return stays
-- viewable, ProPublica-style); consumers filter via
-- filings.superseded_by_object_id is null. Only funding_events rows of
-- superseded filings are removed (they feed aggregates).

-- ---------------------------------------------------------------------------
-- filing_financials: curated Part I/II/III/VI/X/XI/XII/XIII/XV figures.
-- Column -> element map lives in the parser (FIN_FIELDS, irs_990pf.py); the
-- two name traps worth repeating here: interest INCOME is
-- InterestOnSavRevAndExpnssAmt (line 3); InterestRevAndExpnssAmt is line-17
-- interest EXPENSE.
-- ---------------------------------------------------------------------------
create table internal.filing_financials (
  object_id  text constraint pk_filing_financials primary key
             constraint fk_finfacts_filing references internal.filings(object_id),
  ein        char(9) not null,

  -- Part I revenue (column (a) unless noted)
  contributions_received       bigint,  -- ContriRcvdRevAndExpnssAmt
  interest_income              bigint,  -- InterestOnSavRevAndExpnssAmt
  dividends                    bigint,  -- DividendsRevAndExpnssAmt
  gross_rents                  bigint,  -- GrossRentsRevAndExpnssAmt
  net_gain_sale_assets         bigint,  -- NetGainSaleAstRevAndExpnssAmt
  gross_sales_price            bigint,  -- GrossSalesPriceAmt
  capital_gain_net_income      bigint,  -- CapGainNetIncmNetInvstIncmAmt (col b)
  other_income                 bigint,  -- OtherIncomeRevAndExpnssAmt
  total_revenue                bigint,  -- TotalRevAndExpnssAmt
  total_revenue_net_invst      bigint,  -- TotalNetInvstIncmAmt (col b)
  total_revenue_adj_net        bigint,  -- TotalAdjNetIncmAmt (col c)

  -- Part I expenses
  officer_comp                 bigint,  -- CompOfcrDirTrstRevAndExpnssAmt
  other_salaries               bigint,  -- OthEmplSlrsWgsRevAndExpnssAmt
  pension_benefits             bigint,  -- PensionEmplBnftRevAndExpnssAmt
  legal_fees                   bigint,  -- LegalFeesRevAndExpnssAmt
  accounting_fees              bigint,  -- AccountingFeesRevAndExpnssAmt
  other_prof_fees              bigint,  -- OtherProfFeesRevAndExpnssAmt
  interest_expense             bigint,  -- InterestRevAndExpnssAmt (line 17)
  taxes                        bigint,  -- TaxesRevAndExpnssAmt
  depreciation                 bigint,  -- DeprecAndDpltnRevAndExpnssAmt
  occupancy                    bigint,  -- OccupancyRevAndExpnssAmt
  travel_conferences           bigint,  -- TravConfMeetingRevAndExpnssAmt
  printing_publications        bigint,  -- PrintingAndPubRevAndExpnssAmt
  other_expenses               bigint,  -- OtherExpensesRevAndExpnssAmt
  total_operating_expenses     bigint,  -- TotOprExpensesRevAndExpnssAmt
  contributions_paid           bigint,  -- ContriPaidRevAndExpnssAmt
  total_expenses               bigint,  -- TotalExpensesRevAndExpnssAmt
  total_expenses_net_invst     bigint,  -- TotalExpensesNetInvstIncmAmt (col b)
  charitable_disbursements     bigint,  -- TotalExpensesDsbrsChrtblAmt (col d)
  excess_revenue_over_expenses bigint,  -- ExcessRevenueOverExpensesAmt
  net_investment_income        bigint,  -- NetInvestmentIncomeAmt
  adjusted_net_income          bigint,  -- AdjustedNetIncomeAmt

  -- Part II balance sheets
  total_assets_boy             bigint,  -- TotalAssetsBOYAmt
  total_assets_eoy             bigint,  -- TotalAssetsEOYAmt
  total_assets_eoy_fmv         bigint,  -- TotalAssetsEOYFMVAmt
  total_liabilities_boy        bigint,  -- TotalLiabilitiesBOYAmt
  total_liabilities_eoy        bigint,  -- TotalLiabilitiesEOYAmt
  net_assets_boy               bigint,  -- TotNetAstOrFundBalancesBOYAmt
  net_assets_eoy               bigint,  -- TotNetAstOrFundBalancesEOYAmt

  -- Part III change in net assets
  other_increases              bigint,  -- OtherIncreasesAmt
  other_decreases              bigint,  -- OtherDecreasesAmt

  -- Return-header FMV (Part I header box)
  fmv_assets_eoy               bigint,  -- FMVAssetsEOYAmt

  -- Part VI excise tax
  excise_tax                   bigint,  -- TaxBasedOnInvestmentIncomeAmt

  -- Part X minimum investment return
  net_noncharitable_assets     bigint,  -- NetVlNoncharitableAssetsAmt
  min_investment_return        bigint,  -- MinimumInvestmentReturnAmt

  -- Part XI / XII / XIII
  distributable_amount         bigint,  -- DistributableAsAdjustedAmt
  qualifying_distributions     bigint,  -- QualifyingDistributionsAmt
  undistributed_income_cy      bigint,  -- UndistributedIncomeCYAmt
  excess_distribution_carryover bigint, -- ExcessDistriCyovToNextYrAmt

  -- Part XV reported totals (cross-checks against our grant rows)
  total_grants_paid            bigint,  -- TotalGrantOrContriPdDurYrAmt
  total_grants_approved_future bigint,  -- TotalGrantOrContriApprvFutAmt

  raw_file_id           bigint not null
                        constraint fk_finfacts_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at            timestamptz not null default now()
);

create index ix_finfacts_ein on internal.filing_financials (ein);

-- ---------------------------------------------------------------------------
-- filing_officers: Part VIII line 1 as filed, one row per listed officer/
-- director/trustee. Corporate trustees (BusinessName) land HERE and are never
-- promoted into internal.people (the people ER pipeline stays person-only).
-- No mailing addresses by design.
-- ---------------------------------------------------------------------------
create table internal.filing_officers (
  id            bigint generated always as identity
                constraint pk_filing_officers primary key,
  object_id     text not null
                constraint fk_filing_officers_filing references internal.filings(object_id),
  ein           char(9) not null,
  seq           smallint not null,           -- document order, 0-based
  person_name   text,
  business_name text,
  title         text,
  avg_hours_per_week numeric(7,2),           -- AverageHrsPerWkDevotedToPosRt
  compensation      bigint,                  -- CompensationAmt
  employee_benefits bigint,                  -- EmployeeBenefitProgramAmt
  expense_account   bigint,                  -- ExpenseAccountOtherAllwncAmt
  raw_file_id           bigint not null
                        constraint fk_filing_officers_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at            timestamptz not null default now(),
  constraint uq_filing_officers unique (object_id, seq),
  constraint ck_filing_officers_name check (num_nonnulls(person_name, business_name) = 1)
);

create index ix_filing_officers_ein on internal.filing_officers (ein);

-- ---------------------------------------------------------------------------
-- filing_contributors: Schedule B, which the IRS includes UNREDACTED in the
-- public 990-PF XML (private-foundation contributor lists are publicly
-- disclosable, unlike public-charity Schedule B). Street is stored but the
-- public view withholds it initially.
-- ---------------------------------------------------------------------------
create table internal.filing_contributors (
  id            bigint generated always as identity
                constraint pk_filing_contributors primary key,
  object_id     text not null
                constraint fk_filing_contrib_filing references internal.filings(object_id),
  ein           char(9) not null,
  seq           smallint not null,           -- document order, 0-based
  contributor_num smallint,                  -- ContributorNum as reported
  person_name   text,
  business_name text,
  street        text,
  city          text,
  state         text,
  zip           text,
  country       text,                        -- NULL = US
  total_contributions bigint,                -- TotalContributionsAmt
  is_person     boolean,                     -- PersonContributionInd
  is_payroll    boolean,                     -- PayrollContributionInd
  is_noncash    boolean,                     -- NoncashContributionInd
  raw_file_id           bigint not null
                        constraint fk_filing_contrib_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at            timestamptz not null default now(),
  constraint uq_filing_contributors unique (object_id, seq),
  constraint ck_filing_contrib_name check (num_nonnulls(person_name, business_name) = 1)
);

create index ix_filing_contrib_ein on internal.filing_contributors (ein);

-- ---------------------------------------------------------------------------
-- filing_application_info: Part XV ApplicationSubmissionInfoGrp — how to apply,
-- deadlines, restrictions, and a real contact. Present on ~20% of PF filings
-- and directly on-thesis. Filing-scoped; "current" per org is derived from the
-- latest non-superseded filing.
-- ---------------------------------------------------------------------------
create table internal.filing_application_info (
  object_id   text constraint pk_filing_app_info primary key
              constraint fk_filing_app_filing references internal.filings(object_id),
  ein         char(9) not null,
  contact_name text,                         -- RecipientPersonNm
  addr_line1  text,
  addr_line2  text,
  city        text,
  state       text,
  zip         text,
  phone       text,                          -- RecipientPhoneNum
  email       text,                          -- RecipientEmailAddressTxt
  form_and_info_txt        text,             -- FormAndInfoAndMaterialsTxt
  submission_deadlines_txt text,             -- SubmissionDeadlinesTxt
  restrictions_txt         text,             -- RestrictionsOnAwardsTxt
  only_preselected boolean,                  -- OnlyContriToPreselectedInd (sibling)
  raw_file_id           bigint not null
                        constraint fk_filing_app_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at            timestamptz not null default now()
);

create index ix_filing_app_ein on internal.filing_application_info (ein);
