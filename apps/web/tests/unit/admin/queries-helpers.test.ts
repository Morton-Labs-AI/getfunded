// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));
vi.mock("@/lib/db/app", () => ({ withUser: async () => { throw new Error("real withUser"); } }));

import { dayWindow, fillDays, likePattern, pivotFeatures } from "@/lib/admin/queries";

describe("dayWindow", () => {
  it("lists UTC days oldest first, ending today", () => {
    const days = dayWindow(3, new Date("2026-03-01T23:59:00Z"));
    expect(days).toEqual(["2026-02-27", "2026-02-28", "2026-03-01"]);
    expect(dayWindow(30, new Date("2026-10-07T12:00:00Z"))).toHaveLength(30);
  });
});

describe("fillDays / pivotFeatures", () => {
  const days = ["2026-01-01", "2026-01-02", "2026-01-03"];
  it("fills missing days with zero", () => {
    expect(fillDays(days, [{ day: "2026-01-02", n: 4 }])).toEqual([
      { day: "2026-01-01", n: 0 },
      { day: "2026-01-02", n: 4 },
      { day: "2026-01-03", n: 0 },
    ]);
  });
  it("pivots feature rows into one series per feature in FEATURES order", () => {
    const series = pivotFeatures(days, [
      { day: "2026-01-01", feature: "fit", credits: 5 },
      { day: "2026-01-03", feature: "fit", credits: 10 },
      { day: "2026-01-02", feature: "filter", credits: 1 },
    ]);
    expect(series.map((s) => s.feature)).toEqual(["filter", "ask", "draft", "fit", "research"]);
    expect(series.find((s) => s.feature === "fit")).toEqual({ feature: "fit", values: [5, 0, 10], total: 15 });
    expect(series.find((s) => s.feature === "ask")).toEqual({ feature: "ask", values: [0, 0, 0], total: 0 });
  });
});

describe("likePattern", () => {
  it("escapes LIKE wildcards and wraps in %", () => {
    expect(likePattern("food")).toBe("%food%");
    expect(likePattern("100%_x\\")).toBe("%100\\%\\_x\\\\%");
  });
});
