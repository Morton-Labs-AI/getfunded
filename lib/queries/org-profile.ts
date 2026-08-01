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
