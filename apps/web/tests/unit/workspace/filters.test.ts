import { describe, expect, it } from "vitest";

import {
  firstParam,
  hasFilters,
  parseSavedFilters,
  parseTaskView,
  savedFiltersToQuery,
  taskViewHref,
} from "@/lib/workspace/filters";

const OWNER = "11111111-2222-4333-8444-555555555555";
const LIST = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

describe("firstParam", () => {
  it("takes the first value, trimmed, and treats blanks as absent", () => {
    expect(firstParam(["  a ", "b"])).toBe("a");
    expect(firstParam(" x ")).toBe("x");
    expect(firstParam("   ")).toBeUndefined();
    expect(firstParam(undefined)).toBeUndefined();
  });
});

describe("parseSavedFilters", () => {
  it("reads every supported key", () => {
    expect(parseSavedFilters({ q: " food ", stage: "qualified", owner: OWNER, tier: "2", list: LIST, sort: "ask" })).toEqual({
      q: "food",
      stage: "qualified",
      ownerId: OWNER,
      tier: 2,
      collectionId: LIST,
      sort: "ask",
    });
  });

  it("drops unknown or malformed values instead of guessing", () => {
    expect(parseSavedFilters({ stage: "closed", owner: "not-a-uuid", tier: "7", list: "x", sort: "random" })).toEqual({});
    expect(parseSavedFilters({ tier: "0" })).toEqual({});
    expect(parseSavedFilters({ q: "" })).toEqual({});
  });

  it("accepts repeated params by their first value and tolerates no params", () => {
    expect(parseSavedFilters({ stage: ["parked", "awarded"] })).toEqual({ stage: "parked" });
    expect(parseSavedFilters(undefined)).toEqual({});
    expect(parseSavedFilters(null)).toEqual({});
  });

  it("caps the free-text query at 200 characters", () => {
    expect(parseSavedFilters({ q: "a".repeat(250) })).toEqual({});
  });
});

describe("savedFiltersToQuery", () => {
  it("round-trips with parseSavedFilters and omits the default sort", () => {
    const filters = { q: "youth", stage: "cultivating" as const, ownerId: OWNER, tier: 1 as const, collectionId: LIST, sort: "due" as const };
    const qs = savedFiltersToQuery(filters);
    expect(qs.startsWith("?")).toBe(true);
    const parsed = parseSavedFilters(Object.fromEntries(new URLSearchParams(qs.slice(1))));
    expect(parsed).toEqual(filters);
    expect(savedFiltersToQuery({ sort: "updated" })).toBe("");
    expect(savedFiltersToQuery({})).toBe("");
  });
});

describe("hasFilters", () => {
  it("ignores sort on its own", () => {
    expect(hasFilters({ sort: "name" })).toBe(false);
    expect(hasFilters({ q: "x" })).toBe(true);
    expect(hasFilters({ tier: 3 })).toBe(true);
  });
});

describe("task views", () => {
  it("falls back to the open view for unknown values", () => {
    expect(parseTaskView("overdue")).toBe("overdue");
    expect(parseTaskView(["done"])).toBe("done");
    expect(parseTaskView("everything")).toBe("open");
    expect(parseTaskView(undefined)).toBe("open");
  });

  it("links the default view to the bare path", () => {
    expect(taskViewHref("open")).toBe("/app/tasks");
    expect(taskViewHref("mine")).toBe("/app/tasks?view=mine");
  });
});
