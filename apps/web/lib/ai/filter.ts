import "server-only";
/**
 * Natural-language search filter: one sentence → the same filter chips a
 * person could set by hand. Never free SQL: a fixed tool schema (forced call),
 * then the deterministic normaliser in ./filter-schema. Metered as 'filter'.
 */
import { z } from "zod";
import type { AiRequest, Tool } from "@/lib/ai/types";
import { meter, type MeterDeps } from "@/lib/billing/meter";
import { parseSearchParams, type SearchParams } from "@/lib/search/params";
import { filterToSearchParams, type FilterDropped } from "./filter-search";
import {
  FILTER_ORG_TYPES,
  FILTER_POSTURES,
  FILTER_PROMPT_VERSION,
  STATE_NAMES,
  mergeFilterParams,
  normalizeFilter,
  type FilterToolOutput,
  type NormalizedFilter,
} from "./filter-schema";
import { AiOutputRejectedError } from "./http";

export * from "./filter-schema";

export function buildFilterTool(): Tool {
  return {
    name: "set_search_filters",
    description: "Set the funder search filters that match the person's sentence. Set only what the sentence supports; leave the rest null.",
    input_schema: {
      type: "object",
      properties: {
        q: { type: ["string", "null"], description: "Only for a funder NAME or EIN the person typed, e.g. 'Meyer Memorial'. Not for topics." },
        like: {
          type: ["string", "null"],
          description: "What they FUND, as a short description for semantic search over giving behaviour, e.g. 'food banks and hunger relief' or 'youth mental health'. Prefer this for any subject matter.",
        },
        org_type: { type: ["string", "null"], enum: [...FILTER_ORG_TYPES, null], description: "Only when the sentence names a kind of funder." },
        state: { type: ["string", "null"], description: "Two-letter US state code of the FUNDER's location when the sentence names a state or a city's state." },
        posture: {
          type: ["string", "null"],
          enum: [...FILTER_POSTURES, null],
          description:
            "Application posture from the latest 990-PF: 'open' when they say accepts applications / open to proposals; 'preselected_only' when they ask for funders that do not take applications; 'unknown' only when they ask for funders with no statement. Note 'unknown' is an absence, not a closed door.",
        },
        ntee: { type: ["string", "null"], description: "One NTEE major-group letter A-Z when the sentence maps cleanly to one (e.g. K = food, B = education, E = health)." },
        min_giving: { type: ["number", "null"], description: "Minimum dollars PAID OUT per year when the person describes giving volume ('gave over $500k', 'big grantmakers')." },
        min_assets: { type: ["number", "null"], description: "Minimum assets in dollars, only when the person talks about assets or endowment size." },
        max_assets: { type: ["number", "null"], description: "Maximum assets in dollars ('small family foundations')." },
        replace: { type: "boolean", description: "True when the sentence describes a new search; false when it refines the current filters ('also in Oregon')." },
      },
      required: ["q", "like", "org_type", "state", "posture", "ntee", "min_giving", "min_assets", "max_assets", "replace"],
      additionalProperties: false,
    },
  };
}

export function buildFilterSystem(): string {
  return [
    "You turn a fundraiser's sentence into funder search filters by calling set_search_filters.",
    "The database holds US private foundations, public charities, companies and federal agencies built from public filings.",
    "Rules: set only what the sentence supports. Subject matter goes in `like` (semantic), never in `q`.",
    "`q` is only for a funder's name or EIN. Dollar words: 'gives/paid/grants over $X' → min_giving;",
    "'assets/endowment over $X' → min_assets. 'accepts applications', 'open to proposals' → posture open.",
    "Write dollar amounts as plain numbers (500000, not '500k'). Use null for anything not stated.",
    "Set replace=true when the sentence stands on its own; false when it adds to the current filters.",
  ].join("\n");
}

export function buildFilterRequest(text: string, current: Record<string, string | string[] | undefined> | undefined, userId?: string): AiRequest {
  const currentLine = current && Object.keys(current).length > 0 ? `CURRENT FILTERS: ${JSON.stringify(current)}\n` : "";
  return {
    system: buildFilterSystem(),
    messages: [{ role: "user", content: `${currentLine}SENTENCE: ${text}` }],
    tools: [buildFilterTool()],
    toolChoice: { name: "set_search_filters" },
    maxTokens: 600,
    effort: "low",
    userId,
  };
}

/* ------------------------------------------------------------------------ */
/* Metered call                                                              */
/* ------------------------------------------------------------------------ */

export const FilterInput = z.object({
  text: z.string().trim().min(2).max(500),
  current: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
});
export type FilterInput = z.infer<typeof FilterInput>;

export type FilterResult = NormalizedFilter & {
  /** The next search state, translated through ./filter-search (serialize with `toQueryString`). */
  searchParams: SearchParams;
  /** Filters the model set that the search page cannot express yet. */
  dropped: FilterDropped[];
  /** The merged query-string params (model vocabulary); prefer `searchParams`. */
  merged: Record<string, string>;
  interpretation: string;
  mock: boolean;
};

/** One sentence → chips. Metered as 'filter' (1 credit). */
export async function runFilter(
  ctx: { userId: string; workspaceId: string },
  inputIn: FilterInput,
  deps: MeterDeps = {},
): Promise<FilterResult> {
  const input = FilterInput.parse(inputIn);
  return meter(
    { userId: ctx.userId, workspaceId: ctx.workspaceId, feature: "filter", meta: { prompt_version: FILTER_PROMPT_VERSION } },
    async (ai) => {
      const res = await ai.fast(buildFilterRequest(input.text, input.current, ctx.userId));
      if (res.toolInput === undefined) throw new AiOutputRejectedError(["no filters produced"], res.usage);
      const normalized = normalizeFilter(res.mock ? mockFilterOutput(input.text) : res.toolInput);
      const merged = mergeFilterParams(input.current, normalized);
      const translated = filterToSearchParams(parseSearchParams(input.current), normalized);
      return {
        result: {
          ...normalized,
          chips: translated.applied,
          searchParams: translated.params,
          dropped: translated.dropped,
          merged,
          interpretation: input.text,
          mock: res.mock,
        },
        usage: res.usage,
      };
    },
    deps,
  );
}

/** AI_MODE=mock: a small deterministic mapping so the chips are meaningful in local work. */
export function mockFilterOutput(text: string): FilterToolOutput {
  const lower = text.toLowerCase();
  const out: FilterToolOutput = { replace: true };
  for (const [name, code] of Object.entries(STATE_NAMES)) {
    if (lower.includes(name)) {
      out.state = code;
      break;
    }
  }
  if (!out.state) {
    const m = /\b(AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/.exec(text);
    if (m) out.state = m[1];
  }
  if (/accept|open to|unsolicited/.test(lower)) out.posture = "open";
  if (/foundation/.test(lower)) out.org_type = "private_foundation";
  const money = /\$\s?([\d.,]+)\s*(k|m|million|thousand|b|billion)?/i.exec(text);
  if (money) {
    const base = Number(money[1].replace(/,/g, ""));
    const unit = (money[2] ?? "").toLowerCase();
    const mult = unit.startsWith("k") || unit === "thousand" ? 1_000 : unit.startsWith("m") ? 1_000_000 : unit.startsWith("b") ? 1_000_000_000 : 1;
    const amount = Math.round(base * mult);
    if (/asset|endowment/.test(lower)) out.min_assets = amount;
    else out.min_giving = amount;
  }
  const topic = lower
    .replace(/\b(foundations?|funders?|that|which|who|accept(s|ing)? applications|in|the|and|gave|give|over|more than|at least|under|a|an|of|for|with|to)\b/g, " ")
    .replace(/\$\s?[\d.,]+\s*(k|m|million|thousand|b|billion)?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (topic.length > 3) {
    const state = out.state;
    const t = state ? topic.replace(new RegExp(`\\b${state.toLowerCase()}\\b`, "g"), " ").replace(/\s+/g, " ").trim() : topic;
    if (t.length > 3) out.like = t.slice(0, 80);
  }
  return out;
}
