-- 0016: public views for the filing layer + latest-financials MV.
--
-- Same publishability boundary as 0003: owner-rights views, join
-- raw_files -> licensing_map, republishable only, nothing granted to anon.
-- IRS filings are U.S. public domain, so everything here passes the filter —
-- the join is the standing structural guarantee, not a formality.
--
-- filing_contributors: Schedule B is publicly disclosable for private
-- foundations and is exposed here; the street line is withheld initially
-- (house privacy default — flipping it later is a one-line view change).

create view public.filings as
  select f.object_id, f.ein, f.org_id, f.return_type, f.tax_period,
         f.tax_period_begin, f.tax_period_end, f.sub_date, f.dln,
         f.xml_batch_id, f.taxpayer_name, f.return_version, f.amended_return,
         f.return_ts, f.phone, f.in_care_of_name,
         f.filer_addr_line1, f.filer_addr_line2, f.filer_city, f.filer_state,
         f.filer_zip, f.filer_country, f.accounting_method,
         f.signing_officer_name, f.signing_officer_title, f.signature_date,
         f.superseded_by_object_id,
         f.object_id || '_public.xml' as xml_member_name,
         case when coalesce(f.xml_batch_id, '') <> '' then
           'https://apps.irs.gov/pub/epostcard/990/xml/'
             || left(f.xml_batch_id, 4) || '/' || upper(f.xml_batch_id) || '.zip'
         end as xml_zip_url,
         rf.dataset_name as source_dataset, rf.source_url,
         lm.license_code, lm.license_name
  from internal.filings f
  join internal.raw_files rf on rf.id = f.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

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
         ff.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url,
         lm.license_code, lm.license_name
  from internal.filing_financials ff
  join internal.raw_files rf on rf.id = ff.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create view public.filing_officers as
  select fo.id, fo.object_id, fo.ein, fo.seq, fo.person_name, fo.business_name,
         fo.title, fo.avg_hours_per_week, fo.compensation,
         fo.employee_benefits, fo.expense_account,
         fo.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.filing_officers fo
  join internal.raw_files rf on rf.id = fo.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- street deliberately excluded (stored internally; publicly disclosable, but
-- withheld from the export surface until there is a reason to publish it).
create view public.filing_contributors as
  select fc.id, fc.object_id, fc.ein, fc.seq, fc.contributor_num,
         fc.person_name, fc.business_name, fc.city, fc.state, fc.zip,
         fc.country, fc.total_contributions,
         fc.is_person, fc.is_payroll, fc.is_noncash,
         fc.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.filing_contributors fc
  join internal.raw_files rf on rf.id = fc.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

create view public.filing_application_info as
  select fa.object_id, fa.ein, fa.contact_name,
         fa.addr_line1, fa.addr_line2, fa.city, fa.state, fa.zip,
         fa.phone, fa.email,
         fa.form_and_info_txt, fa.submission_deadlines_txt, fa.restrictions_txt,
         fa.only_preselected,
         fa.source_record_locator,
         rf.dataset_name as source_dataset, rf.source_url
  from internal.filing_application_info fa
  join internal.raw_files rf on rf.id = fa.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- funding_events: same view + the new grant-detail columns and the computed
-- filing_object_id (IRS-sourced rows only). Columns are appended, so
-- create-or-replace is safe.
create or replace view public.funding_events as
  select fe.id, fe.event_type, fe.funder_org_id, fe.funder_person_id, fe.program_id,
         fe.recipient_org_id, fe.recipient_name, fe.recipient_city, fe.recipient_state,
         fe.event_date, fe.fiscal_year, fe.amount, fe.currency, fe.purpose_text,
         rf.dataset_name as source_dataset, rf.source_url,
         fe.source_record_locator,
         fe.recipient_address, fe.recipient_zip, fe.recipient_country,
         fe.recipient_foundation_status, fe.recipient_relationship,
         case when fe.source_record_key like 'irs990pf:%'
                or fe.source_record_key like 'irs990:%'
              then split_part(fe.source_record_key, ':', 2)
         end as filing_object_id
  from internal.funding_events fe
  join internal.raw_files rf on rf.id = fe.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- Per-org financial time series in one select (the UI chart query).
create view public.org_financial_series as
  select f.org_id, f.ein, f.object_id, f.return_type,
         nullif(left(f.tax_period, 4), '')::smallint as fy,
         f.tax_period, f.tax_period_end,
         ff.total_revenue, ff.total_expenses, ff.charitable_disbursements,
         ff.contributions_received, ff.qualifying_distributions,
         ff.distributable_amount, ff.total_assets_eoy, ff.total_assets_eoy_fmv,
         ff.total_liabilities_eoy, ff.net_assets_eoy, ff.fmv_assets_eoy
  from internal.filings f
  join internal.filing_financials ff on ff.object_id = f.object_id
  join internal.raw_files rf on rf.id = ff.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where f.superseded_by_object_id is null
    and f.org_id is not null
    and lm.republishable;

-- Latest non-superseded financials per org — profile stat rows without a
-- per-request sort over the series.
create materialized view internal.mv_org_latest_financials as
  select org_id, object_id, ein, return_type, tax_period, tax_period_end, fy,
         fmv_assets_eoy, total_revenue, total_expenses,
         charitable_disbursements, qualifying_distributions,
         total_assets_eoy, total_liabilities_eoy, net_assets_eoy, n_filings
  from (
    select f.org_id, f.object_id, f.ein, f.return_type, f.tax_period,
           f.tax_period_end,
           nullif(left(f.tax_period, 4), '')::smallint as fy,
           ff.fmv_assets_eoy, ff.total_revenue, ff.total_expenses,
           ff.charitable_disbursements, ff.qualifying_distributions,
           ff.total_assets_eoy, ff.total_liabilities_eoy, ff.net_assets_eoy,
           count(*) over (partition by f.org_id) as n_filings,
           row_number() over (partition by f.org_id
                              order by f.tax_period desc, f.object_id desc) as rn
    from internal.filings f
    join internal.filing_financials ff on ff.object_id = f.object_id
    where f.org_id is not null
      and f.superseded_by_object_id is null
  ) t
  where rn = 1;

create unique index uq_mv_org_latest_fin on internal.mv_org_latest_financials (org_id);

create or replace function internal.refresh_dashboard_stats() returns void
language sql
set search_path = ''
as $$
  refresh materialized view internal.mv_overview_totals;
  refresh materialized view internal.mv_org_type_counts;
  refresh materialized view internal.mv_org_state_counts;
  refresh materialized view internal.mv_event_type_totals;
  refresh materialized view internal.mv_events_by_year;
  refresh materialized view internal.mv_top_funders;
  refresh materialized view internal.mv_amount_histogram;
  refresh materialized view internal.mv_funder_event_stats;
  refresh materialized view internal.mv_recipient_event_stats;
  refresh materialized view internal.mv_org_latest_financials;
$$;
