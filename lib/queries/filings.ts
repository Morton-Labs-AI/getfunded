import { sql } from "@/lib/db";
import type { GrantPageRow } from "@/lib/queries/org-profile";

/**
 * Filing-layer queries: the 990 e-file spine (internal.filings) + extracted
 * Part I/II/XII financials (internal.filing_financials) + as-filed officers,
 * Schedule B contributors, and Part XV application info.
 *
 * Soft-fail idiom (same as similarOrgs): every reader degrades to empty/null
 * if the filing tables are missing, so the UI ships independently of the
 * data-repo migration landing.
 *
 * Supersession: amended returns get a new object_id; the loser carries
 * superseded_by_object_id. Series/stats consumers must filter it null —
 * the filing LIST deliberately keeps superseded rows (dimmed, original
 * viewable, ProPublica-style).
 */

async function safe<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn(`[filings] ${what} unavailable:`, err);
    }
    return fallback;
  }
}

export interface FilingRow {
  object_id: string;
  ein: string;
  return_type: string;
  tax_period: string | null;
  tax_period_end: string | null;
  fy: number | null;
  amended_return: boolean | null;
  superseded_by_object_id: string | null;
  has_financials: boolean;
  // headline financials (postgres.js numeric-as-string; NULL = not on the return)
  total_revenue: string | null;
  total_expenses: string | null;
  charitable_disbursements: string | null;
  contributions_received: string | null;
  dividends: string | null;
  interest_income: string | null;
  net_gain_sale_assets: string | null;
  other_income: string | null;
  officer_comp: string | null;
  total_operating_expenses: string | null;
  contributions_paid: string | null;
  net_assets_eoy: string | null;
  total_assets_eoy: string | null;
  total_assets_eoy_fmv: string | null;
  total_liabilities_eoy: string | null;
  fmv_assets_eoy: string | null;
  qualifying_distributions: string | null;
  // per-filing file provenance
  dataset_name: string;
  sha256: string;
  source_url: string | null;
  license_name: string;
  downloaded_at: string | null;
}

const FILING_SELECT = sql`
  select f.object_id, f.ein, f.return_type, f.tax_period,
         f.tax_period_end::text, nullif(left(f.tax_period, 4), '')::int as fy,
         f.amended_return, f.superseded_by_object_id,
         (ff.object_id is not null) as has_financials,
         ff.total_revenue::text, ff.total_expenses::text,
         ff.charitable_disbursements::text, ff.contributions_received::text,
         ff.dividends::text, ff.interest_income::text,
         ff.net_gain_sale_assets::text, ff.other_income::text,
         ff.officer_comp::text, ff.total_operating_expenses::text,
         ff.contributions_paid::text, ff.net_assets_eoy::text,
         ff.total_assets_eoy::text, ff.total_assets_eoy_fmv::text,
         ff.total_liabilities_eoy::text, ff.fmv_assets_eoy::text,
         ff.qualifying_distributions::text,
         rf.dataset_name, rf.sha256, rf.source_url, rf.downloaded_at::text,
         lm.license_name
  from internal.filings f
  left join internal.filing_financials ff on ff.object_id = f.object_id
  join internal.raw_files rf on rf.id = f.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code`;

/** All filings for an org cluster, newest first, superseded included (the
    filings table dims them; charts filter them out in page code). */
export async function orgFilings(memberIds: string[]): Promise<FilingRow[]> {
  return safe<FilingRow[]>("orgFilings", async () => {
    return await sql<FilingRow[]>`
      ${FILING_SELECT}
      where f.org_id = any(${memberIds}::uuid[])
      order by f.tax_period desc nulls last, f.object_id desc
      limit 40`;
  }, []);
}

export interface FilingFull extends FilingRow {
  dln: string | null;
  xml_batch_id: string | null;
  taxpayer_name: string | null;
  tax_period_begin: string | null;
  return_ts: string | null;
  return_version: string | null;
  phone: string | null;
  in_care_of_name: string | null;
  filer_addr_line1: string | null;
  filer_city: string | null;
  filer_state: string | null;
  filer_zip: string | null;
  accounting_method: string | null;
  signing_officer_name: string | null;
  signing_officer_title: string | null;
  signature_date: string | null;
  org_id: string | null;
  storage_path: string | null;
  // remaining Part I lines for the full breakdown
  gross_rents: string | null;
  gross_sales_price: string | null;
  capital_gain_net_income: string | null;
  net_investment_income: string | null;
  adjusted_net_income: string | null;
  other_salaries: string | null;
  pension_benefits: string | null;
  legal_fees: string | null;
  accounting_fees: string | null;
  other_prof_fees: string | null;
  interest_expense: string | null;
  taxes: string | null;
  depreciation: string | null;
  occupancy: string | null;
  travel_conferences: string | null;
  printing_publications: string | null;
  other_expenses: string | null;
  excess_revenue_over_expenses: string | null;
  total_assets_boy: string | null;
  total_liabilities_boy: string | null;
  net_assets_boy: string | null;
  excise_tax: string | null;
  min_investment_return: string | null;
  distributable_amount: string | null;
  undistributed_income_cy: string | null;
  total_grants_paid: string | null;
  total_grants_approved_future: string | null;
  // org context (resolved through the canonical map)
  org_name: string | null;
  org_link_id: string | null;
  // amendment cross-links
  amends_object_id: string | null;
}

export async function getFiling(objectId: string): Promise<FilingFull | null> {
  return safe("getFiling", async () => {
    const rows = await sql<FilingFull[]>`
      select f.object_id, f.ein, f.return_type, f.tax_period,
             f.tax_period_end::text, nullif(left(f.tax_period, 4), '')::int as fy,
             f.amended_return, f.superseded_by_object_id,
             f.dln, f.xml_batch_id, f.taxpayer_name,
             f.tax_period_begin::text, f.return_ts::text, f.return_version,
             f.phone, f.in_care_of_name, f.filer_addr_line1, f.filer_city,
             f.filer_state, f.filer_zip, f.accounting_method,
             f.signing_officer_name, f.signing_officer_title,
             f.signature_date::text, f.org_id,
             (ff.object_id is not null) as has_financials,
             ff.total_revenue::text, ff.total_expenses::text,
             ff.charitable_disbursements::text, ff.contributions_received::text,
             ff.dividends::text, ff.interest_income::text,
             ff.net_gain_sale_assets::text, ff.other_income::text,
             ff.officer_comp::text, ff.total_operating_expenses::text,
             ff.contributions_paid::text, ff.net_assets_eoy::text,
             ff.total_assets_eoy::text, ff.total_assets_eoy_fmv::text,
             ff.total_liabilities_eoy::text, ff.fmv_assets_eoy::text,
             ff.qualifying_distributions::text,
             ff.gross_rents::text, ff.gross_sales_price::text,
             ff.capital_gain_net_income::text, ff.net_investment_income::text,
             ff.adjusted_net_income::text, ff.other_salaries::text,
             ff.pension_benefits::text, ff.legal_fees::text,
             ff.accounting_fees::text, ff.other_prof_fees::text,
             ff.interest_expense::text, ff.taxes::text, ff.depreciation::text,
             ff.occupancy::text, ff.travel_conferences::text,
             ff.printing_publications::text, ff.other_expenses::text,
             ff.excess_revenue_over_expenses::text,
             ff.total_assets_boy::text, ff.total_liabilities_boy::text,
             ff.net_assets_boy::text, ff.excise_tax::text,
             ff.min_investment_return::text, ff.distributable_amount::text,
             ff.undistributed_income_cy::text, ff.total_grants_paid::text,
             ff.total_grants_approved_future::text,
             rf.dataset_name, rf.sha256, rf.source_url, rf.storage_path,
             rf.downloaded_at::text, lm.license_name,
             o.name as org_name,
             coalesce(o.canonical_org_id, o.id)::text as org_link_id,
             (select a.object_id from internal.filings a
              where a.superseded_by_object_id = f.object_id
              order by a.object_id desc limit 1) as amends_object_id
      from internal.filings f
      left join internal.filing_financials ff on ff.object_id = f.object_id
      left join internal.organizations o on o.id = f.org_id
      join internal.raw_files rf on rf.id = f.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where f.object_id = ${objectId}`;
    return rows[0] ?? null;
  }, null);
}

export interface FilingOfficerRow {
  seq: number;
  person_name: string | null;
  business_name: string | null;
  title: string | null;
  avg_hours_per_week: string | null;
  compensation: string | null;
  employee_benefits: string | null;
  expense_account: string | null;
}

export async function filingOfficers(objectId: string): Promise<FilingOfficerRow[]> {
  return safe<FilingOfficerRow[]>("filingOfficers", async () => {
    return await sql<FilingOfficerRow[]>`
      select seq, person_name, business_name, title,
             avg_hours_per_week::text, compensation::text,
             employee_benefits::text, expense_account::text
      from internal.filing_officers
      where object_id = ${objectId}
      order by seq`;
  }, []);
}

export interface ContributorRow {
  seq: number;
  person_name: string | null;
  business_name: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  total_contributions: string | null;
  is_person: boolean | null;
  is_payroll: boolean | null;
  is_noncash: boolean | null;
}

export async function filingContributors(objectId: string): Promise<ContributorRow[]> {
  return safe<ContributorRow[]>("filingContributors", async () => {
    return await sql<ContributorRow[]>`
      select seq, person_name, business_name, city, state, country,
             total_contributions::text, is_person, is_payroll, is_noncash
      from internal.filing_contributors
      where object_id = ${objectId}
      order by total_contributions desc nulls last, seq`;
  }, []);
}

export interface FilingAppInfo {
  contact_name: string | null;
  addr_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  form_and_info_txt: string | null;
  submission_deadlines_txt: string | null;
  restrictions_txt: string | null;
  only_preselected: boolean | null;
}

export async function filingAppInfo(objectId: string): Promise<FilingAppInfo | null> {
  return safe("filingAppInfo", async () => {
    const rows = await sql<FilingAppInfo[]>`
      select contact_name, addr_line1, city, state, zip, phone, email,
             form_and_info_txt, submission_deadlines_txt, restrictions_txt,
             only_preselected
      from internal.filing_application_info
      where object_id = ${objectId}`;
    return rows[0] ?? null;
  }, null);
}

/** One page of a single filing's grant rows. Same shape as orgGrantsPage so
    EventsTable renders it unchanged; predicate uses the expression the 0015
    index covers (`split_part(source_record_key, ':', 2)`), never LIKE. */
export async function filingGrantsPage(
  objectId: string,
  {
    q,
    page = 1,
    pageSize = 50,
  }: { q?: string; page?: number; pageSize?: number } = {}
): Promise<GrantPageRow[]> {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const query = q?.trim();
  return safe<GrantPageRow[]>("filingGrantsPage", async () => {
    return await sql<GrantPageRow[]>`
      select fe.id, fe.event_type, fe.recipient_name, fe.recipient_city,
             fe.recipient_state, fe.recipient_org_id, fe.amount::text,
             fe.purpose_text, fe.fiscal_year, fe.event_date::text,
             fe.source_record_locator,
             rf.dataset_name, rf.sha256, rf.source_url, rf.downloaded_at::text,
             lm.license_name,
             count(*) over()::int as total_rows
      from internal.funding_events fe
      join internal.raw_files rf on rf.id = fe.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where split_part(fe.source_record_key, ':', 2) = ${objectId}
        and fe.event_type = 'grant'
        ${query ? sql`and fe.search_tsv @@ websearch_to_tsquery('english', ${query})` : sql``}
      order by fe.amount desc nulls last, fe.id
      limit ${pageSize} offset ${offset}`;
  }, []);
}

/** Grant-commitment rows (Part XV approved for future payment) — small set,
    rendered whole when present. */
export async function filingCommitments(objectId: string): Promise<GrantPageRow[]> {
  return safe<GrantPageRow[]>("filingCommitments", async () => {
    return await sql<GrantPageRow[]>`
      select fe.id, fe.event_type, fe.recipient_name, fe.recipient_city,
             fe.recipient_state, fe.recipient_org_id, fe.amount::text,
             fe.purpose_text, fe.fiscal_year, fe.event_date::text,
             fe.source_record_locator,
             rf.dataset_name, rf.sha256, rf.source_url, rf.downloaded_at::text,
             lm.license_name,
             count(*) over()::int as total_rows
      from internal.funding_events fe
      join internal.raw_files rf on rf.id = fe.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where split_part(fe.source_record_key, ':', 2) = ${objectId}
        and fe.event_type = 'grant_commitment'
      order by fe.amount desc nulls last, fe.id
      limit 200`;
  }, []);
}

/** Grant-row counts per filing for the profile's filings table. */
export async function filingGrantCounts(
  objectIds: string[]
): Promise<Map<string, number>> {
  if (objectIds.length === 0) return new Map();
  return safe("filingGrantCounts", async () => {
    const rows = await sql<{ object_id: string; n: number }[]>`
      select split_part(fe.source_record_key, ':', 2) as object_id,
             count(*)::int as n
      from internal.funding_events fe
      where split_part(fe.source_record_key, ':', 2) = any(${objectIds}::text[])
        and fe.event_type = 'grant'
      group by 1`;
    return new Map(rows.map((r) => [r.object_id, r.n]));
  }, new Map<string, number>());
}
