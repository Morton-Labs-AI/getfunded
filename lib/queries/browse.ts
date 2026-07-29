import { sql } from "@/lib/db";

export interface BrowseFilters {
  segment: "foundations" | "advisers" | "funds" | "companies" | "agencies";
  state?: string;
  q?: string;
  minAssets?: number;
  maxAssets?: number;
  ntee?: string;
  era?: "era" | "ria";
  fundType?: string;
  cursor?: { name: string; id: string };
  dir?: "next" | "prev";
}

export interface BrowseRow {
  id: string;
  name: string;
  name_normalized: string;
  org_type: string;
  city: string | null;
  state: string | null;
  ntee_code: string | null;
  asset_amount: string | null;
  aum: string | null;
  fund_size: string | null;
  is_era: boolean | null;
  focus_areas: string[];
  grants_n: string | null;
  grants_total: string | null;
}

const SEGMENT_TYPES: Record<BrowseFilters["segment"], string[]> = {
  foundations: ["private_foundation", "public_charity"],
  advisers: ["vc", "pe", "investment_adviser"],
  funds: ["fund"],
  companies: ["company"],
  agencies: ["gov_agency"],
};

export async function browseOrgs(f: BrowseFilters, limit = 50): Promise<BrowseRow[]> {
  const types = SEGMENT_TYPES[f.segment];
  const sizeCol =
    f.segment === "foundations"
      ? sql`o.asset_amount`
      : f.segment === "advisers"
        ? sql`coalesce(o.aum, o.fund_size)`
        : sql`o.fund_size`;

  const rows = await sql<BrowseRow[]>`
    select o.id, o.name, o.name_normalized, o.org_type, o.city, o.state,
           o.ntee_code, o.asset_amount::text, o.aum::text, o.fund_size::text,
           o.is_era, o.focus_areas,
           g.n::text as grants_n, g.total::text as grants_total
    from internal.organizations o
    left join internal.mv_funder_event_stats g
      on g.org_id = o.id and g.event_type = 'grant'
    where o.org_type = any(${types})
    and o.canonical_org_id is null
    ${f.state ? sql`and o.state = ${f.state.toUpperCase()}` : sql``}
    ${f.ntee ? sql`and o.ntee_code like ${f.ntee + "%"}` : sql``}
    ${f.era === "era" ? sql`and o.is_era = true` : f.era === "ria" ? sql`and o.is_era = false` : sql``}
    ${f.fundType ? sql`and ${f.fundType} = any(o.focus_areas)` : sql``}
    ${f.minAssets ? sql`and ${sizeCol} >= ${f.minAssets}` : sql``}
    ${f.maxAssets ? sql`and ${sizeCol} <= ${f.maxAssets}` : sql``}
    ${f.q ? sql`and o.search_tsv @@ websearch_to_tsquery('english', ${f.q})` : sql``}
    ${
      f.cursor
        ? f.dir === "prev"
          ? sql`and (o.name_normalized, o.id) < (${f.cursor.name}, ${f.cursor.id})`
          : sql`and (o.name_normalized, o.id) > (${f.cursor.name}, ${f.cursor.id})`
        : sql``
    }
    order by o.name_normalized ${f.dir === "prev" ? sql`desc` : sql`asc`}, o.id ${f.dir === "prev" ? sql`desc` : sql`asc`}
    limit ${limit}`;
  return f.dir === "prev" ? rows.reverse() : rows;
}

export async function segmentCounts(): Promise<Record<string, number>> {
  const rows = await sql<{ org_type: string; n: string }[]>`
    select org_type, n::text from internal.mv_org_type_counts`;
  const byType = Object.fromEntries(rows.map((r) => [r.org_type, Number(r.n)]));
  const sum = (types: string[]) => types.reduce((s, t) => s + (byType[t] ?? 0), 0);
  return {
    foundations: sum(SEGMENT_TYPES.foundations),
    advisers: sum(SEGMENT_TYPES.advisers),
    funds: sum(SEGMENT_TYPES.funds),
    companies: sum(SEGMENT_TYPES.companies),
    agencies: sum(SEGMENT_TYPES.agencies),
  };
}
