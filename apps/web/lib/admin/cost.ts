/**
 * Estimated model cost for the steward's usage page. Pure; no server imports.
 *
 * PRICES BELOW ARE CONSTANTS AND GO STALE. They are Anthropic first-party API
 * list prices in US dollars per one million tokens, last checked 2026-10-07
 * (Sonnet 5.5: $2 in / $10 out; Opus 5.5: $4 in / $20 out; cache reads $0.20
 * on both; cache writes are priced at 1.25x input, the standard 5-minute
 * cache rate). When Anthropic changes a price or the app's default models
 * change (lib/ai/client.ts DEFAULT_FAST_MODEL / DEFAULT_DEEP_MODEL), update
 * this table and the `CHECKED` date. The usage page says "estimate" because
 * the ledger stores input and output tokens only; cache reads and writes are
 * not recorded, so the estimate is an upper bound on input cost.
 */

export const PRICES_CHECKED = "2026-10-07";

export type ModelPrice = {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
  /** USD per 1M cached input tokens read. */
  cacheReadPerMTok: number;
  /** USD per 1M input tokens written to the cache. */
  cacheWritePerMTok: number;
};

/**
 * Exact model ids first, then family prefixes (matched with `startsWith`,
 * longest prefix wins). `mock` is the token-free client and costs nothing.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  "claude-opus-5-5": { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
  "claude-sonnet-5": { inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.2, cacheWritePerMTok: 2.5 },
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25, cacheReadPerMTok: 0.5, cacheWritePerMTok: 6.25 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWritePerMTok: 1.25 },
  mock: { inputPerMTok: 0, outputPerMTok: 0, cacheReadPerMTok: 0, cacheWritePerMTok: 0 },
};

/** Family fallbacks for ids not listed exactly (e.g. a dated snapshot). */
const FAMILY_PREFIXES: Array<[prefix: string, key: keyof typeof MODEL_PRICES]> = [
  ["claude-sonnet-5-5", "claude-sonnet-5-5"],
  ["claude-opus-5-5", "claude-opus-5-5"],
  ["claude-sonnet-5", "claude-sonnet-5"],
  ["claude-opus-5", "claude-opus-5"],
  ["claude-haiku-4-5", "claude-haiku-4-5"],
  ["claude-sonnet", "claude-sonnet-5-5"],
  ["claude-opus", "claude-opus-5-5"],
  ["claude-haiku", "claude-haiku-4-5"],
  ["mock", "mock"],
];

export type PriceMatch = { price: ModelPrice; matched: string; exact: boolean } | null;

/**
 * The price for a model id, or null when the model is unknown (the usage page
 * then shows "Not available" rather than a made-up number).
 */
export function priceFor(model: string | null | undefined): PriceMatch {
  if (!model) return null;
  const id = model.trim().toLowerCase();
  if (id.length === 0) return null;
  const exact = MODEL_PRICES[id];
  if (exact) return { price: exact, matched: id, exact: true };
  let best: [string, keyof typeof MODEL_PRICES] | null = null;
  for (const entry of FAMILY_PREFIXES) {
    if (id.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best ? { price: MODEL_PRICES[best[1]], matched: best[1], exact: false } : null;
}

export type TokenTotals = {
  model: string | null | undefined;
  inputTokens: number | string | null | undefined;
  outputTokens: number | string | null | undefined;
  cacheReadTokens?: number | string | null | undefined;
  cacheWriteTokens?: number | string | null | undefined;
};

export type CostEstimate = {
  /** Whole US cents, rounded half up. */
  cents: number;
  usd: number;
  known: boolean;
  matched: string | null;
};

function n(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/** Cost of one bundle of tokens. Unknown model → { known: false, cents: 0 }. */
export function estimateCost(t: TokenTotals): CostEstimate {
  const match = priceFor(t.model);
  if (!match) return { cents: 0, usd: 0, known: false, matched: null };
  const p = match.price;
  const usd =
    (n(t.inputTokens) * p.inputPerMTok +
      n(t.outputTokens) * p.outputPerMTok +
      n(t.cacheReadTokens) * p.cacheReadPerMTok +
      n(t.cacheWriteTokens) * p.cacheWritePerMTok) /
    1_000_000;
  const cents = Math.round(usd * 100);
  return { cents, usd: cents / 100, known: true, matched: match.matched };
}

export type CostSummary = {
  cents: number;
  usd: number;
  /** Models in the input that had no price; their tokens are excluded. */
  unknownModels: string[];
  rows: Array<TokenTotals & CostEstimate>;
};

/** Sum several model totals (one row per model) into one estimate. */
export function summarizeCost(rows: TokenTotals[]): CostSummary {
  const out: CostSummary = { cents: 0, usd: 0, unknownModels: [], rows: [] };
  for (const row of rows) {
    const est = estimateCost(row);
    out.rows.push({ ...row, ...est });
    if (est.known) out.cents += est.cents;
    else if (row.model && !out.unknownModels.includes(row.model)) out.unknownModels.push(row.model);
  }
  out.usd = out.cents / 100;
  return out;
}

/** "$0.42", "$12.00". Whole cents in, dollars out. */
export function formatUsdCents(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
