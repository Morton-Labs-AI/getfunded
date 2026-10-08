import { describe, expect, it } from "vitest";

import { MODEL_PRICES, estimateCost, formatUsdCents, priceFor, summarizeCost } from "@/lib/admin/cost";

describe("priceFor", () => {
  it("matches exact ids, family prefixes (longest wins), and nothing for unknown models", () => {
    expect(priceFor("claude-sonnet-5-5")).toEqual({ price: MODEL_PRICES["claude-sonnet-5-5"], matched: "claude-sonnet-5-5", exact: true });
    expect(priceFor("claude-opus-5-5-20260401")).toMatchObject({ matched: "claude-opus-5-5", exact: false });
    expect(priceFor("claude-opus-5-20260101")).toMatchObject({ matched: "claude-opus-5", exact: false });
    expect(priceFor("claude-sonnet-9")).toMatchObject({ matched: "claude-sonnet-5-5", exact: false });
    expect(priceFor("mock")).toMatchObject({ matched: "mock", exact: true });
    expect(priceFor("gpt-x")).toBeNull();
    expect(priceFor(null)).toBeNull();
    expect(priceFor("  ")).toBeNull();
  });
});

describe("estimateCost", () => {
  it("prices input and output tokens per million and rounds to whole cents", () => {
    // 1M input at $2 + 100k output at $10/M = $2 + $1 = $3.00
    expect(estimateCost({ model: "claude-sonnet-5-5", inputTokens: 1_000_000, outputTokens: 100_000 })).toEqual({
      cents: 300,
      usd: 3,
      known: true,
      matched: "claude-sonnet-5-5",
    });
    // Opus: 250k in ($1.00) + 50k out ($1.00) = $2.00
    expect(estimateCost({ model: "claude-opus-5-5", inputTokens: 250_000, outputTokens: 50_000 }).cents).toBe(200);
  });

  it("accepts Postgres numeric strings and treats null/negative as zero", () => {
    expect(estimateCost({ model: "claude-sonnet-5-5", inputTokens: "500000", outputTokens: null }).cents).toBe(100);
    expect(estimateCost({ model: "claude-sonnet-5-5", inputTokens: -5, outputTokens: "abc" }).cents).toBe(0);
  });

  it("adds cache reads and writes when given", () => {
    const est = estimateCost({ model: "claude-sonnet-5-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 });
    expect(est.cents).toBe(20 + 250);
  });

  it("the mock model costs nothing and unknown models are flagged, not priced", () => {
    expect(estimateCost({ model: "mock", inputTokens: 9_999_999, outputTokens: 9_999_999 })).toMatchObject({ cents: 0, known: true });
    expect(estimateCost({ model: "something-else", inputTokens: 1_000_000, outputTokens: 0 })).toEqual({ cents: 0, usd: 0, known: false, matched: null });
  });

  it("rounds half up at the cent", () => {
    // 1250 input tokens at $2/M = $0.0025 → 0 cents; 2500 → $0.005 → 1 cent
    expect(estimateCost({ model: "claude-sonnet-5-5", inputTokens: 1_250, outputTokens: 0 }).cents).toBe(0);
    expect(estimateCost({ model: "claude-sonnet-5-5", inputTokens: 2_500, outputTokens: 0 }).cents).toBe(1);
  });
});

describe("summarizeCost", () => {
  it("sums known rows, lists unknown models once, keeps per-row estimates", () => {
    const s = summarizeCost([
      { model: "claude-sonnet-5-5", inputTokens: 1_000_000, outputTokens: 0 },
      { model: "claude-opus-5-5", inputTokens: 0, outputTokens: 100_000 },
      { model: "mystery", inputTokens: 1, outputTokens: 1 },
      { model: "mystery", inputTokens: 1, outputTokens: 1 },
      { model: null, inputTokens: 5, outputTokens: 5 },
    ]);
    expect(s.cents).toBe(200 + 200);
    expect(s.usd).toBe(4);
    expect(s.unknownModels).toEqual(["mystery"]);
    expect(s.rows).toHaveLength(5);
    expect(s.rows[0]).toMatchObject({ cents: 200, known: true });
    expect(s.rows[4]).toMatchObject({ known: false });
  });
});

describe("formatUsdCents", () => {
  it("formats cents as dollars with two decimals and a true minus", () => {
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(42)).toBe("$0.42");
    expect(formatUsdCents(123456)).toBe("$1,234.56");
    expect(formatUsdCents(-5)).toBe("−$0.05");
  });
});
