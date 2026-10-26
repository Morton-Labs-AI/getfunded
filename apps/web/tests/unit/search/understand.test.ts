// @vitest-environment node
/**
 * What a query means (lib/search/understand.ts), who is searching
 * (lib/search/context.ts) and which mode a bare query runs in
 * (lib/search/params.ts inferMode). Pure, so no database.
 */
import { describe, expect, it } from "vitest";

import { causesFromProgramAreas, embedText, EMPTY_CONTEXT, profileContextFrom, resolveContext } from "@/lib/search/context";
import { DEFAULT_SEARCH_PARAMS, inferMode, parseSearchParams, toQueryString, type SearchParams } from "@/lib/search/params";
import { contentWords, findPlace, looksLikeFunderName, understand } from "@/lib/search/understand";

const params = (patch: Partial<SearchParams>): SearchParams => ({ ...DEFAULT_SEARCH_PARAMS, ...patch });

describe("understand: places", () => {
  it("finds a state by name and takes it out of the topic", () => {
    expect(understand("youth literacy programs in Ohio")).toMatchObject({ place: { state: "OH" }, topic: "youth literacy programs" });
    expect(understand("addiction recovery in West Virginia").place?.state).toBe("WV");
    expect(understand("rural health in Virginia").place?.state).toBe("VA");
  });

  it("reads a capitalized state code only after 'in', 'across' or a comma", () => {
    expect(understand("youth mental health in OR").place?.state).toBe("OR");
    expect(understand("Denver, CO arts groups").place?.state).toBe("CO");
    expect(understand("food or shelter in me").place).toBeNull();
    expect(understand("HOMELESS SHELTER").place).toBeNull();
  });

  it("finds a city and its state, including city names that contain a state's", () => {
    expect(understand("homeless services in Boise")).toMatchObject({ place: { state: "ID", city: "Boise" }, topic: "homeless services" });
    expect(understand("early childhood education Denver").place?.state).toBe("CO");
    expect(findPlace("youth sports in Kansas City")?.place.state).toBe("MO");
    expect(findPlace("tutoring in Washington DC")?.place.state).toBe("DC");
    expect(findPlace("free legal services for domestic violence survivors in Washington")?.place.state).toBe("WA");
  });

  it("leaves a query with no place alone", () => {
    expect(understand("mobile dental clinics for rural families")).toEqual({ place: null, topic: "mobile dental clinics for rural families", navigational: false });
  });
});

describe("understand: names and topics", () => {
  it("treats a few words with a funder word as a name, and a request as a topic", () => {
    expect(looksLikeFunderName("Ford Foundation")).toBe(true);
    expect(looksLikeFunderName("Lilly Endowment")).toBe(true);
    expect(looksLikeFunderName("Silicon Valley Community Foundation")).toBe(true);
    expect(looksLikeFunderName("community foundation grants for nonprofits in Montana")).toBe(false);
    expect(looksLikeFunderName("food bank")).toBe(false);
  });

  it("keeps the meaningful words for the in-state leg", () => {
    expect(contentWords("general operating support grants")).toEqual([]);
    expect(contentWords("after-school tutoring for our students")).toEqual(["after-school", "tutoring", "students"]);
  });
});

describe("inferMode", () => {
  it("sends short topics to the topic search, names and EINs to the name lookup", () => {
    expect(inferMode("literacy")).toBe("thesis");
    expect(inferMode("food bank")).toBe("thesis");
    expect(inferMode("youth literacy programs in Ohio")).toBe("thesis");
    expect(inferMode("Gates Foundation")).toBe("name");
    expect(inferMode('"food bank"')).toBe("name");
    expect(inferMode("56-2618866")).toBe("name");
    expect(inferMode(null)).toBe("name");
  });
});

describe("search context", () => {
  it("parses and serializes the tuning parameters and the new filters", () => {
    const p = parseSearchParams({ q: "tutoring", for_state: "oh", for_cause: "b", for_budget: "300000", for_city: "Toledo", gives_in: "ky", cause: "o", tune: "off" });
    expect(p).toMatchObject({ forState: "OH", forCause: "B", forBudget: 300000, forCity: "Toledo", givesIn: "KY", cause: "O", tune: "off" });
    expect(toQueryString(p)).toBe("q=tutoring&gives_in=KY&cause=O&for_state=OH&for_cause=B&for_budget=300000&for_city=Toledo&tune=off");
    expect(parseSearchParams({ for_state: "Ohio", for_cause: "BB", tune: "on" })).toMatchObject({ forState: null, forCause: null, tune: null });
  });

  it("prefers the URL, then a place in the words, then the profile", () => {
    const profile = { state: "CA", city: "Fresno", causes: ["E"], budget: 900000 };
    const fromProfile = resolveContext(params({ q: "dental care" }), understand("dental care"), profile);
    expect(fromProfile).toMatchObject({ state: "CA", stateSource: "profile", city: "Fresno", cause: "E", causeSource: "profile", budget: 900000 });
    const fromWords = resolveContext(params({ q: "dental care in Ohio" }), understand("dental care in Ohio"), profile);
    expect(fromWords).toMatchObject({ state: "OH", stateSource: "query", cause: "E" });
    const fromUrl = resolveContext(params({ q: "dental care in Ohio", forState: "KY", forCause: "P" }), understand("dental care in Ohio"), profile);
    expect(fromUrl).toMatchObject({ state: "KY", stateSource: "url", cause: "P", causeSource: "url" });
    const off = resolveContext(params({ q: "dental care", tune: "off" }), understand("dental care"), profile);
    expect(off).toEqual(EMPTY_CONTEXT);
  });

  it("adds the cause and place to the embedded words only when they are missing", () => {
    const ctx = { ...EMPTY_CONTEXT, state: "OH", stateSource: "profile" as const, city: "Toledo", cause: "B", causeSource: "profile" as const };
    expect(embedText("general operating support", understand("general operating support"), ctx)).toBe("general operating support for education in Toledo, Ohio");
    expect(embedText("literacy tutoring", understand("literacy tutoring"), ctx)).toBe("literacy tutoring in Toledo, Ohio");
    expect(embedText("literacy in Kentucky", understand("literacy in Kentucky"), { ...ctx, state: "KY", stateSource: "query", city: null })).toBe("literacy in Kentucky");
  });

  it("maps a profile's program areas and cause areas to causes", () => {
    expect(causesFromProgramAreas(["Youth development", "After-school tutoring"])).toEqual(expect.arrayContaining(["O", "B"]));
    expect(profileContextFrom({ state: "OH", cause_areas: ["B"], annual_budget: 400000 })).toEqual({ state: "OH", city: null, causes: ["B"], budget: 400000 });
    expect(profileContextFrom({ mission: "x" } as never)).toBeNull();
  });
});
