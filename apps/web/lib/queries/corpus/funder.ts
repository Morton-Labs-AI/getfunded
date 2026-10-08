import "server-only";

/**
 * Corpus reads for the funder profile. Doctrines live here, not per page:
 *   - identity from internal.organizations; EIN from public.org_identifiers
 *   - posture from the latest parsed, non-superseded 990-PF (mv_org_application_posture)
 *   - financials from non-superseded filings only; an amended return replaces its original
 *   - grants exclude rows that belong to a superseded filing
 *   - contact values come from public.contact_channels, which only holds
 *     publishability='public' rows; a render bug can show nothing, never a leak
 *   - the Part XV contact name is published only when it is role-based
 *
 * The app role has SELECT on the named internal relations and every public
 * view, and nothing else; raw_files is not among them, so provenance seals
 * carry the dataset, filing id and source link but no content hash yet.
 */
import { cache } from "react";

import { corpusQuery } from "@/lib/db/corpus";
import { datasetLabel, nteeMajorLabel, orgTypeLabel, returnTypeLabel } from "@/lib/content/labels";
import { MAX_GIVING_TO_CHARS } from "@/lib/search/params";

import { publishableContactName } from "./privacy";
import { isUuid, toInt } from "./safe";
import { postureFromDb } from "./search";
import type {
  ApplicationInfo,
  ContactChannel,
  FilingSummary,
  FinancialYear,
  FunderRecord,
  GivingProfile,
  GrantRow,
  GrantsPage,
  Officer,
  Provenance,
  SimilarFunder,
} from "./types";

function fyOf(taxPeriod: string | null | undefined): number | null {
  if (!taxPeriod) return null;
  const n = Number(taxPeriod.slice(0, 4));
  return Number.isFinite(n) && n > 1900 ? n : null;
}

function filingProvenance(row: {
  source_dataset?: string | null;
  source_url?: string | null;
  license_name?: string | null;
  object_id?: string | null;
  fy?: number | null;
}): Provenance {
  return {
    source: datasetLabel(row.source_dataset, "IRS 990 e-file"),
    filingYear: row.fy ?? null,
    objectId: row.object_id ?? null,
    sha256: null,
    href: row.source_url ?? null,
    license: row.license_name ?? null,
  };
}

/* ---------------------------------------------------------------- record */

type FunderRow = {
  id: string;
  canonical_org_id: string | null;
  name: string;
  legal_name: string | null;
  org_type: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  registry_website: string | null;
  ntee_code: string | null;
  ruling_date: string | null;
  focus_areas: string[] | null;
  bmf_assets: string | null;
  bmf_income: string | null;
  bmf_revenue: string | null;
  last_verified_at: string | null;
  org_source_dataset: string | null;
  org_source_url: string | null;
  org_license: string | null;
  ein_ident: string | null;
  filing_website: string | null;
  filing_website_period: string | null;
  filing_website_return: string | null;
  application_posture: string | null;
  ap_fy: number | null;
  ap_object_id: string | null;
  ap_period_end: string | null;
  has_part_xv: boolean | null;
  only_preselected: boolean | null;
  contact_name: string | null;
  app_city: string | null;
  app_state: string | null;
  app_zip: string | null;
  has_email: boolean | null;
  has_phone: boolean | null;
  form_and_info_txt: string | null;
  submission_deadlines_txt: string | null;
  restrictions_txt: string | null;
  ap_ein: string | null;
  ap_source_dataset: string | null;
  ap_source_url: string | null;
  ap_license: string | null;
  fin_fy: number | null;
  fin_return_type: string | null;
  fin_object_id: string | null;
  fin_ein: string | null;
  fin_period_end: string | null;
  total_revenue: string | null;
  total_expenses: string | null;
  charitable_disbursements: string | null;
  qualifying_distributions: string | null;
  total_assets_eoy: string | null;
  fmv_assets_eoy: string | null;
  total_liabilities_eoy: string | null;
  net_assets_eoy: string | null;
  n_filings: number | null;
  grants_n: string | null;
  grants_total: string | null;
  grants_first_fy: number | null;
  grants_last_fy: number | null;
};

function toRecord(r: FunderRow): FunderRecord {
  const ein = (r.ein_ident ?? r.fin_ein ?? r.ap_ein ?? null)?.trim() || null;
  const website = r.filing_website ?? r.registry_website ?? null;
  const posture = postureFromDb(r.application_posture);

  const application: ApplicationInfo | null =
    posture && r.ap_object_id
      ? {
          posture,
          fy: r.ap_fy ?? null,
          objectId: r.ap_object_id,
          taxPeriodEnd: r.ap_period_end,
          hasPartXv: Boolean(r.has_part_xv),
          onlyPreselected: r.only_preselected,
          howToApply: r.form_and_info_txt?.trim() || null,
          deadlines: r.submission_deadlines_txt?.trim() || null,
          restrictions: r.restrictions_txt?.trim() || null,
          contactName: publishableContactName(r.contact_name),
          contactNameWithheld: Boolean(r.contact_name?.trim()) && publishableContactName(r.contact_name) === null,
          contactLocation: [r.app_city, r.app_state, r.app_zip].filter(Boolean).join(", ") || null,
          hasEmail: Boolean(r.has_email),
          hasPhone: Boolean(r.has_phone),
          provenance: {
            source: datasetLabel(r.ap_source_dataset, "IRS 990-PF e-file"),
            filingYear: r.ap_fy ?? null,
            objectId: r.ap_object_id,
            sha256: null,
            href: r.ap_source_url,
            license: r.ap_license,
          },
        }
      : null;

  const latest =
    r.fin_object_id
      ? {
          fy: r.fin_fy ?? null,
          returnType: r.fin_return_type ?? "990",
          objectId: r.fin_object_id,
          taxPeriodEnd: r.fin_period_end,
          revenue: r.total_revenue,
          expenses: r.total_expenses,
          giving: r.qualifying_distributions ?? r.charitable_disbursements ?? null,
          assets: r.total_assets_eoy,
          fmvAssets: r.fmv_assets_eoy,
          liabilities: r.total_liabilities_eoy,
          netAssets: r.net_assets_eoy,
          nFilings: r.n_filings ?? 1,
        }
      : null;

  return {
    orgId: r.id,
    canonicalOrgId: r.canonical_org_id,
    name: r.name,
    legalName: r.legal_name && r.legal_name !== r.name ? r.legal_name : null,
    orgType: r.org_type,
    orgTypeLabel: orgTypeLabel(r.org_type),
    ein,
    street: r.street,
    city: r.city,
    state: r.state,
    zip: r.zip,
    website,
    websiteSource: r.filing_website ? "filing" : r.registry_website ? "registry" : null,
    websiteFy: r.filing_website ? fyOf(r.filing_website_period) : null,
    websiteReturnType: r.filing_website ? returnTypeLabel(r.filing_website_return) : null,
    nteeCode: r.ntee_code,
    nteeLabel: nteeMajorLabel(r.ntee_code),
    rulingDate: r.ruling_date,
    focusAreas: r.focus_areas ?? [],
    bmf: {
      assets: r.bmf_assets,
      income: r.bmf_income,
      revenue: r.bmf_revenue,
      lastVerifiedAt: r.last_verified_at,
      provenance: {
        source: datasetLabel(r.org_source_dataset, "IRS Exempt Organizations BMF"),
        filingYear: null,
        objectId: null,
        sha256: null,
        href: r.org_source_url,
        license: r.org_license,
      },
    },
    posture,
    application,
    latest,
    grants: {
      n: toInt(r.grants_n),
      total: r.grants_total,
      firstFy: r.grants_first_fy ?? null,
      lastFy: r.grants_last_fy ?? null,
    },
    snapshot: { orgId: r.id, name: r.name, ein, orgType: r.org_type, city: r.city, state: r.state, website },
  };
}

/**
 * One funder's identity, posture, latest financials and grant totals in one
 * round trip. Memoised per request with React cache() so generateMetadata
 * and the page share a single query.
 */
export const getFunder = cache(async (orgId: string): Promise<FunderRecord | null> => {
  if (!isUuid(orgId)) return null;
  const rows = await corpusQuery(
    (sql) => sql<FunderRow[]>`
      select o.id::text as id, o.canonical_org_id::text as canonical_org_id, o.name, o.legal_name, o.org_type,
             o.street, o.city, o.state, o.zip, o.website as registry_website,
             o.ntee_code, o.ruling_date::text as ruling_date, o.focus_areas,
             o.asset_amount::text as bmf_assets, o.income_amount::text as bmf_income, o.revenue_amount::text as bmf_revenue,
             o.last_verified_at::text as last_verified_at,
             po.source_dataset as org_source_dataset, po.source_url as org_source_url, po.license_name as org_license,
             (select oi.id_value from public.org_identifiers oi
               where oi.org_id = o.id and oi.id_type = 'ein' limit 1) as ein_ident,
             ow.website as filing_website, ow.tax_period as filing_website_period, ow.return_type as filing_website_return,
             ap.application_posture, ap.fy as ap_fy, ap.object_id as ap_object_id,
             ap.tax_period_end::text as ap_period_end, ap.has_part_xv, ap.only_preselected,
             ap.contact_name, ap.app_city, ap.app_state, ap.app_zip, ap.has_email, ap.has_phone,
             ap.form_and_info_txt, ap.submission_deadlines_txt, ap.restrictions_txt, ap.ein::text as ap_ein,
             pap.source_dataset as ap_source_dataset, pap.source_url as ap_source_url, pap.license_name as ap_license,
             fin.fy as fin_fy, fin.return_type as fin_return_type, fin.object_id as fin_object_id,
             fin.ein::text as fin_ein, fin.tax_period_end::text as fin_period_end,
             fin.total_revenue::text as total_revenue, fin.total_expenses::text as total_expenses,
             fin.charitable_disbursements::text as charitable_disbursements,
             fin.qualifying_distributions::text as qualifying_distributions,
             fin.total_assets_eoy::text as total_assets_eoy, fin.fmv_assets_eoy::text as fmv_assets_eoy,
             fin.total_liabilities_eoy::text as total_liabilities_eoy, fin.net_assets_eoy::text as net_assets_eoy,
             fin.n_filings::int as n_filings,
             g.n::text as grants_n, g.total::text as grants_total, g.first_fy as grants_first_fy, g.last_fy as grants_last_fy
      from internal.organizations o
      left join public.organizations po on po.id = o.id
      left join lateral (
        select w.website, w.tax_period, w.return_type
        from internal.org_website w
        where w.org_id = o.id and w.website is not null
        order by w.tax_period desc nulls last, w.object_id desc
        limit 1) ow on true
      left join internal.mv_org_application_posture ap on ap.org_id = o.id
      left join public.org_application_posture pap on pap.org_id = o.id
      left join internal.mv_org_latest_financials fin on fin.org_id = o.id
      left join internal.mv_funder_event_stats g on g.org_id = o.id and g.event_type = 'grant'
      where o.id = ${orgId}::uuid`,
  );
  const row = rows[0];
  return row ? toRecord(row) : null;
});

/* ------------------------------------------------------------ financials */

type FinRow = {
  object_id: string;
  return_type: string;
  tax_period: string | null;
  tax_period_end: string | null;
  fy: number | null;
  amended_return: boolean | null;
  source_dataset: string | null;
  source_url: string | null;
  license_name: string | null;
  total_revenue: string | null;
  total_expenses: string | null;
  qualifying_distributions: string | null;
  charitable_disbursements: string | null;
  contributions_paid: string | null;
  total_grants_paid: string | null;
  contributions_received: string | null;
  total_assets_eoy: string | null;
  fmv_assets_eoy: string | null;
  net_assets_eoy: string | null;
  total_liabilities_eoy: string | null;
  expenses_program_services: string | null;
  expenses_management: string | null;
  expenses_fundraising: string | null;
  officer_comp: string | null;
  total_operating_expenses: string | null;
  total_employees: number | null;
  total_volunteers: number | null;
};

/** Up to ten fiscal years, oldest first, non-superseded filings only. */
export async function getFunderFinancials(orgId: string): Promise<FinancialYear[]> {
  if (!isUuid(orgId)) return [];
  const rows = await corpusQuery(
    (sql) => sql<FinRow[]>`
      select pf.object_id, pf.return_type, pf.tax_period, pf.tax_period_end::text as tax_period_end,
             nullif(left(pf.tax_period, 4), '')::int as fy, pf.amended_return,
             pf.source_dataset, pf.source_url, pf.license_name,
             ff.total_revenue::text, ff.total_expenses::text,
             ff.qualifying_distributions::text, ff.charitable_disbursements::text,
             ff.contributions_paid::text, ff.total_grants_paid::text, ff.contributions_received::text,
             ff.total_assets_eoy::text, ff.fmv_assets_eoy::text, ff.net_assets_eoy::text, ff.total_liabilities_eoy::text,
             ff.expenses_program_services::text, ff.expenses_management::text, ff.expenses_fundraising::text,
             ff.officer_comp::text, ff.total_operating_expenses::text,
             ff.total_employees, ff.total_volunteers
      from public.filings pf
      join internal.filing_financials ff on ff.object_id = pf.object_id
      where pf.org_id = ${orgId}::uuid
        and pf.superseded_by_object_id is null
      order by pf.tax_period desc nulls last, pf.object_id desc
      limit 10`,
  );
  return rows
    .map((r) => ({
      fy: r.fy,
      objectId: r.object_id,
      returnType: r.return_type,
      taxPeriod: r.tax_period,
      taxPeriodEnd: r.tax_period_end,
      amended: r.amended_return,
      revenue: r.total_revenue,
      expenses: r.total_expenses,
      giving: r.qualifying_distributions ?? r.charitable_disbursements ?? null,
      contributionsPaid: r.contributions_paid,
      totalGrantsPaid: r.total_grants_paid,
      contributionsReceived: r.contributions_received,
      assets: r.total_assets_eoy,
      fmvAssets: r.fmv_assets_eoy,
      netAssets: r.net_assets_eoy,
      liabilities: r.total_liabilities_eoy,
      programServices: r.expenses_program_services,
      management: r.expenses_management,
      fundraising: r.expenses_fundraising,
      officerComp: r.officer_comp,
      operatingExpenses: r.total_operating_expenses,
      employees: r.total_employees,
      volunteers: r.total_volunteers,
      provenance: filingProvenance(r),
    }))
    .reverse();
}

/* ---------------------------------------------------------------- grants */

export const GRANTS_PAGE_SIZE = 25;
export const GRANTS_MAX_PAGE = 40;

type GrantRowDb = {
  id: string;
  recipient_name: string | null;
  recipient_org_id: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  amount: string | null;
  fiscal_year: number | null;
  event_date: string | null;
  purpose_text: string | null;
  recipient_relationship: string | null;
  filing_object_id: string | null;
  source_dataset: string | null;
  source_url: string | null;
  total: number;
};

/** One page of grants paid, largest first, with per-row provenance. */
export async function getFunderGrants(
  orgId: string,
  opts: { page?: number; q?: string | null; pageSize?: number } = {},
): Promise<GrantsPage> {
  const pageSize = Math.min(Math.max(1, opts.pageSize ?? GRANTS_PAGE_SIZE), 100);
  const page = Math.min(Math.max(1, Math.trunc(opts.page ?? 1) || 1), GRANTS_MAX_PAGE);
  const q = opts.q?.replace(/\s+/g, " ").trim().slice(0, MAX_GIVING_TO_CHARS) || null;
  const empty: GrantsPage = { rows: [], total: 0, page, pageSize, pageCount: 0, q };
  if (!isUuid(orgId)) return empty;

  const rows = await corpusQuery(
    (sql) => sql<GrantRowDb[]>`
      select pe.id::text as id, pe.recipient_name, pe.recipient_org_id::text as recipient_org_id,
             pe.recipient_city, pe.recipient_state, pe.amount::text as amount, pe.fiscal_year,
             pe.event_date::text as event_date, pe.purpose_text, pe.recipient_relationship,
             pe.filing_object_id, pe.source_dataset, pe.source_url,
             count(*) over()::int as total
      from public.funding_events pe
      where pe.funder_org_id = ${orgId}::uuid
        and pe.event_type = 'grant'
        and (pe.filing_object_id is null or not exists (
              select 1 from internal.filings f
              where f.object_id = pe.filing_object_id and f.superseded_by_object_id is not null))
        ${
          q
            ? sql`and exists (select 1 from internal.funding_events fe
                              where fe.id = pe.id and fe.search_tsv @@ websearch_to_tsquery('english', ${q}))`
            : sql``
        }
      order by pe.amount desc nulls last, pe.id
      limit ${pageSize} offset ${(page - 1) * pageSize}`,
  );
  const total = rows[0]?.total ?? 0;
  return {
    rows: rows.map(
      (r): GrantRow => ({
        id: r.id,
        recipientName: r.recipient_name,
        recipientOrgId: r.recipient_org_id,
        recipientCity: r.recipient_city,
        recipientState: r.recipient_state,
        amount: r.amount,
        fiscalYear: r.fiscal_year,
        eventDate: r.event_date,
        purpose: r.purpose_text?.trim() || null,
        relationship: r.recipient_relationship,
        provenance: {
          source: datasetLabel(r.source_dataset, "IRS 990-PF e-file"),
          filingYear: r.fiscal_year,
          objectId: r.filing_object_id,
          sha256: null,
          href: r.source_url,
          license: null,
        },
      }),
    ),
    total,
    page,
    pageSize,
    pageCount: Math.min(Math.ceil(total / pageSize), GRANTS_MAX_PAGE),
    q,
  };
}

/* -------------------------------------------------------------- officers */

export async function getFunderOfficers(orgId: string): Promise<Officer[]> {
  if (!isUuid(orgId)) return [];
  const rows = await corpusQuery(
    (sql) => sql<
      {
        seq: number;
        person_name: string | null;
        business_name: string | null;
        title: string | null;
        avg_hours_per_week: string | null;
        compensation: string | null;
        object_id: string;
      }[]
    >`
      select fo.seq, fo.person_name, fo.business_name, fo.title,
             fo.avg_hours_per_week::text as avg_hours_per_week, fo.compensation::text as compensation, fo.object_id
      from internal.filing_officers fo
      where fo.object_id = (select fin.object_id from internal.mv_org_latest_financials fin where fin.org_id = ${orgId}::uuid)
      order by fo.seq
      limit 60`,
  );
  return rows.map((r) => ({
    seq: r.seq,
    personName: r.person_name?.trim() || null,
    businessName: r.business_name?.trim() || null,
    title: r.title?.trim() || null,
    hoursPerWeek: r.avg_hours_per_week,
    compensation: r.compensation,
    objectId: r.object_id,
  }));
}

/* -------------------------------------------------------------- contacts */

/**
 * Public contact channels only. The view already limits rows to
 * publishability='public' and privacy_tier<>'red'; the filter here is belt
 * and braces so a view change can only ever show less.
 */
export async function getFunderContacts(orgId: string): Promise<ContactChannel[]> {
  if (!isUuid(orgId)) return [];
  const rows = await corpusQuery(
    (sql) => sql<
      {
        id: string;
        channel_type: string;
        value: string | null;
        is_role_based: boolean | null;
        privacy_tier: string | null;
        last_verified_at: string | null;
        source_dataset: string | null;
        source_url: string | null;
      }[]
    >`
      select cc.id::text as id, cc.channel_type, cc.value, cc.is_role_based, cc.privacy_tier,
             cc.last_verified_at::text as last_verified_at, cc.source_dataset, cc.source_url
      from public.contact_channels cc
      where cc.org_id = ${orgId}::uuid
      order by cc.channel_type, cc.id
      limit 20`,
  );
  return rows
    .filter((r) => typeof r.value === "string" && r.value.trim().length > 0 && r.privacy_tier !== "red")
    .map((r) => ({
      id: r.id,
      channelType: r.channel_type,
      value: (r.value as string).trim(),
      isRoleBased: Boolean(r.is_role_based),
      lastVerifiedAt: r.last_verified_at,
      sourceDataset: r.source_dataset,
      sourceUrl: r.source_url,
    }));
}

/* --------------------------------------------------------------- similar */

export async function getSimilarFunders(orgId: string, limit = 8): Promise<SimilarFunder[]> {
  if (!isUuid(orgId)) return [];
  const rows = await corpusQuery(
    (sql) => sql<{ org_id: string; name: string; org_type: string; state: string | null; size_amount: string | null; dist: number }[]>`
      select s.org_id::text as org_id, s.name, s.org_type, s.state, s.size_amount::text as size_amount, s.dist
      from internal.similar_orgs(${orgId}::uuid, ${limit}, null, null, null, null) s`,
  );
  return rows.map((r) => ({ orgId: r.org_id, name: r.name, orgType: r.org_type, state: r.state, sizeAmount: r.size_amount, dist: r.dist }));
}

/* --------------------------------------------------------------- filings */

/** Non-superseded filings on record, newest first, for the sources panel. */
export async function getFunderFilings(orgId: string): Promise<FilingSummary[]> {
  if (!isUuid(orgId)) return [];
  const rows = await corpusQuery(
    (sql) => sql<
      {
        object_id: string;
        return_type: string;
        tax_period: string | null;
        tax_period_end: string | null;
        fy: number | null;
        amended_return: boolean | null;
        source_dataset: string | null;
        source_url: string | null;
        license_name: string | null;
        xml_zip_url: string | null;
      }[]
    >`
      select pf.object_id, pf.return_type, pf.tax_period, pf.tax_period_end::text as tax_period_end,
             nullif(left(pf.tax_period, 4), '')::int as fy, pf.amended_return,
             pf.source_dataset, pf.source_url, pf.license_name, pf.xml_zip_url
      from public.filings pf
      where pf.org_id = ${orgId}::uuid and pf.superseded_by_object_id is null
      order by pf.tax_period desc nulls last, pf.object_id desc
      limit 12`,
  );
  return rows.map((r) => ({
    objectId: r.object_id,
    returnType: r.return_type,
    taxPeriod: r.tax_period,
    taxPeriodEnd: r.tax_period_end,
    fy: r.fy,
    amended: r.amended_return,
    provenance: filingProvenance(r),
    xmlZipUrl: r.xml_zip_url,
  }));
}

/* --------------------------------------------------------- giving profile */

/** What they fund: recipient NTEE groups and states, from matched grant rows. */
export async function getFunderGivingProfile(orgId: string): Promise<GivingProfile> {
  const empty: GivingProfile = { focus: [], geography: [], resolvedPct: null };
  if (!isUuid(orgId)) return empty;
  return corpusQuery(async (sql) => {
    const [focus, geography, coverage] = await Promise.all([
      sql<{ major: string; n: number; total: string | null }[]>`
        select upper(left(ro.ntee_code, 1)) as major, count(*)::int as n, sum(fe.amount)::text as total
        from internal.funding_events fe
        join internal.organizations ro on ro.id = fe.recipient_org_id
        where fe.funder_org_id = ${orgId}::uuid and fe.event_type = 'grant' and ro.ntee_code is not null
        group by 1
        order by sum(fe.amount) desc nulls last, count(*) desc
        limit 6`,
      sql<{ state: string; n: number; total: string | null }[]>`
        select coalesce(fe.recipient_state, '??') as state, count(*)::int as n, sum(fe.amount)::text as total
        from internal.funding_events fe
        where fe.funder_org_id = ${orgId}::uuid and fe.event_type = 'grant'
        group by 1
        order by sum(fe.amount) desc nulls last, count(*) desc
        limit 8`,
      sql<{ pct: number | null }[]>`
        select round(100.0 * count(*) filter (where fe.recipient_org_id is not null) / nullif(count(*), 0))::int as pct
        from internal.funding_events fe
        where fe.funder_org_id = ${orgId}::uuid and fe.event_type = 'grant'`,
    ]);
    return {
      focus: focus.map((f) => ({ major: f.major, label: nteeMajorLabel(f.major) ?? f.major, n: f.n, total: f.total })),
      geography: geography.map((g) => ({ state: g.state, n: g.n, total: g.total })),
      resolvedPct: coverage[0]?.pct ?? null,
    };
  });
}
