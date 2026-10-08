// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectPgError, type ProvisionedUser, type TestDb } from "./harness";

interface QuotaDetail {
  scope: "monthly" | "daily";
  used: number;
  limit: number;
  requested: number;
  period_end: string;
}

describe("usage and limits", () => {
  let db: TestDb;
  let owner: ProvisionedUser;
  let outsider: ProvisionedUser;

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createUser("owner@example.org", "Owner Example");
    outsider = await db.createUser("outsider@example.org", "Outsider Example");
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  const reserve = (user: string, ws: string, feature: string, credits: number, monthly: number | null, daily: number | null) =>
    db.asUser(user, (tx) =>
      tx.query<{ id: string }>("select getfunded.reserve_credits($1, $2, $3, $4, $5) as id", [
        ws,
        feature,
        credits,
        monthly,
        daily,
      ]),
    );

  describe("period_start / period_end", () => {
    const cases: Array<[number, string, string, string]> = [
      // anchor, as_of, expected start, expected end
      [1, "2026-03-15", "2026-03-01", "2026-04-01"],
      [1, "2026-03-01", "2026-03-01", "2026-04-01"],
      [15, "2026-03-10", "2026-02-15", "2026-03-15"],
      [15, "2026-03-15", "2026-03-15", "2026-04-15"],
      [15, "2026-03-16", "2026-03-15", "2026-04-15"],
      [31, "2026-03-05", "2026-02-28", "2026-03-31"], // clamps to Feb 28
      [31, "2026-03-31", "2026-03-31", "2026-04-30"], // clamps to Apr 30
      [30, "2026-02-10", "2026-01-30", "2026-02-28"],
      [31, "2024-03-01", "2024-02-29", "2024-03-31"], // leap year
      [1, "2026-01-01", "2026-01-01", "2026-02-01"],
      [5, "2026-01-02", "2025-12-05", "2026-01-05"], // across the year boundary
    ];

    for (const [anchor, asOf, start, end] of cases) {
      it(`anchor ${anchor} on ${asOf} -> [${start}, ${end})`, async () => {
        const row = await db.one<{ s: string; e: string }>(
          "select getfunded.period_start($1, $2::date)::text as s, getfunded.period_end($1, $2::date)::text as e",
          [anchor, asOf],
        );
        expect(row).toEqual({ s: start, e: end });
      });
    }
  });

  describe("reserve_credits", () => {
    it("reserves within the monthly limit and refuses past it with a JSON detail", async () => {
      const first = await reserve(owner.userId, owner.workspaceId, "fit", 5, 10, null);
      expect(first.rows[0].id).toBeTruthy();
      const second = await reserve(owner.userId, owner.workspaceId, "fit", 5, 10, null);
      expect(second.rows[0].id).not.toBe(first.rows[0].id);

      const err = await expectPgError(() => reserve(owner.userId, owner.workspaceId, "filter", 1, 10, null));
      expect(err.message).toBe("quota_exceeded");
      expect(err.code).toBe("P0001");
      const detail = JSON.parse(err.detail ?? "{}") as QuotaDetail;
      expect(detail.scope).toBe("monthly");
      expect(detail.used).toBe(10);
      expect(detail.limit).toBe(10);
      expect(detail.requested).toBe(1);
      expect(detail.period_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Nothing was inserted by the refused call.
      const rows = await db.rows<{ status: string; credits: number; feature: string }>(
        "select status, credits, feature from getfunded.usage_ledger where workspace_id = $1 order by id",
        [owner.workspaceId],
      );
      expect(rows).toEqual([
        { status: "reserved", credits: 5, feature: "fit" },
        { status: "reserved", credits: 5, feature: "fit" },
      ]);

      // A null monthly limit means unlimited.
      const unlimited = await reserve(owner.userId, owner.workspaceId, "filter", 1, null, null);
      expect(unlimited.rows[0].id).toBeTruthy();
    });

    it("counts settled rows but not refunded ones", async () => {
      const ws = (await db.createUser("refund@example.org", "Refund Example")).workspaceId;
      const u = (await db.one<{ id: string }>("select id from getfunded.users where email = 'refund@example.org'"))!.id;

      const a = await reserve(u, ws, "research", 10, 20, null);
      const b = await reserve(u, ws, "research", 10, 20, null);
      await expectPgError(() => reserve(u, ws, "filter", 1, 20, null));

      // The app settles one row and refunds the other through the column grants.
      await db.asUser(u, (tx) =>
        tx.query(
          "update getfunded.usage_ledger set status = 'settled', model = 'mock', input_tokens = 100, output_tokens = 20, latency_ms = 5, settled_at = now() where id = $1",
          [a.rows[0].id],
        ),
      );
      await db.asUser(u, (tx) =>
        tx.query("update getfunded.usage_ledger set status = 'refunded', settled_at = now() where id = $1", [b.rows[0].id]),
      );

      const ok = await reserve(u, ws, "filter", 1, 20, null);
      expect(ok.rows[0].id).toBeTruthy();

      const meter = await db.asUser(u, (tx) =>
        tx.query<{ credits_used: number; credits_today: number }>(
          "select credits_used, credits_today from getfunded.v_usage_period where workspace_id = $1",
          [ws],
        ),
      );
      expect(meter.rows[0]).toEqual({ credits_used: 11, credits_today: 11 });
    });

    it("enforces the daily cap separately", async () => {
      const ws = (await db.createUser("daily@example.org", "Daily Example")).workspaceId;
      const u = (await db.one<{ id: string }>("select id from getfunded.users where email = 'daily@example.org'"))!.id;

      await reserve(u, ws, "ask", 2, 100, 3);
      const err = await expectPgError(() => reserve(u, ws, "ask", 2, 100, 3));
      expect(err.message).toBe("quota_exceeded");
      const detail = JSON.parse(err.detail ?? "{}") as QuotaDetail;
      expect(detail.scope).toBe("daily");
      expect(detail.used).toBe(2);
      expect(detail.limit).toBe(3);

      // A row from a previous day in this period counts monthly but not daily.
      await db.exec(
        `update getfunded.usage_ledger set created_at = now() - interval '2 days' where workspace_id = '${ws}'`,
      );
      const ok = await reserve(u, ws, "ask", 2, 100, 3);
      expect(ok.rows[0].id).toBeTruthy();
      const monthly = await expectPgError(() => reserve(u, ws, "ask", 2, 5, 100));
      expect((JSON.parse(monthly.detail ?? "{}") as QuotaDetail).scope).toBe("monthly");
    });

    it("honours billing_anchor_day: rows from the previous period are not counted", async () => {
      const ws = (await db.createUser("anchor@example.org", "Anchor Example")).workspaceId;
      const u = (await db.one<{ id: string }>("select id from getfunded.users where email = 'anchor@example.org'"))!.id;

      // Anchor on tomorrow's day-of-month puts us at the end of a period that
      // began last month; anchor on today's day starts a fresh period today.
      const today = (await db.one<{ d: number; dom_tomorrow: number }>(
        "select extract(day from getfunded.utc_today())::int as d, extract(day from getfunded.utc_today() + 1)::int as dom_tomorrow",
      ))!;

      await db.exec(`update getfunded.workspaces set billing_anchor_day = ${today.dom_tomorrow} where id = '${ws}'`);
      const prevStart = (await db.one<{ ps: string }>(
        "select getfunded.period_start(billing_anchor_day)::text as ps from getfunded.workspaces where id = $1",
        [ws],
      ))!.ps;
      await reserve(u, ws, "fit", 5, 5, null);
      await expectPgError(() => reserve(u, ws, "filter", 1, 5, null));
      const stored = await db.one<{ period_start: string }>(
        "select period_start::text from getfunded.usage_ledger where workspace_id = $1",
        [ws],
      );
      expect(stored?.period_start).toBe(prevStart);

      // Move the anchor to today: a new period starts today, so the old row
      // belongs to the previous period and the quota is fresh.
      await db.exec(`update getfunded.workspaces set billing_anchor_day = ${today.d} where id = '${ws}'`);
      const freshStart = (await db.one<{ ps: string }>(
        "select getfunded.period_start(billing_anchor_day)::text as ps from getfunded.workspaces where id = $1",
        [ws],
      ))!.ps;
      expect(freshStart).not.toBe(prevStart);
      const ok = await reserve(u, ws, "fit", 5, 5, null);
      expect(ok.rows[0].id).toBeTruthy();

      const meter = await db.asUser(u, (tx) =>
        tx.query<{ period_start: string; credits_used: number }>(
          "select period_start::text, credits_used from getfunded.v_usage_period where workspace_id = $1",
          [ws],
        ),
      );
      expect(meter.rows[0]).toEqual({ period_start: freshStart, credits_used: 5 });
    });

    it("refuses non-members, bad features and non-positive credits", async () => {
      const notMember = await expectPgError(() => reserve(outsider.userId, owner.workspaceId, "fit", 1, null, null));
      expect(notMember.message).toMatch(/not a member/);
      const badFeature = await expectPgError(() => reserve(owner.userId, owner.workspaceId, "mining", 1, null, null));
      expect(badFeature.message).toMatch(/unknown feature/);
      const zero = await expectPgError(() => reserve(owner.userId, owner.workspaceId, "fit", 0, null, null));
      expect(zero.message).toMatch(/positive/);
    });

    it("limits app updates to the settle columns", async () => {
      const r = await reserve(owner.userId, owner.workspaceId, "draft", 2, null, null);
      const id = r.rows[0].id;
      const credits = await expectPgError(() =>
        db.asUser(owner.userId, (tx) => tx.query("update getfunded.usage_ledger set credits = 1 where id = $1", [id])),
      );
      expect(credits.message).toMatch(/permission denied/i);
      const ws = await expectPgError(() =>
        db.asUser(owner.userId, (tx) =>
          tx.query("update getfunded.usage_ledger set workspace_id = $2 where id = $1", [id, outsider.workspaceId]),
        ),
      );
      expect(ws.message).toMatch(/permission denied/i);
      const del = await expectPgError(() =>
        db.asUser(owner.userId, (tx) => tx.query("delete from getfunded.usage_ledger where id = $1", [id])),
      );
      expect(del.message).toMatch(/permission denied/i);
      const settle = await db.asUser(owner.userId, (tx) =>
        tx.query("update getfunded.usage_ledger set status = 'settled', settled_at = now(), meta = '{\"ok\":true}' where id = $1", [id]),
      );
      expect(settle.affectedRows).toBe(1);
    });
  });

  describe("take_token", () => {
    const take = (key: string, cap: number, refill: number) =>
      db.asUser(null, (tx) =>
        tx.query<{ ok: boolean }>("select getfunded.take_token($1, $2, $3) as ok", [key, cap, refill]),
      );

    it("spends tokens up to capacity, then refuses", async () => {
      expect((await take("ip:10.0.0.1:search", 2, 1)).rows[0].ok).toBe(true);
      expect((await take("ip:10.0.0.1:search", 2, 1)).rows[0].ok).toBe(true);
      expect((await take("ip:10.0.0.1:search", 2, 1)).rows[0].ok).toBe(false);
      // Another key is an independent bucket.
      expect((await take("ip:10.0.0.2:search", 2, 1)).rows[0].ok).toBe(true);
    });

    it("refills over time at refill_per_sec, capped at capacity", async () => {
      await take("user:u1:search", 2, 1);
      await take("user:u1:search", 2, 1);
      expect((await take("user:u1:search", 2, 1)).rows[0].ok).toBe(false);

      // Pretend 1.5 seconds passed: one token back.
      await db.exec("update getfunded.rate_limits set updated_at = updated_at - interval '1.5 seconds' where key = 'user:u1:search'");
      expect((await take("user:u1:search", 2, 1)).rows[0].ok).toBe(true);
      expect((await take("user:u1:search", 2, 1)).rows[0].ok).toBe(false);

      // Pretend an hour passed: capped at capacity (2), not 3600.
      await db.exec("update getfunded.rate_limits set updated_at = updated_at - interval '1 hour' where key = 'user:u1:search'");
      expect((await take("user:u1:search", 2, 1)).rows[0].ok).toBe(true);
      expect((await take("user:u1:search", 2, 1)).rows[0].ok).toBe(true);
      expect((await take("user:u1:search", 2, 1)).rows[0].ok).toBe(false);
      const row = await db.one<{ tokens: string }>(
        "select tokens::text from getfunded.rate_limits where key = 'user:u1:search'",
      );
      expect(Number(row?.tokens)).toBeLessThan(1);
    });

    it("rejects an empty key or a non-positive capacity", async () => {
      const e1 = await expectPgError(() => take("", 2, 1));
      expect(e1.message).toMatch(/key is required/);
      const e2 = await expectPgError(() => take("k", 0, 1));
      expect(e2.message).toMatch(/capacity/);
    });
  });
});
