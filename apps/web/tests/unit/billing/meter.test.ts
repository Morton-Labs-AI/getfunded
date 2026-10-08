// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiClient, AiResponse } from "@/lib/ai/types";
import { AiDisabledError, AiRefusedError } from "@/lib/ai/types";
import { USER, WS, jsonValue, makeFakeSql, makeFakeWithUser, type SqlCall } from "./fake-sql";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({
  appDb: undefined,
  withUser: async () => {
    throw new Error("the real withUser must not run in unit tests");
  },
}));

import { QuotaExceededError, WorkspaceAccessError, flagDisabled, getUsage, limitsFor, meter } from "@/lib/billing/meter";
import { planFor } from "@/lib/plans";

const ENV = { AI_ENABLED: "true", SELF_HOSTED: "" } as Record<string, string | undefined>;

type Rows = Record<string, unknown>[];

/** Default happy-path rows: flag on, free workspace, no overrides, ledger id 42. */
function defaultRows(call: SqlCall): Rows | undefined {
  if (call.text.includes("from getfunded.flags")) return [{ value: true }];
  if (call.text.includes("from getfunded.workspaces")) return [{ plan: "free", settings: {}, billing_anchor_day: 1 }];
  if (call.text.includes("from getfunded.plan_overrides")) return [];
  if (call.text.includes("getfunded.reserve_credits(")) return [{ id: "42" }];
  if (call.text.includes("from getfunded.v_usage_period")) return [{ credits_used: "7", credits_today: "2" }];
  return [];
}

const okUsage = { inputTokens: 1200, outputTokens: 300, model: "claude-sonnet-5-5" };

function fakeAi(response: Partial<AiResponse> = {}): AiClient {
  const res: AiResponse = { text: "hi", stopReason: "end_turn", usage: okUsage, mock: false, ...response };
  return {
    mode: "live",
    fast: vi.fn(async () => res),
    deep: vi.fn(async () => res),
    stream: vi.fn(async () => res),
  };
}

function quotaDbError(detail: Record<string, unknown>) {
  // Shaped like lib/db/app's DbError.from(PostgresError): code + parsed detail + cause.
  const pg = Object.assign(new Error("quota_exceeded"), { name: "PostgresError", code: "P0001", detail: JSON.stringify(detail) });
  return Object.assign(new Error("This workspace has used its AI credits for the period."), {
    name: "DbError",
    code: "quota_exceeded",
    detail,
    cause: pg,
  });
}

describe("meter()", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("reserves, runs, then settles with real tokens and latency", async () => {
    const fake = makeFakeSql(defaultRows);
    const { withUser, users } = makeFakeWithUser(fake);
    const ai = fakeAi();

    const result = await meter(
      { userId: USER, workspaceId: WS, feature: "fit", meta: { org_id: "abc" } },
      async (client, reservation) => {
        expect(client).toBe(ai);
        expect(reservation).toMatchObject({ ledgerId: "42", credits: 5 });
        expect(reservation.plan.id).toBe("free");
        const r = await client.fast({ system: "s", messages: [{ role: "user", content: "x" }] });
        return { result: { answer: r.text }, usage: r.usage };
      },
      { ai, env: ENV, withUser },
    );

    expect(result).toEqual({ answer: "hi" });
    expect(users).toEqual([USER, USER]); // reserve transaction, settle transaction
    const reserve = fake.find("getfunded.reserve_credits(")[0];
    expect(reserve.values).toEqual([WS, "fit", 5, 25, 9]); // free: 25/month, ceil(25/3) per day
    const metaUpdate = fake.find("set meta = ")[0];
    expect(jsonValue(metaUpdate.values[0])).toEqual({ org_id: "abc" });
    const settle = fake.find("set status = ")[0];
    expect(settle.text).toContain("update getfunded.usage_ledger");
    expect(settle.text).toContain("status = 'reserved'");
    expect(settle.values.slice(0, 4)).toEqual(["settled", "claude-sonnet-5-5", 1200, 300]);
    expect(typeof settle.values[4]).toBe("number"); // latency_ms
    expect(settle.values[6]).toBe("42");
  });

  it("refunds when the run throws, records the error, and rethrows", async () => {
    const fake = makeFakeSql(defaultRows);
    const { withUser } = makeFakeWithUser(fake);
    const boom = new Error("model exploded");
    await expect(
      meter({ userId: USER, workspaceId: WS, feature: "ask" }, async () => { throw boom; }, { ai: fakeAi(), env: ENV, withUser }),
    ).rejects.toBe(boom);
    const settle = fake.find("set status = ")[0];
    expect(settle.values[0]).toBe("refunded");
    expect(settle.values[1]).toBeNull(); // no model known
    expect(jsonValue(settle.values[5])).toMatchObject({ error: "Error: model exploded" });
  });

  it("a refusal refunds but keeps the tokens the model billed", async () => {
    const fake = makeFakeSql(defaultRows);
    const { withUser } = makeFakeWithUser(fake);
    const refusal = new AiRefusedError("declined", { inputTokens: 50, outputTokens: 0, model: "claude-opus-5-5" });
    await expect(
      meter({ userId: USER, workspaceId: WS, feature: "research" }, async () => { throw refusal; }, { ai: fakeAi(), env: ENV, withUser }),
    ).rejects.toBe(refusal);
    const settle = fake.find("set status = ")[0];
    expect(settle.values.slice(0, 4)).toEqual(["refunded", "claude-opus-5-5", 50, 0]);
  });

  it("maps a P0001 quota_exceeded raise to QuotaExceededError and never runs the model", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.includes("getfunded.reserve_credits(")) {
        throw quotaDbError({ scope: "monthly", used: 25, limit: 25, requested: 5, period_end: "2026-11-01" });
      }
      return defaultRows(call);
    });
    const { withUser } = makeFakeWithUser(fake);
    const ai = fakeAi();
    const run = vi.fn();
    const err = (await meter({ userId: USER, workspaceId: WS, feature: "fit" }, run, { ai, env: ENV, withUser }).catch((e: unknown) => e)) as QuotaExceededError;
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err).toMatchObject({ used: 25, limit: 25, feature: "fit", scope: "monthly", status: 402 });
    expect(err.periodEnd?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(run).not.toHaveBeenCalled();
    expect(fake.find("set status = ")).toHaveLength(0);
  });

  it("recognises the daily scope", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.includes("getfunded.reserve_credits(")) {
        throw quotaDbError({ scope: "daily", used: 9, limit: 9, requested: 1, period_end: "2026-03-16" });
      }
      return defaultRows(call);
    });
    const { withUser } = makeFakeWithUser(fake);
    const err = (await meter({ userId: USER, workspaceId: WS, feature: "filter" }, vi.fn(), { ai: fakeAi(), env: ENV, withUser }).catch((e: unknown) => e)) as QuotaExceededError;
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect(err.scope).toBe("daily");
    expect(err.message).toContain("today");
  });

  it("other database errors pass through untouched", async () => {
    const dbErr = Object.assign(new Error("permission denied"), { code: "forbidden" });
    const fake = makeFakeSql((call) => {
      if (call.text.includes("getfunded.reserve_credits(")) throw dbErr;
      return defaultRows(call);
    });
    const { withUser } = makeFakeWithUser(fake);
    await expect(meter({ userId: USER, workspaceId: WS, feature: "fit" }, vi.fn(), { ai: fakeAi(), env: ENV, withUser })).rejects.toBe(dbErr);
  });

  it("refuses with AiDisabledError when AI_ENABLED=false, before touching the database", async () => {
    const fake = makeFakeSql(defaultRows);
    const { withUser } = makeFakeWithUser(fake);
    await expect(
      meter({ userId: USER, workspaceId: WS, feature: "fit" }, vi.fn(), { ai: fakeAi(), env: { AI_ENABLED: "false" }, withUser }),
    ).rejects.toBeInstanceOf(AiDisabledError);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses when the ai_enabled flag is off", async () => {
    const fake = makeFakeSql((call) => (call.text.includes("from getfunded.flags") ? [{ value: false }] : defaultRows(call)));
    const { withUser } = makeFakeWithUser(fake);
    const run = vi.fn();
    await expect(meter({ userId: USER, workspaceId: WS, feature: "fit" }, run, { ai: fakeAi(), env: ENV, withUser })).rejects.toBeInstanceOf(AiDisabledError);
    expect(run).not.toHaveBeenCalled();
    expect(fake.find("getfunded.reserve_credits(")).toHaveLength(0);
  });

  it("SELF_HOSTED passes null limits (recorded, never refused)", async () => {
    const fake = makeFakeSql(defaultRows);
    const { withUser } = makeFakeWithUser(fake);
    await meter(
      { userId: USER, workspaceId: WS, feature: "research" },
      async (_ai, r) => {
        expect(r.plan.id).toBe("unlimited");
        return { result: 1, usage: okUsage };
      },
      { ai: fakeAi(), env: { ...ENV, SELF_HOSTED: "true" }, withUser },
    );
    expect(fake.find("getfunded.reserve_credits(")[0].values).toEqual([WS, "research", 10, null, null]);
  });

  it("applies plan_overrides and the Team daily-cap opt-out", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.includes("from getfunded.workspaces")) return [{ plan: "team", settings: { daily_cap_enabled: false }, billing_anchor_day: 1 }];
      if (call.text.includes("from getfunded.plan_overrides")) return [{ monthly_credits: 5000, members: null }];
      return defaultRows(call);
    });
    const { withUser } = makeFakeWithUser(fake);
    await meter({ userId: USER, workspaceId: WS, feature: "ask" }, async () => ({ result: 1, usage: okUsage }), { ai: fakeAi(), env: ENV, withUser });
    expect(fake.find("getfunded.reserve_credits(")[0].values).toEqual([WS, "ask", 2, 5000, null]);
  });

  it("a Free workspace cannot switch the daily cap off", () => {
    expect(limitsFor(planFor({ plan: "free" }, null, ENV), { daily_cap_enabled: false })).toEqual({ monthly: 25, daily: 9 });
    expect(limitsFor(planFor({ plan: "team" }, null, ENV), { daily_cap_enabled: false })).toEqual({ monthly: 3000, daily: null });
    expect(limitsFor(planFor({ plan: "team" }, null, ENV), {})).toEqual({ monthly: 3000, daily: 1000 });
  });

  it("throws WorkspaceAccessError when RLS hides the workspace", async () => {
    const fake = makeFakeSql((call) => (call.text.includes("from getfunded.workspaces") ? [] : defaultRows(call)));
    const { withUser } = makeFakeWithUser(fake);
    await expect(meter({ userId: USER, workspaceId: WS, feature: "fit" }, vi.fn(), { ai: fakeAi(), env: ENV, withUser })).rejects.toBeInstanceOf(WorkspaceAccessError);
  });

  it("validates its context with zod", async () => {
    const fake = makeFakeSql(defaultRows);
    const { withUser } = makeFakeWithUser(fake);
    await expect(meter({ userId: "nope", workspaceId: WS, feature: "fit" }, vi.fn(), { ai: fakeAi(), env: ENV, withUser })).rejects.toThrow();
    await expect(
      meter({ userId: USER, workspaceId: WS, feature: "teleport" as never }, vi.fn(), { ai: fakeAi(), env: ENV, withUser }),
    ).rejects.toThrow();
    expect(fake.calls).toHaveLength(0);
  });

  it("marks mock-mode rows in meta", async () => {
    const fake = makeFakeSql(defaultRows);
    const { withUser } = makeFakeWithUser(fake);
    const ai = { ...fakeAi({ mock: true, usage: { inputTokens: 0, outputTokens: 0, model: "mock" } }), mode: "mock" as const };
    await meter({ userId: USER, workspaceId: WS, feature: "fit" }, async (c) => { const r = await c.fast({ system: "", messages: [] }); return { result: r, usage: r.usage }; }, { ai, env: ENV, withUser });
    const settle = fake.find("set status = ")[0];
    expect(settle.values.slice(0, 4)).toEqual(["settled", "mock", 0, 0]);
    expect(jsonValue(settle.values[5])).toEqual({ mock: true });
  });

  it("a failed settle is logged, not thrown, and the result still returns", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.includes("set status = ")) throw new Error("connection reset");
      return defaultRows(call);
    });
    const { withUser } = makeFakeWithUser(fake);
    const log = vi.fn();
    const out = await meter({ userId: USER, workspaceId: WS, feature: "fit" }, async () => ({ result: "ok", usage: okUsage }), { ai: fakeAi(), env: ENV, withUser, log });
    expect(out).toBe("ok");
    expect(log).toHaveBeenCalledWith("usage_ledger settle failed", expect.objectContaining({ ledgerId: "42", error: "connection reset" }));
  });
});

describe("getUsage()", () => {
  it("returns the usage meter numbers", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.includes("from getfunded.workspaces")) return [{ plan: "starter", settings: {}, billing_anchor_day: 15 }];
      return defaultRows(call);
    });
    const { withUser, users } = makeFakeWithUser(fake);
    const u = await getUsage(WS, USER, { env: ENV, withUser, now: () => new Date("2026-03-10T12:00:00Z") });
    expect(users).toEqual([USER]);
    expect(u).toMatchObject({
      plan: "starter",
      planName: "Starter",
      monthlyLimit: 150,
      dailyLimit: 50,
      used: 7,
      usedToday: 2,
      remaining: 143,
      remainingToday: 48,
      unlimited: false,
      overridden: false,
    });
    expect(u.periodStart.toISOString().slice(0, 10)).toBe("2026-02-15");
    expect(u.periodEnd.toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(u.creditCosts.fit).toBe(5);
  });

  it("reports unlimited for self-hosted and zero usage when the view has no row", async () => {
    const fake = makeFakeSql((call) => (call.text.includes("v_usage_period") ? [] : defaultRows(call)));
    const { withUser } = makeFakeWithUser(fake);
    const u = await getUsage(WS, USER, { env: { SELF_HOSTED: "true" }, withUser });
    expect(u).toMatchObject({ plan: "unlimited", unlimited: true, monthlyLimit: null, remaining: null, used: 0, usedToday: 0 });
  });
});

describe("flagDisabled", () => {
  it("reads the jsonb flag shapes", () => {
    expect(flagDisabled(true)).toBe(false);
    expect(flagDisabled(false)).toBe(true);
    expect(flagDisabled("false")).toBe(true);
    expect(flagDisabled({ enabled: false })).toBe(true);
    expect(flagDisabled({ enabled: true })).toBe(false);
    expect(flagDisabled(null)).toBe(false);
  });
});
