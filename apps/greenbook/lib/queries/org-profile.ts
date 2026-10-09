import { sql } from "@/lib/db";
import type { EventRow } from "@/lib/queries/orgs";

/**
 * Foundation-profile queries. Every function takes the canonical cluster's
 * memberIds (the org + its merged records) and predicates on
 * `funder_org_id = any(memberIds)` — same member-array idiom as orgs.ts —
 * restricted to event_type = 'grant'.
 */

export interface GrantPageRow extends EventRow {
  // per-row provenance (the file the grant row actually came from)
  dataset_name: string;
  sha256: string;
  source_url: string | null;
  license_name: string;
  downloaded_at: string;
  /** window count of the full filtered set (same value on every row) */
  total_rows: number;
}

/** One page of a foundation's grants, amount-descending, with per-row file
    provenance and a windowed total for the pager. `q` is websearch syntax
    over the event tsvector (recipient + purpose). */
export async function orgGrantsPage(
  memberIds: string[],
  {
    q,
    page = 1,
    pageSize = 50,
  }: { q?: string; page?: number; pageSize?: number } = {}
): Promise<GrantPageRow[]> {
  const offset = (Math.max(1, page) - 1) * pageSize;
  const query = q?.trim();
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
    where fe.funder_org_id = any(${memberIds}::uuid[])
      and fe.event_type = 'grant'
      ${query ? sql`and fe.search_tsv @@ websearch_to_tsquery('english', ${query})` : sql``}
    order by fe.amount desc nulls last, fe.id
    limit ${pageSize} offset ${offset}`;
}

export interface GeoRow {
  state: string;
  n: number;
  total: string | null;
}
/** Grant dollars by recipient state, as reported in the filing ('??' when
    the filing carries none). */
export async function orgGrantGeography(memberIds: string[]): Promise<GeoRow[]> {
  return await sql<GeoRow[]>`
    select coalesce(fe.recipient_state, '??') as state,
           count(*)::int as n, sum(fe.amount)::text as total
    from internal.funding_events fe
    where fe.funder_org_id = any(${memberIds}::uuid[])
      and fe.event_type = 'grant'
    group by coalesce(fe.recipient_state, '??')
    order by sum(fe.amount) desc nulls last`;
}

export interface TopRecipientRow {
  display_name: string;
  recipient_org_id: string | null;
  n: number;
  total: string | null;
  first_fy: number | null;
  last_fy: number | null;
}
/** Top recipients grouped by resolved org where available, otherwise by the
    exact reported name (case/whitespace-normalized). No fuzzy folding —
    spelling variants stay separate rows, never merged by guesswork. */
export async function orgTopRecipients(
  memberIds: string[],
  limit = 15
): Promise<TopRecipientRow[]> {
  return await sql<TopRecipientRow[]>`
    select min(fe.recipient_name) as display_name,
           max(fe.recipient_org_id::text) as recipient_org_id,
           count(*)::int as n, sum(fe.amount)::text as total,
           min(fe.fiscal_year) as first_fy, max(fe.fiscal_year) as last_fy
    from internal.funding_events fe
    where fe.funder_org_id = any(${memberIds}::uuid[])
      and fe.event_type = 'grant'
    group by coalesce(fe.recipient_org_id::text, upper(btrim(fe.recipient_name)))
    order by sum(fe.amount) desc nulls last
    limit ${limit}`;
}

export interface FunderStatsExtended {
  median_amount: string | null;
  distinct_recipients: number;
  resolved_rows_pct: number | null;
  resolved_dollars_pct: number | null;
}
/** Median grant, distinct-recipient count (same grouping key as
    orgTopRecipients), and resolved coverage as % of rows and % of dollars. */
export async function orgFunderStatsExtended(
  memberIds: string[]
): Promise<FunderStatsExtended | null> {
  const rows = await sql<FunderStatsExtended[]>`
    select percentile_cont(0.5) within group (order by fe.amount)::text
             as median_amount,
           count(distinct coalesce(fe.recipient_org_id::text,
                                   upper(btrim(fe.recipient_name))))::int
             as distinct_recipients,
           round(100.0 * count(*) filter (where fe.recipient_org_id is not null)
                 / nullif(count(*), 0))::int as resolved_rows_pct,
           round(100.0 * sum(fe.amount) filter (where fe.recipient_org_id is not null)
                 / nullif(sum(fe.amount), 0))::int as resolved_dollars_pct
    from internal.funding_events fe
    where fe.funder_org_id = any(${memberIds}::uuid[])
      and fe.event_type = 'grant'`;
  return rows[0] ?? null;
}

export interface ProvFileRow {
  raw_file_id: string;
  dataset_name: string;
  sha256: string;
  source_url: string | null;
  license_name: string;
  downloaded_at: string;
  n_events: number;
  first_fy: number | null;
  last_fy: number | null;
}
/** Every raw file feeding the org's grant rows, plus the org row's own file
    (n_events 0 when it carries no grants). Org file first, then by acquisition. */
export async function orgProvenanceFiles(
  memberIds: string[],
  orgRawFileId: string
): Promise<ProvFileRow[]> {
  return await sql<ProvFileRow[]>`
    with grant_files as (
      select fe.raw_file_id, count(*)::int as n_events,
             min(fe.fiscal_year) as first_fy, max(fe.fiscal_year) as last_fy
      from internal.funding_events fe
      where fe.funder_org_id = any(${memberIds}::uuid[])
        and fe.event_type = 'grant'
      group by fe.raw_file_id
    )
    select rf.id as raw_file_id, rf.dataset_name, rf.sha256, rf.source_url,
           lm.license_name, rf.downloaded_at::text,
           coalesce(gf.n_events, 0) as n_events, gf.first_fy, gf.last_fy
    from internal.raw_files rf
    join internal.licensing_map lm on lm.license_code = rf.license_code
    left join grant_files gf on gf.raw_file_id = rf.id
    where rf.id = ${orgRawFileId}
       or rf.id in (select raw_file_id from grant_files)
    order by (rf.id = ${orgRawFileId}) desc, rf.downloaded_at, rf.dataset_name`;
}

export interface SimilarOrgRow {
  org_id: string;
  name: string;
  org_type: string;
  state: string | null;
  size_amount: string | null;
  dist: number;
}
/** Nearest giving profiles by doc embedding (internal.similar_orgs, migration
    0012). The function itself excludes the seed org and merged-away rows.
    Soft-fails to [] so the profile renders when the function is absent. */
export async function similarOrgs(id: string): Promise<SimilarOrgRow[]> {
  try {
    return await sql<SimilarOrgRow[]>`
      select org_id, name, org_type, state, size_amount, dist
      from internal.similar_orgs(${id}, 12)`;
  } catch (e) {
    console.warn(`similarOrgs unavailable for ${id}:`, (e as Error).message);
    return [];
  }
}

export interface WebFactsPerson {
  full_name: string;
  title?: string | null;
  role: "program_officer" | "executive" | "staff" | "board";
  source_page: string;
}
export interface OrgWebFactsRow {
  website_url: string;
  focus_areas: string[];
  giving_priorities: string | null;
  application_info: string | null;
  application_url: string | null;
  accepts_unsolicited: boolean | null;
  geographic_focus: string[];
  people: WebFactsPerson[] | null;
  extracted_summary: string | null;
  extraction_model: string;
  extracted_at: string;
  source_record_locator: string;
  dataset_name: string;
  sha256: string;
  source_url: string | null;
  license_name: string;
  downloaded_at: string;
}
/** The confirmed website enrichment for this org, if any (migration 0012).
    Internal-only display data — model-extracted, human-confirmed, never
    filing-sourced. Soft-fails to null so the profile never depends on it. */
export async function orgWebFacts(memberIds: string[]): Promise<OrgWebFactsRow | null> {
  try {
    const rows = await sql<OrgWebFactsRow[]>`
      select w.website_url, w.focus_areas, w.giving_priorities,
             w.application_info, w.application_url, w.accepts_unsolicited,
             w.geographic_focus, w.people, w.extracted_summary,
             w.extraction_model, w.extracted_at::text, w.source_record_locator,
             rf.dataset_name, rf.sha256, rf.source_url, lm.license_name,
             rf.downloaded_at::text
      from internal.org_web_facts w
      join internal.raw_files rf on rf.id = w.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where w.org_id = any(${memberIds}::uuid[]) and w.status = 'confirmed'
      order by w.extracted_at desc
      limit 1`;
    return rows[0] ?? null;
  } catch (e) {
    console.warn("orgWebFacts unavailable:", (e as Error).message);
    return null;
  }
}

export interface FilingWebsiteRow {
  website: string;
  object_id: string;
  tax_period: string;
  return_type: string;
}
/** Filer-stated website from the latest PARSED filing (migration 0023).
    First-party public-domain data — the org wrote it on the 990 itself — so
    unlike org_web_facts it is republishable and lives in the export. The
    view already enforces latest-parsed precedence and supersession; the sort
    here only arbitrates across a canonical cluster's members. Soft-fails to
    null on a pre-0023 database. */
export async function orgFilingWebsite(
  memberIds: string[],
): Promise<FilingWebsiteRow | null> {
  try {
    const rows = await sql<FilingWebsiteRow[]>`
      select ow.website, ow.object_id, ow.tax_period, ow.return_type
      from internal.org_website ow
      where ow.org_id = any(${memberIds}::uuid[])
      order by ow.tax_period desc, ow.object_id desc
      limit 1`;
    return rows[0] ?? null;
  } catch (e) {
    console.warn("orgFilingWebsite unavailable:", (e as Error).message);
    return null;
  }
}
