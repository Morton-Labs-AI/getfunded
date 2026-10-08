// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  QuotaExceededError,
  clampAnchorDay,
  parseQuotaExceeded,
  periodEnd,
  periodFractionElapsed,
  periodStart,
  quotaDetailFrom,
  todayWindow,
} from "@/lib/billing/quota";

const utc = (iso: string) => new Date(iso);
const day = (d: Date) => d.toISOString().slice(0, 10);

describe("periodStart / periodEnd", () => {
  it("anchor day 1: calendar months", () => {
    expect(day(periodStart(utc("2026-03-15T12:00:00Z"), 1))).toBe("2026-03-01");
    expect(day(periodEnd(utc("2026-03-15T12:00:00Z"), 1))).toBe("2026-04-01");
    expect(day(periodStart(utc("2026-03-01T00:00:00Z"), 1))).toBe("2026-03-01");
  });

  it("anchor day 31 clamps in short months", () => {
    // Mid-March: the period started on the clamped February anchor.
    expect(day(periodStart(utc("2026-03-15T00:00:00Z"), 31))).toBe("2026-02-28");
    expect(day(periodEnd(utc("2026-03-15T00:00:00Z"), 31))).toBe("2026-03-31");
    // Feb 28 2026 is itself the clamped anchor.
    expect(day(periodStart(utc("2026-02-28T10:00:00Z"), 31))).toBe("2026-02-28");
    expect(day(periodEnd(utc("2026-02-28T10:00:00Z"), 31))).toBe("2026-03-31");
    // Leap year: Feb 29 2028.
    expect(day(periodStart(utc("2028-03-10T00:00:00Z"), 31))).toBe("2028-02-29");
    // April 30 -> next anchor is May 31.
    expect(day(periodStart(utc("2026-04-30T00:00:00Z"), 31))).toBe("2026-04-30");
    expect(day(periodEnd(utc("2026-04-30T00:00:00Z"), 31))).toBe("2026-05-31");
    // Mar 31 -> Apr 30.
    expect(day(periodStart(utc("2026-03-31T23:59:59Z"), 31))).toBe("2026-03-31");
    expect(day(periodEnd(utc("2026-03-31T23:59:59Z"), 31))).toBe("2026-04-30");
  });

  it("crosses the year boundary", () => {
    expect(day(periodStart(utc("2026-01-10T00:00:00Z"), 15))).toBe("2025-12-15");
    expect(day(periodEnd(utc("2026-01-10T00:00:00Z"), 15))).toBe("2026-01-15");
    expect(day(periodStart(utc("2025-12-20T00:00:00Z"), 15))).toBe("2025-12-15");
    expect(day(periodEnd(utc("2025-12-20T00:00:00Z"), 15))).toBe("2026-01-15");
    expect(day(periodStart(utc("2026-01-01T00:00:00Z"), 1))).toBe("2026-01-01");
    expect(day(periodEnd(utc("2025-12-31T23:00:00Z"), 1))).toBe("2026-01-01");
  });

  it("end is always after start and periods tile the calendar", () => {
    for (const anchor of [1, 15, 28, 29, 30, 31]) {
      for (let d = 0; d < 400; d++) {
        const now = new Date(Date.UTC(2026, 0, 1 + d, 12));
        const s = periodStart(now, anchor);
        const e = periodEnd(now, anchor);
        expect(s.getTime()).toBeLessThanOrEqual(now.getTime());
        expect(e.getTime()).toBeGreaterThan(now.getTime());
        expect(periodStart(new Date(e.getTime()), anchor).getTime()).toBe(e.getTime());
      }
    }
  });

  it("clamps silly anchors to 1..31 and reports elapsed fraction", () => {
    expect(clampAnchorDay(0)).toBe(1);
    expect(clampAnchorDay(45)).toBe(31);
    expect(clampAnchorDay(null)).toBe(1);
    expect(clampAnchorDay(Number.NaN)).toBe(1);
    expect(periodFractionElapsed(utc("2026-03-16T00:00:00Z"), 1)).toBeCloseTo(15 / 31, 5);
    expect(periodFractionElapsed(utc("2026-03-01T00:00:00Z"), 1)).toBe(0);
  });
});

describe("todayWindow", () => {
  it("UTC by default", () => {
    const w = todayWindow(utc("2026-03-15T22:30:00Z"));
    expect(w.start.toISOString()).toBe("2026-03-15T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-16T00:00:00.000Z");
    expect(w.date).toBe("2026-03-15");
    expect(w.timeZone).toBe("UTC");
  });
  it("respects a time zone west of Greenwich", () => {
    // 22:30Z on Mar 15 is 15:30 in Los Angeles (PDT, UTC-7).
    const w = todayWindow(utc("2026-03-15T22:30:00Z"), "America/Los_Angeles");
    expect(w.date).toBe("2026-03-15");
    expect(w.start.toISOString()).toBe("2026-03-15T07:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-16T07:00:00.000Z");
    // 03:00Z on Mar 16 is still Mar 15 evening in Los Angeles.
    expect(todayWindow(utc("2026-03-16T03:00:00Z"), "America/Los_Angeles").date).toBe("2026-03-15");
  });
  it("handles the DST switch day", () => {
    // US DST started 2026-03-08 at 02:00 local: the day is 23 hours long.
    const w = todayWindow(utc("2026-03-08T20:00:00Z"), "America/New_York");
    expect(w.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
  it("falls back to UTC for an invalid zone", () => {
    const w = todayWindow(utc("2026-03-15T22:30:00Z"), "Mars/Olympus");
    expect(w.timeZone).toBe("UTC");
    expect(w.date).toBe("2026-03-15");
  });
});

describe("quota errors", () => {
  it("parses the detail JSON reserve_credits raises", () => {
    expect(parseQuotaExceeded('{"scope":"monthly","used":25,"limit":25,"requested":5,"period_end":"2026-11-01"}')).toEqual({
      scope: "monthly",
      used: 25,
      limit: 25,
      requested: 5,
      period_end: "2026-11-01",
    });
    expect(parseQuotaExceeded('quota_exceeded: {"used":3,"limit":9}')).toMatchObject({ used: 3, limit: 9, period_end: null });
    expect(parseQuotaExceeded("quota_exceeded")).toBeNull();
    expect(parseQuotaExceeded("something else")).toBeNull();
    expect(parseQuotaExceeded(null)).toBeNull();
  });

  it("finds the payload on a DbError-shaped wrapper (detail already parsed)", () => {
    const err = Object.assign(new Error("This workspace has used its AI credits for the period."), {
      code: "quota_exceeded",
      detail: { scope: "daily", used: 9, limit: 9, requested: 1, period_end: "2026-03-16" },
    });
    expect(quotaDetailFrom(err)).toMatchObject({ scope: "daily", used: 9, limit: 9, period_end: "2026-03-16" });
  });

  it("finds the payload on the underlying PostgresError through `cause`", () => {
    const pg = Object.assign(new Error("quota_exceeded"), {
      code: "P0001",
      detail: '{"scope":"monthly","used":150,"limit":150,"period_end":"2026-04-01"}',
    });
    const wrapped = new Error("wrapped", { cause: pg });
    expect(quotaDetailFrom(wrapped)).toMatchObject({ scope: "monthly", used: 150, limit: 150 });
    expect(quotaDetailFrom(new Error("boom"))).toBeNull();
    expect(quotaDetailFrom(Object.assign(new Error("other"), { code: "P0001" }))).toBeNull();
  });

  it("QuotaExceededError carries the UI fields", () => {
    const e = new QuotaExceededError({ used: 25, limit: 25, periodEnd: utc("2026-11-01T00:00:00Z"), feature: "fit", scope: "monthly" });
    expect(e.code).toBe("quota_exceeded");
    expect(e.status).toBe(402);
    expect(e.message).toContain("25 of 25");
    expect(e.message).toContain("2026-11-01");
    expect(e.toJSON()).toMatchObject({ error: "quota_exceeded", used: 25, limit: 25, feature: "fit", upgradeUrl: "/pricing" });
    expect(e instanceof Error).toBe(true);
  });
});
