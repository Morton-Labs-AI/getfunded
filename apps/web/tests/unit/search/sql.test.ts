// @vitest-environment node
/**
 * The search SQL builder (lib/search/sql.ts). Pure, so the shape of every
 * mode is checked without a database. The one rule that matters most: no
 * user-typed text ever lands in the SQL string; it travels in `values`.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_SEARCH_PARAMS, PAGE_SIZE, parseSearchParams, type SearchParams } from "@/lib/search/params";
import {
  EIN_POOL_LIMIT,
  FUNDER_TYPES,
  KEYWORD_LEG_LIMIT,
  POOL_LIMIT,
  SEMANTIC_POOL_LIMIT,
  buildSearchSql,
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

  it("builds the trigram name pool with LIKE metacharacters escaped", () => {
    const built = buildSearchSql(params({ q: "50% Fund_raisers; drop table x", mode: "name", state: "or" }));
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("name");
    expect(built.poolLimit).toBe(POOL_LIMIT);
    expect(built.values).toContain("%50\\% Fund\\_raisers; drop table x%");
    expect(built.values).toContain("or");
    checkPlaceholders(built.text, built.values, ["drop table", "50%", "or'"]);
    expect(built.text).toContain("o.canonical_org_id is null");
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
    expect(built.values).toContain("%children's hospital%");
    expect(built.values).toContain("%childrens hospital%");
    expect(built.values).toContain("CHILDRENS HOSPITAL%");
    expect((built.text.match(/o\.name ilike/g) ?? []).length).toBe(2);
    checkPlaceholders(built.text, built.values, ["children", "hospital"]);
  });

  it("merges two keyword legs by rank and reports the keyword pool limit", () => {
    const built = buildSearchSql(params({ q: "food bank", mode: "keyword", type: "private_foundation" }));
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("keyword");
    expect(built.poolLimit).toBe(KEYWORD_LEG_LIMIT * 2);
    expect(built.text).toContain("internal.search_documents");
    expect(built.text).toContain("union all");
    expect(built.values).toContain("food bank");
    expect(built.values).toContainEqual(["private_foundation"]);
    checkPlaceholders(built.text, built.values, ["food bank"]);
  });

  it("falls back to keywords with a notice when a thesis search has no vector", () => {
    const built = buildSearchSql(params({ q: "mobile dental clinics for rural families", mode: "thesis" }), { vec: null });
    expect(built.ran).toBe("keyword");
    expect(built.notices).toContain("semantic_unavailable");
  });

  it("sends a thesis search through hybrid_search with the vector and every filter inside the call", () => {
    const vec = Array.from({ length: 512 }, (_, i) => i / 512);
    const built = buildSearchSql(params({ q: "youth mental health", mode: "thesis", posture: "open", minDistributions: 500000, state: "OR", ntee: "F" }), { vec });
    expect(built.text).not.toBeNull();
    if (built.text === null) return;
    expect(built.ran).toBe("semantic");
    expect(built.poolLimit).toBe(SEMANTIC_POOL_LIMIT);
    expect(built.text).toContain("internal.hybrid_search(");
    expect(built.values).toContain(vecLiteral(vec));
    expect(built.values).toContainEqual(["open"]);
    expect(built.values).toContain(500000);
    // The NTEE filter cannot go inside hybrid_search, so it is applied after the pool.
    expect(built.text).toMatch(/where o\.ntee_code like \$\d+::text/);
    expect(built.notices).toContain("posture_filter");
    checkPlaceholders(built.text, built.values, ["youth mental health", "[0,"]);
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
