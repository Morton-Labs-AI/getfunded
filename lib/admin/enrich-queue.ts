import { sql } from "@/lib/db";

/**
 * The enrichment worklist: grantmakers by latest-filing giving, having a
 * website candidate (filer-stated via internal.org_website, else a registry
 * source on the org row) and no confirmed org_web_facts yet.
 *
 * Deliberately NOT filtered by application posture — `unknown` is an absence
 * of a statement, not a refusal, and an open-only default would delete every
 * grantmaking public charity from the queue (the E5 lesson). Posture is a
 * display column here, nothing more.
 *
 * Read-only (funder_ro); the admin layout guard controls who sees it.
 */
export interface EnrichQueueRow {
  id: string;
  name: string;
  org_type: string;
  state: string | null;
  return_type: string;
  fy: number;
  giving: string | null;
  website: string;
  application_posture: string | null;
}

export async function enrichQueue(limit = 50): Promise<EnrichQueueRow[]> {
  try {
    // Giving, not size: qualifying_distributions for 990-PF; the Part IX
    // grants-paid line (filing_financials.total_grants_paid) for 990s. A
    // total_expenses fallback would rank hospitals and universities by their
    // operating budgets — measured 2026-08-10: Dignity Health $11B of
    // operating expense outranked every actual foundation.
    return await sql<EnrichQueueRow[]>`
      select o.id, o.name, o.org_type, o.state,
             m.return_type, m.fy,
             coalesce(m.qualifying_distributions, ff.total_grants_paid)::text as giving,
             coalesce(ow.website, o.website) as website,
             ap.application_posture
      from internal.mv_org_latest_financials m
      join internal.organizations o on o.id = m.org_id
      left join internal.filing_financials ff on ff.object_id = m.object_id
      left join internal.org_website ow on ow.org_id = m.org_id
      left join internal.mv_org_application_posture ap on ap.org_id = m.org_id
      where coalesce(ow.website, o.website) is not null
        and coalesce(m.qualifying_distributions, ff.total_grants_paid) > 0
        and not exists (select 1 from internal.org_web_facts w
                        where w.org_id = m.org_id and w.status = 'confirmed')
      order by coalesce(m.qualifying_distributions, ff.total_grants_paid) desc
      limit ${limit}`;
  } catch (e) {
    console.warn("enrichQueue unavailable:", (e as Error).message);
    return [];
  }
}
