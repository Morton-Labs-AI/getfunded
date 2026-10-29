// @vitest-environment node
/**
 * The search SQL builder (lib/search/sql.ts). Pure, so the shape of every
 * mode is checked without a database. The one rule that matters most: no
 * user-typed text ever lands in the SQL string; it travels in `values`.
 */
import { describe, expect, it } from "vitest";

import { EMPTY_CONTEXT } from "@/lib/search/context";
import { DEFAULT_SEARCH_PARAMS, PAGE_SIZE, parseSearchParams, type SearchParams } from "@/lib/search/params";
import {
  EIN_POOL_LIMIT,
  FUNDER_TYPES,
  POOL_LIMIT,
  SEMANTIC_POOL_LIMIT,
  buildSearchSql,
  nameTokens,
  normalizeName,
  likeContains,
  nameVariants,
  likePrefix,
  orgTypesFor,
  phraseQuery,
  vecLiteral,
} from "@/lib/search/sql";

const params = (patch: Partial<SearchParams>): SearchParams => ({ ...DEFAULT_SEARCH_PARAMS, ...patch });

/** Every $n in the text has a value, every value is referenced, and none of the typed text is in the SQL. */
function checkPlaceholders(text: string, values: unknown[], typed: string[]) {
  const refs = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  expect(Math.max(...refs)).toBe(values.length);
  for (let i = 1; i <= values.length; i++) expect(refs, `$${i} referenced`).toContain(i);
  for (const t of typed) expect(text, `typed text "${t}" must not appear in the SQL`).not.toContain(t);
}

describe("buildSearchSql", () => {
  it("runs an exact EIN probe when q is an EIN", () => {
    const p = parseSearchParams({ q: "12-3456789" });
    const built = buildSearchSql(p);
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("ein");
    expect(built.poolLimit).toBe(EIN_POOL_LIMIT);
    expect(built.text).toContain("public.org_identifiers");
    expect(built.values).toContain("123456789");
    checkPlaceholders(built.text, built.values, ["123456789"]);
  });

  it("refuses a name shorter than three characters without touching the database", () => {
    const built = buildSearchSql(params({ q: "ab", mode: "name" }));
    expect(built.text).toBeNull();
    expect(built.notices).toEqual(["name_too_short"]);
  });

  it("builds the name pool from distinctive words, with LIKE metacharacters escaped", () => {
    const built = buildSearchSql(params({ q: "50% Fund_raisers; drop table x", mode: "name", state: "or" }));
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("name");
    expect(built.poolLimit).toBe(POOL_LIMIT);
    // "50" and "X" are too short to narrow by; each word must START a word of the name.
    expect(built.values).toContain("\\mFUND_RAISERS");
    expect(built.values).toContain("\\mTABLE");
    expect(built.values).toContain("50 FUND_RAISERS DROP TABLE X");
    expect(built.values).toContain("or");
    checkPlaceholders(built.text, built.values, ["drop table", "50%", "or'"]);
    expect(built.text).toContain("o.canonical_org_id is null");
    expect(built.text).toContain("strpos(o.name_normalized,");
  });

  it("narrows a funder's name by its distinctive words and ranks the larger giver up", () => {
    expect(nameTokens("GORDON E AND BETTY I MOORE FOUNDATION")).toEqual(["GORDON", "BETTY", "MOORE"]);
    expect(nameTokens("MOORE FOUNDATION")).toEqual(["MOORE"]);
    expect(nameTokens("COMMUNITY FOUNDATION")).toEqual([]);
    expect(normalizeName("Annie E. Casey Foundation")).toBe("ANNIE E CASEY FOUNDATION");

    const built = buildSearchSql(params({ q: "Annie E. Casey Foundation", mode: "name" }));
    if (built.text === null) throw new Error("expected SQL");
    expect(built.values).toContain("\\mANNIE");
    expect(built.values).toContain("\\mCASEY");
    expect(built.values).toContain("ANNIE E CASEY FOUNDATION");
    expect(built.text).toMatch(/0\.35 \* log\(1 \+ greatest\(/);
    // Every-word-generic names fall back to the whole phrase.
    const generic = buildSearchSql(params({ q: "Community Foundation", mode: "name" }));
    if (generic.text === null) throw new Error("expected SQL");
    expect(generic.values).toContain("%Community Foundation%");
  });

  it("matches an apostrophe query with and without the apostrophe (IRS names drop it)", () => {
    expect(nameVariants("children's hospital")).toEqual(["children's hospital", "childrens hospital"]);
    expect(nameVariants("children\u2019s hospital")).toEqual(["children\u2019s hospital", "childrens hospital"]);
    expect(nameVariants("food bank")).toEqual(["food bank"]);
    expect(nameVariants("'s")).toEqual(["'s"]);

    const built = buildSearchSql(params({ q: "children's hospital", mode: "name", type: "private_foundation", state: "ca" }));
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("name");
    // Both spellings must be contained whole; the trigram index narrows by the words.
    expect(built.values).toContain("CHILDREN S HOSPITAL");
    expect(built.values).toContain("CHILDRENS HOSPITAL");
    expect(built.values).toContain("\\mHOSPITAL");
    expect(built.values).toContain("\\mCHILDREN");
    // Two spellings, checked in both legs (full-text, and the trigram fallback).
    expect((built.text.match(/strpos\(o\.name_normalized/g) ?? []).length).toBe(4);
    expect(built.values).toContain("(children & hospital:*) | (childrens & hospital:*)");
    checkPlaceholders(built.text, built.values, ["children's", "hospital"]);
  });

  it("runs a keyword topic search over funder summaries only, ranked by text", () => {
    const built = buildSearchSql(params({ q: "food bank", mode: "keyword", type: "private_foundation" }));
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("keyword");
    expect(built.poolLimit).toBe(SEMANTIC_POOL_LIMIT);
    expect(built.text).toContain("internal.search_documents");
    expect(built.text).not.toContain("o.search_tsv"); // names are not a topic: no organization-name leg
    expect(built.text).toContain("ts_rank_cd(sd.search_tsv");
    expect(built.values).toContain("food bank");
    expect(built.values).toContainEqual(["private_foundation"]);
    checkPlaceholders(built.text, built.values, ["food bank"]);
  });

  it("falls back to keywords with a notice when a thesis search has no vector", () => {
    const built = buildSearchSql(params({ q: "mobile dental clinics for rural families", mode: "thesis" }), { vec: null });
    expect(built.ran).toBe("keyword");
    expect(built.notices).toContain("semantic_unavailable");
  });

  it("walks the HNSW index with no filter in the meaning leg and filters the merged candidates", () => {
    const vec = Array.from({ length: 512 }, (_, i) => i / 512);
    const built = buildSearchSql(params({ q: "youth mental health", mode: "thesis", posture: "open", minDistributions: 500000, state: "OR", ntee: "F" }), { vec });
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("semantic");
    expect(built.poolLimit).toBe(SEMANTIC_POOL_LIMIT);
    expect(built.text).not.toContain("hybrid_search");
    // The meaning leg: no predicate but "has an embedding", so pgvector walks the index.
    expect(built.text).toMatch(/where sd\.embedding is not null\s+order by sd\.embedding operator\(extensions\.<=>\) \$\d+::extensions\.halfvec\(512\)\s+limit 600/);
    expect(built.text).toContain("with ordinality");
    expect(built.text).toMatch(/o\.state = \$\d+::text/);
    expect(built.text).toMatch(/sd\.app_posture = \$\d+::text/);
    expect(built.text).toMatch(/sd\.annual_distributions >= \$\d+::numeric/);
    expect(built.text).toMatch(/o\.ntee_code like \$\d+::text/);
    expect(built.text).toContain("o.canonical_org_id is null");
    expect(built.values).toContain(vecLiteral(vec));
    expect(built.values).toContain("open");
    expect(built.values).toContain(500000);
    expect(built.notices).toContain("posture_filter");
    expect(built.notices).toContain("semantic_filtered");
    checkPlaceholders(built.text, built.values, ["youth mental health", "[0,"]);
  });

  it("returns grantmakers, not companies, for all funder types, and companies when asked", () => {
    const vec = Array.from({ length: 512 }, () => 0.1);
    const all = buildSearchSql(params({ q: "robotics for girls", mode: "thesis" }), { vec });
    if (all.text === null) throw new Error("expected SQL");
    expect(all.values).toContainEqual(["foundation"]);
    expect(all.values).toContainEqual(["private_foundation", "public_charity"]);
    const companies = buildSearchSql(params({ q: "robotics for girls", mode: "thesis", type: "company" }), { vec });
    if (companies.text === null) throw new Error("expected SQL");
    expect(companies.values).toContainEqual(["company"]);
  });

  it("adds no filter notice to an unfiltered thesis search", () => {
    const vec = Array.from({ length: 512 }, (_, i) => i / 512);
    const built = buildSearchSql(params({ q: "youth mental health", mode: "thesis" }), { vec });
    expect(built.ran).toBe("semantic");
    expect(built.notices).not.toContain("semantic_filtered");
  });

  it("ranks for the searcher: an in-state leg, geography and cause from the summary without giving profiles", () => {
    const vec = Array.from({ length: 512 }, () => 0.1);
    const context = { ...EMPTY_CONTEXT, state: "OH", stateSource: "url" as const, cause: "B", causeSource: "url" as const, budget: 300000 };
    const built = buildSearchSql(params({ q: "after-school tutoring", mode: "thesis" }), { vec, context, profilesReady: false });
    if (built.text === null) throw new Error("expected SQL");
    expect(built.text).toContain("sd.state = $"); // the in-state leg
    expect(built.text).toContain("array_position(f.top_states,");
    expect(built.text).toContain("d.doc_text ~* $");
    expect(built.text).not.toContain("mv_funder_giving_state");
    expect(built.text).not.toContain("median_paid_5y between"); // size fit needs the profiles
    expect(built.values).toContain("OH");
    expect(built.values).toContain("after-school OR tutoring");
    expect(built.text).toContain("'tier', 'summary'");
  });

  it("reads the giving profiles for exact counts once they are ready", () => {
    const vec = Array.from({ length: 512 }, () => 0.1);
    const context = { ...EMPTY_CONTEXT, state: "OH", stateSource: "url" as const, cause: "B", causeSource: "url" as const, budget: 300000 };
    const built = buildSearchSql(params({ q: "after-school tutoring", mode: "thesis" }), { vec, context, profilesReady: true });
    if (built.text === null) throw new Error("expected SQL");
    expect(built.text).toContain("left join internal.mv_funder_giving_state gs");
    expect(built.text).toContain("left join internal.mv_funder_giving_cause gc");
    expect(built.text).toContain("left join internal.mv_funder_grant_profile gp");
    expect(built.text).toContain("median_paid_5y between");
    expect(built.text).toContain("'tier', 'profiles'");
  });

  it("filters by where a funder gives and what it funds only with the giving profiles, and says so otherwise", () => {
    const off = buildSearchSql(params({ givesIn: "OH", cause: "B" }), { profilesReady: false });
    expect(off.notices).toContain("giving_profiles_unavailable");
    expect(off.text).not.toContain("mv_funder_giving");
    const on = buildSearchSql(params({ givesIn: "OH", cause: "B" }), { profilesReady: true });
    if (on.text === null) throw new Error("expected SQL");
    expect(on.ran).toBe("browse");
    expect(on.text).toContain("from internal.mv_funder_giving_state g");
    expect(on.text).toContain("gc.ntee_major = $");
    expect(on.text).toContain("order by p.rank desc");
    expect(on.notices).not.toContain("giving_profiles_unavailable");
  });

  it("browses from the financials view when sorting by giving, and from organizations otherwise", () => {
    const giving = buildSearchSql(params({ state: "TX", sort: "distributions" }));
    expect(giving.ran).toBe("browse");
    expect(giving.text).toMatch(/from internal\.mv_org_latest_financials fin join internal\.organizations o/);
    const byName = buildSearchSql(params({ state: "TX", sort: "name" }));
    expect(byName.text).toMatch(/from internal\.organizations o\s/);
    expect(byName.text).toContain("order by o.name_normalized asc, o.id asc");
  });

  it("adds the giving-to lateral with a phrase query and a notice", () => {
    const built = buildSearchSql(params({ state: "CA", givingTo: "food bank" }));
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.text).toContain("cross join lateral");
    expect(built.text).toContain("gt.hit_n > 0");
    expect(built.values).toContain('"food bank"');
    expect(built.notices).toContain("giving_to_pool");
    checkPlaceholders(built.text, built.values, ["food bank"]);
  });

  it("pages inside the pool with the fixed page size and never beyond MAX_PAGE", () => {
    const p2 = buildSearchSql(params({ state: "NY", page: 2 }));
    expect(p2.text).not.toBeNull();
    if (p2.text === null) return;
    expect(p2.values).toContain(PAGE_SIZE);
    expect(p2.values).toContain(PAGE_SIZE);
    expect(p2.values[p2.values.indexOf(PAGE_SIZE) + 1]).toBe(PAGE_SIZE); // offset for page 2
    const far = buildSearchSql(params({ state: "NY", page: 999 }));
    if (far.text === null) return;
    expect(Math.max(...(far.values.filter((v) => typeof v === "number") as number[]))).toBeLessThanOrEqual(PAGE_SIZE * 20);
  });

  it("casts every money comparison explicitly", () => {
    const built = buildSearchSql(params({ minAssets: 1_000_000, minDistributions: 250_000 }));
    expect(built.text).toMatch(/>= \$\d+::numeric/);
    expect((built.text!.match(/::numeric/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("only ever searches the four shipped funder types", () => {
    expect([...FUNDER_TYPES]).toEqual(["private_foundation", "public_charity", "company", "gov_agency"]);
    expect(orgTypesFor("all")).toEqual([...FUNDER_TYPES]);
    expect(orgTypesFor("company")).toEqual(["company"]);
  });
});

describe("helpers", () => {
  it("escapes LIKE metacharacters", () => {
    expect(likeContains("a%b_c\\d")).toBe("%a\\%b\\_c\\\\d%");
    expect(likePrefix("Me")).toBe("Me%");
  });

  it("phrases multi-word giving-to input unless operators are present", () => {
    expect(phraseQuery("food bank")).toBe('"food bank"');
    expect(phraseQuery("food")).toBe("food");
    expect(phraseQuery("food OR pantry")).toBe("food OR pantry");
    expect(phraseQuery('"community college"')).toBe('"community college"');
    expect(phraseQuery("food -bank")).toBe("food -bank");
  });

  it("writes a pgvector literal", () => {
    expect(vecLiteral([0.5, 1, -2])).toBe("[0.5,1,-2]");
  });
});
