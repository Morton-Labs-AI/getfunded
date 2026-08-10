import { sql } from "@/lib/db";
import { embedQuery, vecLiteral } from "@/lib/ai/embed";

export type Posture = "open" | "preselected" | "unstated";

export interface BrowseFilters {
  segment: "foundations" | "advisers" | "funds" | "companies" | "agencies";
  state?: string;
  q?: string;
  thesis?: string;
  minAssets?: number;
  maxAssets?: number;
  /** Application posture from the latest parsed 990-PF Part XV. */
  posture?: Posture;
  /** Floor on money actually paid out (qualifying distributions). */
  minDist?: number;
  /** Which money screen the preset row writes. */
  basis?: "assets" | "dist";
  ntee?: string;
  era?: "era" | "ria";
  fundType?: string;
  cursor?: { name: string; id: string };
  dir?: "next" | "prev";
}

const POSTURES: Posture[] = ["open", "preselected", "unstated"];
/** UI value -> the value stored in mv_org_application_posture. */
const POSTURE_DB: Record<Posture, string> = {
  open: "open",
  preselected: "preselected_only",
  unstated: "unknown",
};

const STATE_RE = /^[A-Z]{2}$/;

function posInt(v: string | undefined, max = 1e15): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
}

/**
 * The single validator for browse params. Exported so /api/filters can run
 * the model's tool output through exactly the same allowlist the URL takes —
 * a JSON schema is a contract with a cooperative caller, not a check.
 */
export function parseBrowseFilters(
  sp: Record<string, string | undefined>
): BrowseFilters & { page: number } {
  const segment = (["foundations", "advisers", "funds", "companies", "agencies"] as const)
    .find((s) => s === sp.segment) ?? "foundations";
  const state = sp.state?.toUpperCase();
  const posture = POSTURES.find((p) => p === sp.posture);
  // A cursor is only usable when it splits into exactly two non-empty parts;
  // otherwise postgres.js binds undefined as NULL, the row-comparison
  // evaluates NULL, and the page comes back silently empty.
  const parts = sp.cursor?.split("~~") ?? [];
  const cursor =
    parts.length === 2 && parts[0] !== "" && parts[1] !== ""
      ? { name: parts[0], id: parts[1] }
      : undefined;
  return {
    segment,
    state: state && STATE_RE.test(state) ? state : undefined,
    q: sp.q || undefined,
    thesis: sp.thesis || undefined,
    minAssets: posInt(sp.min),
    maxAssets: posInt(sp.max),
    posture,
    minDist: posInt(sp.mindist),
    basis: sp.basis === "assets" ? "assets" : sp.basis === "dist" ? "dist" : undefined,
    ntee: sp.ntee && /^[A-Z]$/.test(sp.ntee) ? sp.ntee : undefined,
    era: sp.era === "era" ? "era" : sp.era === "ria" ? "ria" : undefined,
    fundType: sp.fundType || undefined,
    cursor,
    dir: sp.dir === "prev" ? "prev" : "next",
    page: Math.max(0, Math.min(Number(sp.page) || 0, 200)),
  };
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
    -- Both MVs are unique on org_id, so these stay 1:1 and the keyset cursor
    -- below is unaffected. A duplicate org_id here would corrupt pagination.
    left join internal.mv_org_application_posture ap on ap.org_id = o.id
    left join internal.mv_org_latest_financials fin on fin.org_id = o.id
    where o.org_type = any(${types})
    and o.canonical_org_id is null
    ${f.state ? sql`and o.state = ${f.state.toUpperCase()}` : sql``}
    ${f.ntee ? sql`and o.ntee_code like ${f.ntee + "%"}` : sql``}
    ${f.era === "era" ? sql`and o.is_era = true` : f.era === "ria" ? sql`and o.is_era = false` : sql``}
    ${f.fundType ? sql`and ${f.fundType} = any(o.focus_areas)` : sql``}
    ${f.minAssets ? sql`and ${sizeCol} >= ${f.minAssets}` : sql``}
    ${f.maxAssets ? sql`and ${sizeCol} <= ${f.maxAssets}` : sql``}
    ${f.posture ? sql`and ap.application_posture = ${POSTURE_DB[f.posture]}` : sql``}
    ${f.minDist ? sql`and fin.qualifying_distributions >= ${f.minDist}` : sql``}
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

// Segments with semantic-corpus docs (funds and agencies have none —
// thesis matching silently degrades to the plain path there).
const SEGMENT_KINDS: Partial<Record<BrowseFilters["segment"], string[]>> = {
  foundations: ["foundation"],
  advisers: ["adviser"],
  companies: ["company"],
};

export interface ThesisResult {
  rows: BrowseRow[];
  /** Post-filter match count within the top-200 RRF set; -1 on fallback. */
  totalMatched: number;
  /** True when the semantic leg was unavailable and keyword search ran. */
  fallback: boolean;
}

export function thesisCapable(segment: BrowseFilters["segment"]): boolean {
  return segment in SEGMENT_KINDS;
}

/** Candidate pool the thesis path ranks within. Before migration 0020 both
    hybrid_search legs hard-capped at 50, so asking for 200 silently returned
    ~100 and the "top N" label was wrong. */
const LEG_LIMIT = 200;

/** Hybrid-search-backed browse: RRF-ordered matches, offset-paged within a
    fixed candidate pool (keyset cursors don't apply to rank order).

    Posture and distribution predicates go INSIDE hybrid_search, never in the
    post-filter block below. Open-to-apply is ~16% of the corpus, so
    post-filtering a 200-row pool would leave ~30 rows nationally and ~0 with
    a state filter — and those survivors would be the leftovers of a
    preselected-dominated ranking, not the best open foundations. That is
    exactly the bug migration 0011 exists to prevent, in a new dimension. */
export async function browseOrgsByThesis(
  f: BrowseFilters & { thesis: string },
  page = 0,
  perPage = 50
): Promise<ThesisResult> {
  const kinds = SEGMENT_KINDS[f.segment];
  if (!kinds) return { rows: await browseOrgs(f), totalMatched: -1, fallback: true };

  let vec: number[];
  try {
    vec = await embedQuery(f.thesis);
  } catch {
    // Voyage unavailable — keyword fallback, flagged so the page says so.
    return {
      rows: await browseOrgs({ ...f, q: f.thesis }),
      totalMatched: -1,
      fallback: true,
    };
  }

  const types = SEGMENT_TYPES[f.segment];
  const sizeCol =
    f.segment === "foundations"
      ? sql`o.asset_amount`
      : f.segment === "advisers"
        ? sql`coalesce(o.aum, o.fund_size)`
        : sql`o.fund_size`;

  // row_number() over () preserves the SRF's RRF output order; the outer
  // order by ord keeps it through the joins and post-filters.
  const rows = await sql<BrowseRow[]>`
    with hits as (
      select h.org_id, row_number() over () as ord
      from internal.hybrid_search(
             ${f.thesis},
             ${vecLiteral(vec)}::extensions.halfvec(512),
             ${LEG_LIMIT},
             ${kinds}::text[],
             ${types}::text[],
             ${f.state ? f.state.toUpperCase() : null},
             ${f.minAssets ?? null},
             ${f.posture ? [POSTURE_DB[f.posture]] : null}::text[],
             ${f.minDist ?? null}) h
      where h.org_id is not null
    )
    select o.id, o.name, o.name_normalized, o.org_type, o.city, o.state,
           o.ntee_code, o.asset_amount::text, o.aum::text, o.fund_size::text,
           o.is_era, o.focus_areas,
           g.n::text as grants_n, g.total::text as grants_total
    from hits h
    join internal.organizations o on o.id = h.org_id
    left join internal.mv_funder_event_stats g
      on g.org_id = o.id and g.event_type = 'grant'
    where o.canonical_org_id is null
    ${f.ntee ? sql`and o.ntee_code like ${f.ntee + "%"}` : sql``}
    ${f.era === "era" ? sql`and o.is_era = true` : f.era === "ria" ? sql`and o.is_era = false` : sql``}
    ${f.fundType ? sql`and ${f.fundType} = any(o.focus_areas)` : sql``}
    ${f.maxAssets ? sql`and ${sizeCol} <= ${f.maxAssets}` : sql``}
    order by h.ord`;

  return {
    rows: rows.slice(page * perPage, (page + 1) * perPage),
    totalMatched: rows.length,
    fallback: false,
  };
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
