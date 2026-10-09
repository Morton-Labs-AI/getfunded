import { sql } from "@/lib/db";
import { unstable_cache } from "next/cache";

export interface OverviewTotals {
  orgs: string;
  people: string;
  events: string;
  relationships: string;
  programs: string;
  raw_files: string;
  total_amount: string;
  refreshed_at: string;
}

export interface EventTypeTotal {
  event_type: string;
  n: string;
  total: string | null;
}

export interface OrgTypeCount {
  org_type: string;
  n: string;
  assets: string | null;
  aum: string | null;
}

export const getOverviewTotals = unstable_cache(
  async (): Promise<OverviewTotals> => {
    const rows = await sql<OverviewTotals[]>`
      select orgs::text, people::text, events::text, relationships::text,
             programs::text, raw_files::text, total_amount::text,
             refreshed_at::text
      from internal.mv_overview_totals`;
    return rows[0];
  },
  ["overview-totals"],
  { revalidate: 3600 }
);

export const getEventTypeTotals = unstable_cache(
  async (): Promise<EventTypeTotal[]> => {
    return await sql<EventTypeTotal[]>`
      select event_type, n::text, total::text
      from internal.mv_event_type_totals
      order by n desc`;
  },
  ["event-type-totals"],
  { revalidate: 3600 }
);

export const getOrgTypeCounts = unstable_cache(
  async (): Promise<OrgTypeCount[]> => {
    return await sql<OrgTypeCount[]>`
      select org_type, n::text, assets::text, aum::text
      from internal.mv_org_type_counts
      order by n desc`;
  },
  ["org-type-counts"],
  { revalidate: 3600 }
);
