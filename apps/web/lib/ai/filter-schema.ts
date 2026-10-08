/**
 * Natural-language search filter, the pure half: the output schema, the
 * normaliser that drops anything the model got wrong (an unknown state, a
 * negative dollar amount) instead of passing it on, and the chip labels.
 * Client-safe (the NL bar imports it); no server imports here.
 *
 * The output keys are mapped through `FILTER_PARAM_KEYS` in one place so they
 * can follow lib/search/params.ts when the search builder settles its names.
 */
import { z } from "zod";
export const FILTER_PROMPT_VERSION = "filter-p1";

export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
  "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI", "GU", "AS", "MP",
] as const;
const STATE_SET = new Set<string>(US_STATES);

export const FILTER_ORG_TYPES = ["private_foundation", "public_charity", "company", "gov_agency", "fund", "investment_adviser"] as const;
export const FILTER_POSTURES = ["open", "preselected_only", "unknown"] as const;

/**
 * Query-string keys for each filter. ONE place to change when lib/search/params.ts
 * settles its names; the NL bar and the route both read from here.
 */
export const FILTER_PARAM_KEYS = {
  q: "q",
  like: "like",
  orgType: "type",
  state: "state",
  posture: "posture",
  ntee: "ntee",
  minGiving: "min_giving",
  minAssets: "min_assets",
  maxAssets: "max_assets",
} as const;
export type FilterKey = keyof typeof FILTER_PARAM_KEYS;

/** What the model may set. Everything optional; `replace` clears filters the sentence does not mention. */
export const FilterToolOutput = z
  .object({
    q: z.string().max(200).nullish(),
    like: z.string().max(400).nullish(),
    org_type: z.string().max(40).nullish(),
    state: z.string().max(40).nullish(),
    posture: z.string().max(40).nullish(),
    ntee: z.string().max(4).nullish(),
    min_giving: z.number().nullish(),
    min_assets: z.number().nullish(),
    max_assets: z.number().nullish(),
    replace: z.boolean().nullish(),
  })
  .loose();
export type FilterToolOutput = z.infer<typeof FilterToolOutput>;

export type FilterChip = { key: FilterKey; param: string; value: string; label: string };

export type NormalizedFilter = {
  /** Query-string params to apply (already keyed through FILTER_PARAM_KEYS). */
  params: Record<string, string>;
  chips: FilterChip[];
  /** True when the sentence described a whole new search rather than a refinement. */
  replace: boolean;
};

export const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT",
  delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI",
  minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
  "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", "puerto rico": "PR",
};

export function normalizeState(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  const upper = t.toUpperCase();
  if (STATE_SET.has(upper)) return upper;
  return STATE_NAMES[t.toLowerCase()] ?? null;
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function money(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v);
}

const compact = (n: number) =>
  n >= 1_000_000_000 ? `$${(n / 1_000_000_000).toFixed(n % 1_000_000_000 === 0 ? 0 : 1)}B` :
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` :
  n >= 1_000 ? `$${Math.round(n / 1_000)}K` :
  `$${n}`;

const ORG_TYPE_LABELS: Record<string, string> = {
  private_foundation: "Private foundations",
  public_charity: "Public charities",
  company: "Companies",
  gov_agency: "Government agencies",
  fund: "Funds",
  investment_adviser: "Investment advisers",
};

const POSTURE_LABELS: Record<string, string> = {
  open: "Accepts applications",
  preselected_only: "Funds preselected organizations only",
  unknown: "Not stated in filings",
};

/**
 * Keep only what is valid; drop the rest silently. The person sees the chips
 * and can remove any, so a dropped value is a missing chip, never a wrong one.
 */
export function normalizeFilter(raw: unknown): NormalizedFilter {
  const parsed = FilterToolOutput.safeParse(raw);
  const o: FilterToolOutput = parsed.success ? parsed.data : {};
  const params: Record<string, string> = {};
  const chips: FilterChip[] = [];
  const set = (key: FilterKey, value: string, label: string) => {
    params[FILTER_PARAM_KEYS[key]] = value;
    chips.push({ key, param: FILTER_PARAM_KEYS[key], value, label });
  };

  const q = cleanText(o.q, 200);
  if (q) set("q", q, `Name or EIN: ${q}`);
  const like = cleanText(o.like, 400);
  if (like) set("like", like, `Funds work like: ${like}`);
  const orgType = typeof o.org_type === "string" ? o.org_type.trim().toLowerCase() : null;
  if (orgType && (FILTER_ORG_TYPES as readonly string[]).includes(orgType)) set("orgType", orgType, ORG_TYPE_LABELS[orgType] ?? orgType);
  const state = normalizeState(o.state);
  if (state) set("state", state, `State: ${state}`);
  const posture = typeof o.posture === "string" ? o.posture.trim().toLowerCase() : null;
  if (posture && (FILTER_POSTURES as readonly string[]).includes(posture)) set("posture", posture, POSTURE_LABELS[posture]);
  const ntee = typeof o.ntee === "string" ? o.ntee.trim().toUpperCase() : null;
  if (ntee && /^[A-Z]$/.test(ntee)) set("ntee", ntee, `NTEE group ${ntee}`);
  const minGiving = money(o.min_giving);
  if (minGiving) set("minGiving", String(minGiving), `Gives at least ${compact(minGiving)} a year`);
  const minAssets = money(o.min_assets);
  if (minAssets) set("minAssets", String(minAssets), `Assets at least ${compact(minAssets)}`);
  const maxAssets = money(o.max_assets);
  if (maxAssets && (!minAssets || maxAssets >= minAssets)) set("maxAssets", String(maxAssets), `Assets at most ${compact(maxAssets)}`);

  return { params, chips, replace: o.replace === true };
}

/** Merge the current query string with the new params (replace drops every known filter key first). */
export function mergeFilterParams(
  current: Record<string, string | string[] | undefined> | undefined,
  next: NormalizedFilter,
): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set<string>(Object.values(FILTER_PARAM_KEYS));
  for (const [k, v] of Object.entries(current ?? {})) {
    if (next.replace && known.has(k)) continue;
    if (k === "page") continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s !== "") out[k] = s;
  }
  return { ...out, ...next.params };
}

