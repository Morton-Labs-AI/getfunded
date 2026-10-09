import { sql } from "@/lib/db";

/**
 * Contact channels for an org, with the publication tier enforced IN THE SQL
 * PROJECTION rather than in a component.
 *
 * `value` is returned as NULL for anything not marked publishability='public',
 * so an internal-only address never enters the Node process at all. A render
 * bug therefore cannot leak one — the worst it can do is show nothing. This
 * is the only function any surface should use to read contact data; reading
 * internal.filing_application_info.email directly bypasses the tiering
 * entirely and would publish named individuals.
 */

export interface ContactRow {
  id: string;
  channel_type: string;
  /** NULL whenever the row is not public — by projection, not by convention. */
  value: string | null;
  is_role_based: boolean;
  privacy_tier: string;
  is_public: boolean;
  last_verified_at: string | null;
  dataset_name: string | null;
  sha256: string | null;
  source_url: string | null;
  license_name: string | null;
  downloaded_at: string | null;
  source_record_locator: string | null;
}

export async function orgContactChannels(orgIds: string[]): Promise<ContactRow[]> {
  if (orgIds.length === 0) return [];
  try {
    return await sql<ContactRow[]>`
      select c.id::text,
             c.channel_type,
             case when c.publishability = 'public' then c.value end as value,
             c.is_role_based,
             c.privacy_tier,
             (c.publishability = 'public') as is_public,
             c.last_verified_at::text,
             c.source_record_locator,
             rf.dataset_name, rf.sha256, rf.source_url, rf.downloaded_at::text,
             lm.license_name
      from internal.contact_channels c
      join internal.raw_files rf on rf.id = c.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where c.org_id = any(${orgIds}::uuid[])
      order by (c.publishability = 'public') desc, c.channel_type, c.id`;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[contacts] orgContactChannels unavailable:", err);
    }
    return [];
  }
}

export interface PostureRow {
  org_id: string;
  object_id: string;
  fy: number | null;
  tax_period_end: string | null;
  application_posture: "open" | "preselected_only" | "unknown";
  has_part_xv: boolean;
  contact_name: string | null;
  app_city: string | null;
  app_state: string | null;
  form_and_info_txt: string | null;
  submission_deadlines_txt: string | null;
  restrictions_txt: string | null;
  dataset_name: string;
  sha256: string;
  source_url: string | null;
  license_name: string;
  downloaded_at: string | null;
  source_record_locator: string | null;
}

/** Application posture from the org's latest PARSED non-superseded 990-PF. */
export async function orgApplicationPosture(
  orgIds: string[]
): Promise<PostureRow | null> {
  if (orgIds.length === 0) return null;
  try {
    const rows = await sql<PostureRow[]>`
      select p.org_id::text, p.object_id, p.fy, p.tax_period_end::text,
             p.application_posture, p.has_part_xv, p.contact_name,
             p.app_city, p.app_state,
             p.form_and_info_txt, p.submission_deadlines_txt, p.restrictions_txt,
             p.source_record_locator,
             rf.dataset_name, rf.sha256, rf.source_url, rf.downloaded_at::text,
             lm.license_name
      from internal.mv_org_application_posture p
      join internal.raw_files rf on rf.id = p.raw_file_id
      join internal.licensing_map lm on lm.license_code = rf.license_code
      where p.org_id = any(${orgIds}::uuid[])
      order by p.tax_period desc
      limit 1`;
    return rows[0] ?? null;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[contacts] orgApplicationPosture unavailable:", err);
    }
    return null;
  }
}

export interface FunderOfRecord {
  funder_org_id: string;
  name: string;
  n: number;
  total: string | null;
  first_fy: number | null;
  last_fy: number | null;
}

/**
 * Who has funded this organization — the recipient-side view a foundation
 * uses when vetting a prospective grantee. This is the strongest signal we
 * can offer for a public charity today; revenue/expense ratios need the 990
 * core form, which is not parsed yet (see CHARITY_VETTING_LIMIT_NOTE).
 */
export async function orgFundersOfRecord(
  orgIds: string[],
  limit = 12
): Promise<FunderOfRecord[]> {
  if (orgIds.length === 0) return [];
  try {
    return await sql<FunderOfRecord[]>`
      select coalesce(o.canonical_org_id, o.id)::text as funder_org_id,
             min(o.name) as name,
             count(*)::int as n, sum(fe.amount)::text as total,
             min(fe.fiscal_year) as first_fy, max(fe.fiscal_year) as last_fy
      from internal.funding_events fe
      join internal.organizations o on o.id = fe.funder_org_id
      where fe.recipient_org_id = any(${orgIds}::uuid[])
        and fe.event_type = 'grant'
      group by coalesce(o.canonical_org_id, o.id)
      order by sum(fe.amount) desc nulls last
      limit ${limit}`;
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[contacts] orgFundersOfRecord unavailable:", err);
    }
    return [];
  }
}
