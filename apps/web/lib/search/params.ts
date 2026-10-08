/**
 * THE single validator for search state. The URL is the entire search state:
 * the page, the JSON API and (in the signed-in app) the natural-language
 * filter route all run through this parser, so a model can only set what a
 * hand-typed URL can set, and every filter lands as a visible, removable chip.
 *
 * Keys (all optional):
 *   q                 name, EIN (9 digits, dash optional) or free text
 *   mode              name | keyword | thesis (inferred from q when absent)
 *   type              private_foundation | public_charity | company | gov_agency | all
 *   state             two-letter US state
 *   posture           open | preselected | unknown
 *   min_distributions floor on money paid out in the latest filing (USD)
 *   min_assets        floor on assets (USD)
 *   ntee              NTEE major group letter
 *   giving_to         keywords matched against the funder's grant recipients
 *   sort              relevance | distributions | assets | name
 *   page              1-based, bounded
 *   view              cards | table
 */
import { z } from "zod";

import { detectEin, unquote } from "./ein";

export const SEARCH_MODES = ["name", "keyword", "thesis"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const SEARCH_TYPES = ["all", "private_foundation", "public_charity", "company", "gov_agency"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export const SEARCH_POSTURES = ["open", "preselected", "unknown"] as const;
export type SearchPosture = (typeof SEARCH_POSTURES)[number];

export const SEARCH_SORTS = ["relevance", "distributions", "assets", "name"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export const SEARCH_VIEWS = ["cards", "table"] as const;
export type SearchView = (typeof SEARCH_VIEWS)[number];

export const PAGE_SIZE = 20;
/** Pages are offsets inside a bounded candidate pool (see lib/search/sql.ts). */
export const MAX_PAGE = 20;
export const MAX_QUERY_CHARS = 300;
export const MAX_GIVING_TO_CHARS = 120;
/** Below this the trigram name index cannot be used and the query times out. */
export const MIN_NAME_CHARS = 3;
const MAX_MONEY = 1e13;

export type SearchParams = {
  q: string | null;
  /** Nine digits when `q` is an EIN; the search is then exact. */
  ein: string | null;
  mode: SearchMode;
  type: SearchType;
  state: string | null;
  posture: SearchPosture | null;
  minDistributions: number | null;
  minAssets: number | null;
  ntee: string | null;
  givingTo: string | null;
  sort: SearchSort;
  page: number;
  view: SearchView;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const DEFAULT_SEARCH_PARAMS: SearchParams = {
  q: null,
  ein: null,
  mode: "name",
  type: "all",
  state: null,
  posture: null,
  minDistributions: null,
  minAssets: null,
  ntee: null,
  givingTo: null,
  sort: "relevance",
  page: 1,
  view: "cards",
};

/* ---------------------------------------------------------------- parsing */

function first(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (s === undefined || s === null) return undefined;
  const t = String(s).trim();
  return t === "" ? undefined : t;
}

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, max))
    .optional()
    .catch(undefined);

const money = z.coerce.number().finite().int().min(0).max(MAX_MONEY).optional().catch(undefined);

const RawSchema = z.object({
  q: text(MAX_QUERY_CHARS),
  mode: z.enum(SEARCH_MODES).optional().catch(undefined),
  type: z.enum(SEARCH_TYPES).optional().catch(undefined),
  state: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/))
    .optional()
    .catch(undefined),
  posture: z.enum(SEARCH_POSTURES).optional().catch(undefined),
  min_distributions: money,
  min_assets: money,
  ntee: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]$/))
    .optional()
    .catch(undefined),
  giving_to: text(MAX_GIVING_TO_CHARS),
  sort: z.enum(SEARCH_SORTS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional().catch(undefined),
  view: z.enum(SEARCH_VIEWS).optional().catch(undefined),
});

/**
 * Which mode a bare query means. An EIN is always exact. Quoted text is a
 * name. Three or more words read like a description of work, so they go to
 * the meaning-based search (which falls back to keywords when it is off).
 * Everything else is a name lookup.
 */
export function inferMode(q: string | null): SearchMode {
  if (!q) return "name";
  if (detectEin(q)) return "name";
  if (unquote(q) !== null) return "name";
  const words = q.split(/\s+/).filter(Boolean);
  return words.length >= 3 ? "thesis" : "name";
}

export function parseSearchParams(raw: RawSearchParams | URLSearchParams | null | undefined): SearchParams {
  const record: Record<string, string | undefined> = {};
  if (raw instanceof URLSearchParams) {
    for (const key of raw.keys()) record[key] = first(raw.get(key) ?? undefined);
  } else if (raw) {
    for (const [key, value] of Object.entries(raw)) record[key] = first(value);
  }
  const r = RawSchema.parse(record);

  const q = r.q && r.q.length > 0 ? r.q : null;
  const ein = detectEin(q);
  const mode = r.mode ?? inferMode(q);

  return {
    q,
    ein,
    mode,
    type: r.type ?? "all",
    state: r.state ?? null,
    posture: r.posture ?? null,
    minDistributions: r.min_distributions && r.min_distributions > 0 ? r.min_distributions : null,
    minAssets: r.min_assets && r.min_assets > 0 ? r.min_assets : null,
    ntee: r.ntee ?? null,
    givingTo: r.giving_to && r.giving_to.length > 0 ? r.giving_to : null,
    sort: r.sort ?? "relevance",
    page: r.page ?? 1,
    view: r.view ?? "cards",
  };
}

/* ------------------------------------------------------------ serializing */

/** Params → query string with every default omitted, so URLs stay short and
 *  two equal searches always serialize the same way. No leading "?". */
export function toQueryString(p: Partial<SearchParams>): string {
  const sp = new URLSearchParams();
  const q = p.q ?? null;
  if (q) sp.set("q", q);
  if (p.mode && p.mode !== inferMode(q)) sp.set("mode", p.mode);
  if (p.type && p.type !== "all") sp.set("type", p.type);
  if (p.state) sp.set("state", p.state);
  if (p.posture) sp.set("posture", p.posture);
  if (p.minDistributions) sp.set("min_distributions", String(p.minDistributions));
  if (p.minAssets) sp.set("min_assets", String(p.minAssets));
  if (p.ntee) sp.set("ntee", p.ntee);
  if (p.givingTo) sp.set("giving_to", p.givingTo);
  if (p.sort && p.sort !== "relevance") sp.set("sort", p.sort);
  if (p.page && p.page > 1) sp.set("page", String(p.page));
  if (p.view && p.view !== "cards") sp.set("view", p.view);
  return sp.toString();
}

/** `/search` or `/app/search` plus the query string. */
export function searchHref(base: string, p: Partial<SearchParams>): string {
  const qs = toQueryString(p);
  return qs ? `${base}?${qs}` : base;
}

/** A new state with `patch` applied. Any change resets the page to 1 unless
 *  the patch sets it. */
export function withParams(current: SearchParams, patch: Partial<SearchParams>): SearchParams {
  const next: SearchParams = { ...current, ...patch, page: patch.page ?? 1 };
  next.q = next.q && next.q.trim().length > 0 ? next.q.trim() : null;
  next.ein = detectEin(next.q);
  if (patch.q !== undefined && patch.mode === undefined) next.mode = inferMode(next.q);
  return next;
}

export type FilterKey = "q" | "state" | "type" | "posture" | "minDistributions" | "minAssets" | "ntee" | "givingTo";

export const FILTER_KEYS: readonly FilterKey[] = ["q", "givingTo", "type", "state", "posture", "minDistributions", "minAssets", "ntee"];

export function removeFilter(current: SearchParams, key: FilterKey): SearchParams {
  const patch: Partial<SearchParams> = key === "type" ? { type: "all" } : { [key]: null };
  return withParams(current, patch);
}

/** The filters that are set, in chip order. */
export function activeFilters(p: SearchParams): FilterKey[] {
  return FILTER_KEYS.filter((key) => {
    const v = p[key];
    if (key === "type") return v !== "all";
    return v !== null && v !== undefined && v !== "";
  });
}

/** True when nothing has been asked yet: the page shows its landing state and runs no query. */
export function isEmptySearch(p: SearchParams): boolean {
  return activeFilters(p).length === 0;
}

/** The plain name to match when q is quoted, otherwise q itself. */
export function nameQuery(p: SearchParams): string | null {
  if (!p.q) return null;
  return unquote(p.q) ?? p.q;
}
