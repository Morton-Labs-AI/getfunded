// @vitest-environment node
import { describe, expect, it } from "vitest";

import { authorizeCron, cronSecretFrom, runDailyMaintenance } from "@/lib/admin/cron";
import { makeFakeSql } from "../billing/fake-sql";

const SECRET = "s3cret-value-with-enough-entropy";

function req(headers: Record<string, string> = {}) {
  return new Request("https://getfunded.test/api/cron/daily", { headers });
}

describe("authorizeCron", () => {
  it("is a 503 when CRON_SECRET is unset, whatever the request carries", () => {
    expect(authorizeCron(req({ authorization: `Bearer ${SECRET}` }), {})).toMatchObject({ ok: false, status: 503, code: "cron_not_configured" });
    expect(authorizeCron(req(), { CRON_SECRET: "   " })).toMatchObject({ ok: false, status: 503 });
  });

  it("accepts Authorization: Bearer (what Vercel Cron sends) and x-cron-secret", () => {
    expect(authorizeCron(req({ authorization: `Bearer ${SECRET}` }), { CRON_SECRET: SECRET })).toEqual({ ok: true });
    expect(authorizeCron(req({ authorization: `bearer   ${SECRET}` }), { CRON_SECRET: SECRET })).toEqual({ ok: true });
    expect(authorizeCron(req({ "x-cron-secret": SECRET }), { CRON_SECRET: ` ${SECRET} ` })).toEqual({ ok: true });
  });

  it("is a 401 for a missing, wrong, or near-miss secret", () => {
    expect(authorizeCron(req(), { CRON_SECRET: SECRET })).toMatchObject({ ok: false, status: 401, code: "unauthorized" });
    expect(authorizeCron(req({ authorization: "Bearer nope" }), { CRON_SECRET: SECRET })).toMatchObject({ ok: false, status: 401 });
    expect(authorizeCron(req({ authorization: `Bearer ${SECRET}x` }), { CRON_SECRET: SECRET })).toMatchObject({ ok: false, status: 401 });
    expect(authorizeCron(req({ authorization: `Basic ${SECRET}` }), { CRON_SECRET: SECRET })).toMatchObject({ ok: false, status: 401 });
  });

  it("cronSecretFrom prefers the bearer token", () => {
    expect(cronSecretFrom(req({ authorization: "Bearer abc", "x-cron-secret": "def" }))).toBe("abc");
    expect(cronSecretFrom(req({ "x-cron-secret": "def" }))).toBe("def");
    expect(cronSecretFrom(req())).toBeNull();
  });
});

describe("runDailyMaintenance", () => {
  it("calls the daily_maintenance door with the default intervals and reports the counts, including the ledger reaper", async () => {
    const fake = makeFakeSql((call) => (call.text.includes("getfunded.daily_maintenance(") ? [{ events_pruned: "12", sends_failed: 1, ledger_reaped: "3" }] : []));
    const r = await runDailyMaintenance(fake.sql);
    expect(r).toMatchObject({ eventsPruned: 12, sendsFailed: 1, ledgerReaped: 3 });
    expect(r.ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fake.calls[0].text).toContain("select events_pruned, sends_failed, ledger_reaped");
    // The three-argument door from migration 0011: retention, stale send, stale reservation.
    expect(fake.calls[0].text).toContain("from getfunded.daily_maintenance($1::interval, $2::interval, $3::interval)");
    expect(fake.calls[0].values).toEqual(["12 months", "1 hour", "1 hour"]);
  });

  it("passes custom intervals through and tolerates an empty result", async () => {
    const fake = makeFakeSql(() => []);
    const r = await runDailyMaintenance(fake.sql, { eventRetention: "18 months", staleSendAfter: "30 minutes", staleReservationAfter: "2 hours" });
    expect(r).toMatchObject({ eventsPruned: 0, sendsFailed: 0, ledgerReaped: 0 });
    expect(fake.calls[0].values).toEqual(["18 months", "30 minutes", "2 hours"]);
  });
});
