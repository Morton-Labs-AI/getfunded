// @vitest-environment node
/**
 * migrations/getfunded_0011_signup_invites_and_reaper.sql on the full chain in
 * PGlite, as the app role with app.user_id set:
 *   - has_pending_invite(email): the sign-up gate's door (anonymous caller)
 *   - invite_preview(token): the invited address for the signed-in holder
 *   - accept_invite(token) bound to the invited email ('invite_wrong_email')
 *   - daily_maintenance(): the usage_ledger reaper (ledger_reaped)
 *   - grants and idempotent replay
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectPgError, listMigrationFiles, type ProvisionedUser, type TestDb } from "./harness";

describe("getfunded_0011_signup_invites_and_reaper", () => {
  let db: TestDb;
  let owner: ProvisionedUser;
  let invitee: ProvisionedUser;
  let stranger: ProvisionedUser;

  const invite = (token: string, email: string, extra = "") =>
    db.asUser(owner.userId, (tx) =>
      tx.query(
        `insert into getfunded.invites (workspace_id, email, role, token_hash, invited_by${extra ? ", expires_at" : ""})
         values ($1, $2, 'member', getfunded.hash_token($3), $4${extra ? `, ${extra}` : ""})`,
        [owner.workspaceId, email, token, owner.userId],
      ),
    );

  const pending = (email: string | null) =>
    db.asUser(null, (tx) => tx.query<{ ok: boolean }>("select getfunded.has_pending_invite($1) as ok", [email]));

  beforeAll(async () => {
    db = await createTestDb();
    owner = await db.createUser("owner@example.org", "Owner Example");
    invitee = await db.createUser("invitee@example.org", "Invitee Example");
    stranger = await db.createUser("stranger@example.org", "Stranger Example");
    await invite("tok-pending", "Invitee@Example.org");
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("is the eleventh migration file", () => {
    expect(listMigrationFiles().find((f) => f.startsWith("getfunded_0011_"))).toBe("getfunded_0011_signup_invites_and_reaper.sql");
  });

  describe("has_pending_invite", () => {
    it("is true for a pending invite, case-insensitively, for an anonymous caller", async () => {
      expect((await pending("invitee@example.org")).rows[0].ok).toBe(true);
      expect((await pending("INVITEE@EXAMPLE.ORG")).rows[0].ok).toBe(true);
    });

    it("is false for strangers, blanks, nulls and expired invites", async () => {
      expect((await pending("nobody@example.org")).rows[0].ok).toBe(false);
      expect((await pending("   ")).rows[0].ok).toBe(false);
      expect((await pending(null)).rows[0].ok).toBe(false);
      await invite("tok-expired", "late@example.org", "now() - interval '1 minute'");
      expect((await pending("late@example.org")).rows[0].ok).toBe(false);
    });

    it("never exposes the invite rows themselves to a non-admin", async () => {
      const seen = await db.asUser(stranger.userId, (tx) => tx.query("select id from getfunded.invites"));
      expect(seen.rows).toEqual([]);
    });
  });

  describe("invite_preview", () => {
    it("shows the signed-in holder the invited address, the workspace, the role and the status", async () => {
      const r = await db.asUser(stranger.userId, (tx) =>
        tx.query<{ email: string; workspace_name: string; role: string; status: string }>("select * from getfunded.invite_preview($1)", ["tok-pending"]),
      );
      expect(r.rows).toEqual([{ email: "Invitee@Example.org", workspace_name: "Owner Example", role: "member", status: "pending" }]);
      const expired = await db.asUser(invitee.userId, (tx) => tx.query<{ status: string }>("select status from getfunded.invite_preview('tok-expired')"));
      expect(expired.rows[0].status).toBe("expired");
    });

    it("returns no row for an unknown token and refuses anonymous callers", async () => {
      const none = await db.asUser(invitee.userId, (tx) => tx.query("select * from getfunded.invite_preview('nope')"));
      expect(none.rows).toEqual([]);
      const anon = await expectPgError(() => db.asUser(null, (tx) => tx.query("select * from getfunded.invite_preview('tok-pending')")));
      expect(anon.code).toBe("28000");
    });
  });

  describe("accept_invite is bound to the invited email", () => {
    it("refuses an account signed in with a different address and leaves the invite pending", async () => {
      const err = await expectPgError(() => db.asUser(stranger.userId, (tx) => tx.query("select getfunded.accept_invite('tok-pending')")));
      expect(err.message).toBe("invite_wrong_email");
      const row = await db.one<{ accepted_at: string | null }>("select accepted_at from getfunded.invites where token_hash = getfunded.hash_token('tok-pending')");
      expect(row?.accepted_at).toBeNull();
      const member = await db.one<{ n: number }>("select count(*)::int as n from getfunded.members where workspace_id = $1 and user_id = $2", [
        owner.workspaceId,
        stranger.userId,
      ]);
      expect(member?.n).toBe(0);
      expect((await pending("invitee@example.org")).rows[0].ok).toBe(true);
    });

    it("still joins the invited account (case-insensitive), then the invite is used", async () => {
      const ok = await db.asUser(invitee.userId, (tx) => tx.query<{ ws: string }>("select getfunded.accept_invite('tok-pending') as ws"));
      expect(ok.rows[0].ws).toBe(owner.workspaceId);
      const member = await db.one<{ role: string }>("select role from getfunded.members where workspace_id = $1 and user_id = $2", [owner.workspaceId, invitee.userId]);
      expect(member?.role).toBe("member");
      expect((await pending("invitee@example.org")).rows[0].ok).toBe(false);
      const preview = await db.asUser(invitee.userId, (tx) => tx.query<{ status: string }>("select status from getfunded.invite_preview('tok-pending')"));
      expect(preview.rows[0].status).toBe("used");
      const again = await expectPgError(() => db.asUser(stranger.userId, (tx) => tx.query("select getfunded.accept_invite('tok-pending')")));
      expect(again.message).toBe("invite_used");
    });

    it("keeps the earlier refusals, which run before the email check: unknown, expired, anonymous", async () => {
      expect((await expectPgError(() => db.asUser(invitee.userId, (tx) => tx.query("select getfunded.accept_invite('nope')")))).message).toBe("invite_invalid");
      expect((await expectPgError(() => db.asUser(stranger.userId, (tx) => tx.query("select getfunded.accept_invite('tok-expired')")))).message).toBe("invite_expired");
      expect((await expectPgError(() => db.asUser(null, (tx) => tx.query("select getfunded.accept_invite('tok-pending')")))).code).toBe("28000");
    });
  });

  describe("daily_maintenance reaps stuck reservations", () => {
    it("refunds 'reserved' rows older than an hour with meta.reaped, leaves fresh and settled rows alone, and reports the count", async () => {
      // bigint ids arrive as numbers or strings depending on the driver; compare as text.
      const reserve = async () =>
        String((await db.asUser(owner.userId, (tx) => tx.query<{ id: string | number }>("select getfunded.reserve_credits($1, 'fit', 5, null, null) as id", [owner.workspaceId]))).rows[0].id);
      const stuck = await reserve();
      const fresh = await reserve();
      const settledOld = await reserve();
      await db.asUser(owner.userId, (tx) =>
        tx.query("update getfunded.usage_ledger set status = 'settled', model = 'mock', input_tokens = 10, output_tokens = 1, settled_at = now() where id = $1", [settledOld]),
      );
      await db.exec(`update getfunded.usage_ledger set created_at = now() - interval '2 hours' where id in (${stuck}, ${settledOld})`);

      const before = await db.asUser(owner.userId, (tx) =>
        tx.query<{ credits_used: number }>("select credits_used from getfunded.v_usage_period where workspace_id = $1", [owner.workspaceId]),
      );
      expect(before.rows[0].credits_used).toBe(15);

      const out = await db.asUser(null, (tx) =>
        tx.query<{ events_pruned: number | string; sends_failed: number | string; ledger_reaped: number | string }>(
          "select * from getfunded.daily_maintenance(interval '12 months', interval '1 hour', interval '1 hour')",
        ),
      );
      expect(Number(out.rows[0].ledger_reaped)).toBe(1);

      const rows = await db.rows<{ id: string; status: string; settled_at: string | null; meta: Record<string, unknown> }>(
        "select id::text as id, status, settled_at, meta from getfunded.usage_ledger where workspace_id = $1 order by id",
        [owner.workspaceId],
      );
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(stuck)).toMatchObject({ status: "refunded", meta: { reaped: true, reaped_by: "cron:daily" } });
      expect(byId.get(stuck)?.settled_at).toBeTruthy();
      expect(byId.get(fresh)).toMatchObject({ status: "reserved" });
      expect(byId.get(fresh)?.meta).not.toHaveProperty("reaped");
      expect(byId.get(settledOld)).toMatchObject({ status: "settled" });

      // The credits came back to the workspace.
      const after = await db.asUser(owner.userId, (tx) =>
        tx.query<{ credits_used: number }>("select credits_used from getfunded.v_usage_period where workspace_id = $1", [owner.workspaceId]),
      );
      expect(after.rows[0].credits_used).toBe(10);

      const cron = await db.one<{ props: { ledger_reaped: number } }>("select props from getfunded.events where name = 'cron:daily' order by id desc limit 1");
      expect(cron!.props).toMatchObject({ ledger_reaped: 1 });

      // Nothing left to reap on the second run, through the three-argument form the cron uses.
      const again = await db.asUser(null, (tx) =>
        tx.query<{ ledger_reaped: number | string }>(
          "select ledger_reaped from getfunded.daily_maintenance(interval '12 months', interval '1 hour', interval '1 hour')",
        ),
      );
      expect(Number(again.rows[0].ledger_reaped)).toBe(0);
    });

    it("refuses a reservation window under 10 minutes (a live call must never be reaped)", async () => {
      const err = await expectPgError(() =>
        db.asUser(null, (tx) => tx.query("select * from getfunded.daily_maintenance(interval '12 months', interval '1 hour', interval '1 minute')")),
      );
      expect(err.message).toMatch(/at least 10 minutes/);
    });

    it("the 0009 two-argument door still answers with its two columns and delegates (same event shape)", async () => {
      const out = await db.asUser(null, (tx) => tx.query<Record<string, unknown>>("select * from getfunded.daily_maintenance()"));
      expect(Object.keys(out.rows[0]).sort()).toEqual(["events_pruned", "sends_failed"]);
      const cron = await db.one<{ props: Record<string, unknown> }>("select props from getfunded.events where name = 'cron:daily' order by id desc limit 1");
      expect(cron!.props).toHaveProperty("ledger_reaped");
    });
  });

  it("grants execute on the doors to the app role", async () => {
    const r = await db.one<{ a: boolean; b: boolean; c: boolean; d: boolean; e: boolean }>(
      `select has_function_privilege('getfunded_app', 'getfunded.has_pending_invite(text)', 'execute') as a,
              has_function_privilege('getfunded_app', 'getfunded.invite_preview(text)', 'execute') as b,
              has_function_privilege('getfunded_app', 'getfunded.accept_invite(text)', 'execute') as c,
              has_function_privilege('getfunded_app', 'getfunded.daily_maintenance(interval, interval, interval)', 'execute') as d,
              has_function_privilege('getfunded_app', 'getfunded.daily_maintenance(interval, interval)', 'execute') as e`,
    );
    expect(r).toEqual({ a: true, b: true, c: true, d: true, e: true });
  });

  it("replays idempotently", async () => {
    await db.replayMigrations();
    const fns = await db.rows<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'getfunded' and p.proname in ('has_pending_invite', 'invite_preview', 'accept_invite', 'daily_maintenance') order by 1`,
    );
    // Two daily_maintenance overloads: the 0009 two-argument door and the 0011 three-argument one.
    expect(fns.map((f) => f.proname)).toEqual(["accept_invite", "daily_maintenance", "daily_maintenance", "has_pending_invite", "invite_preview"]);
  });
});
