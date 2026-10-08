import "server-only";

/**
 * Corpus-wide counts for the search landing state. Read from the
 * materialized views, so the numbers are as fresh as the last refresh
 * (`refreshedAt` says when) and never hard-coded in copy.
 */
import { corpusQuery } from "@/lib/db/corpus";

import type { CorpusCounts } from "./types";

export async function getCorpusCounts(): Promise<CorpusCounts> {
  return corpusQuery(async (sql) => {
    const [types, postures, totals] = await Promise.all([
      sql<{ org_type: string; n: string }[]>`select org_type, n::text as n from internal.mv_org_type_counts`,
      sql<{ application_posture: string; n: string }[]>`
        select application_posture, count(*)::text as n
        from internal.mv_org_application_posture
        group by application_posture`,
      sql<{ events: string | null; refreshed_at: string | null }[]>`
        select events::text as events, refreshed_at::text as refreshed_at from internal.mv_overview_totals limit 1`,
    ]);
    return {
      byType: Object.fromEntries(types.map((t) => [t.org_type, Number(t.n)])),
      byPosture: Object.fromEntries(postures.map((p) => [p.application_posture, Number(p.n)])),
      events: totals[0]?.events ? Number(totals[0].events) : null,
      refreshedAt: totals[0]?.refreshed_at ?? null,
    };
  });
}
