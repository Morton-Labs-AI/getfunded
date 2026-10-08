// @vitest-environment node
/**
 * The model vocabulary → search URL translation (lib/ai/filter-search.ts).
 * A model can only set what a hand-typed URL can set; anything else is
 * reported as dropped, never silently lost.
 */
import { describe, expect, it } from "vitest";

import { normalizeFilter } from "@/lib/ai/filter-schema";
import { filterToSearchParams } from "@/lib/ai/filter-search";
import { DEFAULT_SEARCH_PARAMS, parseSearchParams, toQueryString, type SearchParams } from "@/lib/search/params";

const EMPTY: SearchParams = { ...DEFAULT_SEARCH_PARAMS };

describe("filterToSearchParams", () => {
  it("turns a topic into the meaning-based search plus the plain filters", () => {
    const normalized = normalizeFilter({ like: "food banks and hunger relief", state: "Oregon", posture: "open", min_giving: 500000, replace: true });
    const { params, applied, dropped } = filterToSearchParams(EMPTY, normalized);
    expect(params.q).toBe("food banks and hunger relief");
    expect(params.mode).toBe("thesis");
    expect(params.state).toBe("OR");
    expect(params.posture).toBe("open");
    expect(params.minDistributions).toBe(500000);
    expect(params.page).toBe(1);
    expect(applied.map((c) => c.key)).toEqual(["like", "state", "posture", "minGiving"]);
    expect(dropped).toEqual([]);
    // The URL round-trips through the one search parser.
    expect(parseSearchParams(new URLSearchParams(toQueryString(params)))).toEqual(params);
  });

  it("keeps a funder name in q and sends the topic to giving_to when both are set", () => {
    const normalized = normalizeFilter({ q: "Meyer Memorial", like: "rural health", replace: true });
    const { params } = filterToSearchParams(EMPTY, normalized);
    expect(params.q).toBe("Meyer Memorial");
    expect(params.mode).toBe("name");
    expect(params.givingTo).toBe("rural health");
  });

  it("spells posture the way the URL does and maps org types the page knows", () => {
    const { params } = filterToSearchParams(EMPTY, normalizeFilter({ posture: "preselected_only", org_type: "private_foundation", replace: true }));
    expect(params.posture).toBe("preselected");
    expect(params.type).toBe("private_foundation");
  });

  it("reports filters the search page cannot express instead of dropping them silently", () => {
    const normalized = normalizeFilter({ org_type: "investment_adviser", max_assets: 5_000_000, min_assets: 1_000_000, replace: true });
    const { params, applied, dropped } = filterToSearchParams(EMPTY, normalized);
    expect(params.type).toBe("all");
    expect(params.minAssets).toBe(1_000_000);
    expect(applied.map((c) => c.key)).toEqual(["minAssets"]);
    expect(dropped.map((d) => d.chip.key).sort()).toEqual(["maxAssets", "orgType"]);
    for (const d of dropped) expect(d.reason.length).toBeGreaterThan(10);
  });

  it("refines the current search when replace is false and starts over when it is true", () => {
    const current = parseSearchParams({ q: "youth literacy", state: "WA", sort: "assets", view: "table", page: "3" });
    const refine = filterToSearchParams(current, normalizeFilter({ state: "Oregon", replace: false }));
    expect(refine.params.q).toBe("youth literacy");
    expect(refine.params.state).toBe("OR");
    expect(refine.params.sort).toBe("assets");
    expect(refine.params.page).toBe(1);

    const fresh = filterToSearchParams(current, normalizeFilter({ state: "Texas", replace: true }));
    expect(fresh.params.q).toBeNull();
    expect(fresh.params.state).toBe("TX");
    // The person's sort and view are theirs to keep.
    expect(fresh.params.sort).toBe("assets");
    expect(fresh.params.view).toBe("table");
  });

  it("an EIN typed as a name becomes an exact lookup", () => {
    const { params } = filterToSearchParams(EMPTY, normalizeFilter({ q: "93-0386790", replace: true }));
    expect(params.ein).toBe("930386790");
    expect(params.mode).toBe("name");
  });

  it("a sentence that maps to nothing leaves the search untouched except the page", () => {
    const current = parseSearchParams({ state: "CA", page: "2" });
    const { params, applied } = filterToSearchParams(current, normalizeFilter({ replace: false }));
    expect(applied).toEqual([]);
    expect(params.state).toBe("CA");
    expect(params.page).toBe(1);
  });
});
