// @vitest-environment node
/**
 * migrations/getfunded_0009_steward.sql on the full chain (0001..0009) in PGlite,
 * as the app role with app.user_id set: steward policies, the three doors, and
 * idempotent replay.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectPgError, listMigrationFiles, type ProvisionedUser, type TestDb } from "../db/harness";

describe("getfunded_0009_steward", () => {
  let db: TestDb;
  let steward: ProvisionedUser;
  let alice: ProvisionedUser;
  let bob: ProvisionedUser;

  beforeAll(async () => {
    db = await createTestDb();
    steward = await db.createUser("steward@example.org", "Steward Example");
    alice = await db.createUser("alice@example.org", "Alice Example");
    bob = await db.createUser("bob@example.org", "Bob Example");
    // Bootstrap the first steward the way an operator would (by hand, as the owner).
    await db.exec(`update getfunded.users set is_steward = true where email = 'steward@example.org'`);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("is the ninth migration file", () => {
    const files = listMigrationFiles();
    expect(files.find((f) => f.startsWith("getfunded_0009_"))).toBe("getfunded_0009_steward.sql");
  });

  describe("steward read policies", () => {
    it("a steward sees every user, workspace, member and ledger row; a member sees only their own", async () => {
      await db.asUser(alice.userId, (tx) =>
        tx.query("select getfunded.reserve_credits($1, 'fit', 5, null, null)", [alice.workspaceId]),
      );
      await db.asUser(bob.userId, (tx) =>
        tx.query("select getfunded.reserve_credits($1, 'ask', 2, null, null)", [bob.workspaceId]),
      );

      const asSteward = await db.asUser(steward.userId, async (tx) => ({
        users: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.users")).rows[0].n,
        workspaces: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.workspaces")).rows[0].n,
        members: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.members")).rows[0].n,
        ledger: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.usage_ledger")).rows[0].n,
        usage: (await tx.query<{ workspace_id: string; credits_used: number }>(
          "select workspace_id, credits_used from getfunded.v_usage_period order by credits_used desc",
        )).rows,
      }));
      expect(asSteward.users).toBe(3);
      expect(asSteward.workspaces).toBe(3);
      expect(asSteward.members).toBe(3);
      expect(asSteward.ledger).toBe(2);
      expect(asSteward.usage.find((r) => r.workspace_id === alice.workspaceId)?.credits_used).toBe(5);
      expect(asSteward.usage.find((r) => r.workspace_id === bob.workspaceId)?.credits_used).toBe(2);

      const asAlice = await db.asUser(alice.userId, async (tx) => ({
        users: (await tx.query<{ email: string }>("select email::text as email from getfunded.users order by 1")).rows.map((r) => r.email),
        workspaces: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.workspaces")).rows[0].n,
        ledger: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.usage_ledger")).rows[0].n,
      }));
      expect(asAlice.users).toEqual(["alice@example.org"]);
      expect(asAlice.workspaces).toBe(1);
      expect(asAlice.ledger).toBe(1);
    });

    it("a steward reads events, plan_overrides, subscriptions and api_keys metadata across workspaces", async () => {
      await db.asUser(alice.userId, (tx) =>
        tx.query("insert into getfunded.events (workspace_id, user_id, name) values ($1, $2, 'search')", [alice.workspaceId, alice.userId]),
      );
      await db.asUser(steward.userId, (tx) =>
        tx.query("insert into getfunded.plan_overrides (workspace_id, monthly_credits, note, set_by) values ($1, 100, 'pilot', $2)", [
          bob.workspaceId,
          steward.userId,
        ]),
      );
      const seen = await db.asUser(steward.userId, async (tx) => ({
        events: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.events where name = 'search'")).rows[0].n,
        overrides: (await tx.query<{ workspace_id: string; monthly_credits: number }>("select workspace_id, monthly_credits from getfunded.plan_overrides")).rows,
        subs: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.subscriptions")).rows[0].n,
        keys: (await tx.query<{ n: number }>("select count(*)::int as n from getfunded.api_keys")).rows[0].n,
      }));
      expect(seen.events).toBe(1);
      expect(seen.overrides).toEqual([{ workspace_id: bob.workspaceId, monthly_credits: 100 }]);
      expect(seen.subs).toBe(0);
      expect(seen.keys).toBe(0);

      const bobSees = await db.asUser(bob.userId, (tx) =>
        tx.query<{ n: number }>("select count(*)::int as n from getfunded.events where name = 'search'"),
      );
      expect(bobSees.rows[0].n).toBe(0);
    });

    it("never opens customer content to the steward", async () => {
      const orgId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      await db.asUser(alice.userId, (tx) =>
        tx.query("insert into getfunded.saved_funders (workspace_id, org_id, snapshot, created_by) values ($1, $2, '{\"name\":\"X\"}', $3)", [
          alice.workspaceId,
          orgId,
          alice.userId,
        ]),
      );
      const n = await db.asUser(steward.userId, (tx) =>
        tx.query<{ n: number }>("select count(*)::int as n from getfunded.saved_funders"),
      );
      expect(n.rows[0].n).toBe(0);
    });

    it("a steward writes flags and plan_overrides; a member cannot", async () => {
      await db.asUser(steward.userId, (tx) =>
        tx.query(
          `insert into getfunded.flags (key, value, updated_by) values ('banner', $1::jsonb, $2)
           on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`,
          [JSON.stringify({ text: "Maintenance tonight", tone: "info" }), steward.userId],
        ),
      );
      const banner = await db.asUser(null, (tx) =>
        tx.query<{ value: { text: string } }>("select value from getfunded.flags where key = 'banner'"),
      );
      expect(banner.rows[0].value.text).toBe("Maintenance tonight");

      const denied = await db.asUser(alice.userId, (tx) =>
        tx.query("update getfunded.flags set value = 'false'::jsonb where key = 'ai_enabled'"),
      );
      // RLS hides the row from the update rather than erroring: zero rows touched.
      expect(denied.affectedRows ?? 0).toBe(0);
      const still = await db.one<{ value: unknown }>("select value from getfunded.flags where key = 'ai_enabled'");
      expect(still!.value).toBe(true);

      const overrideDenied = await expectPgError(() =>
        db.asUser(alice.userId, (tx) =>
          tx.query("insert into getfunded.plan_overrides (workspace_id, monthly_credits) values ($1, 999)", [alice.workspaceId]),
        ),
      );
      expect(overrideDenied.message).toMatch(/row-level security/i);
      await db.exec("delete from getfunded.flags where key = 'banner'");
    });
  });

  describe("set_steward", () => {
    it("lets a steward promote and demote others, records an event, refuses self-demotion", async () => {
      const promoted = await db.asUser(steward.userId, (tx) =>
        tx.query<{ ok: boolean }>("select getfunded.set_steward($1, true) as ok", [alice.userId]),
      );
      expect(promoted.rows[0].ok).toBe(true);
      const flag = await db.one<{ is_steward: boolean }>("select is_steward from getfunded.users where id = $1", [alice.userId]);
      expect(flag!.is_steward).toBe(true);

      // Alice is now a steward and can read across workspaces.
      const n = await db.asUser(alice.userId, (tx) => tx.query<{ n: number }>("select count(*)::int as n from getfunded.workspaces"));
      expect(n.rows[0].n).toBe(3);

      const ev = await db.one<{ props: { target_user_id: string; is_steward: boolean } }>(
        "select props from getfunded.events where name = 'steward:set' order by id desc limit 1",
      );
      expect(ev!.props).toEqual({ target_user_id: alice.userId, is_steward: true });

      const self = await expectPgError(() =>
        db.asUser(alice.userId, (tx) => tx.query("select getfunded.set_steward($1, false)", [alice.userId])),
      );
      expect(self.message).toBe("steward_self_demote");
      expect(self.code).toBe("42501");

      const demoted = await db.asUser(steward.userId, (tx) =>
        tx.query<{ ok: boolean }>("select getfunded.set_steward($1, false) as ok", [alice.userId]),
      );
      expect(demoted.rows[0].ok).toBe(false);
    });

    it("refuses non-stewards, anonymous callers and unknown users", async () => {
      const member = await expectPgError(() =>
        db.asUser(bob.userId, (tx) => tx.query("select getfunded.set_steward($1, true)", [bob.userId])),
      );
      expect(member.code).toBe("42501");
      const anon = await expectPgError(() =>
        db.asUser(null, (tx) => tx.query("select getfunded.set_steward($1, true)", [bob.userId])),
      );
      expect(anon.code).toBe("28000");
      const missing = await expectPgError(() =>
        db.asUser(steward.userId, (tx) => tx.query("select getfunded.set_steward('00000000-0000-4000-8000-000000000000', true)")),
      );
      expect(missing.message).toBe("user_not_found");
      const direct = await expectPgError(() =>
        db.asUser(steward.userId, (tx) => tx.query("update getfunded.users set is_steward = true where id = $1", [bob.userId])),
      );
      expect(direct.message).toMatch(/permission denied/i);
    });
  });

  describe("claim_steward", () => {
    it("promotes the caller only when their email is listed, case-insensitively, and never demotes", async () => {
      const notListed = await db.asUser(bob.userId, (tx) =>
        tx.query<{ ok: boolean }>("select getfunded.claim_steward($1::text[]) as ok", [["someone-else@example.org"]]),
      );
      expect(notListed.rows[0].ok).toBe(false);

      const listed = await db.asUser(bob.userId, (tx) =>
        tx.query<{ ok: boolean }>("select getfunded.claim_steward($1::text[]) as ok", [["  BOB@Example.org ", "x@example.org"]]),
      );
      expect(listed.rows[0].ok).toBe(true);
      expect((await db.one<{ is_steward: boolean }>("select is_steward from getfunded.users where id = $1", [bob.userId]))!.is_steward).toBe(true);
      // Listing someone else does not touch them.
      expect((await db.one<{ is_steward: boolean }>("select is_steward from getfunded.users where id = $1", [alice.userId]))!.is_steward).toBe(false);

      // Already a steward, list no longer contains them: still a steward.
      const kept = await db.asUser(bob.userId, (tx) => tx.query<{ ok: boolean }>("select getfunded.claim_steward($1::text[]) as ok", [[]]));
      expect(kept.rows[0].ok).toBe(true);

      const claimed = await db.one<{ n: number }>("select count(*)::int as n from getfunded.events where name = 'steward:claimed' and user_id = $1", [bob.userId]);
      expect(claimed!.n).toBe(1);

      const anon = await db.asUser(null, (tx) => tx.query<{ ok: boolean }>("select getfunded.claim_steward($1::text[]) as ok", [["bob@example.org"]]));
      expect(anon.rows[0].ok).toBe(false);
      await db.exec(`update getfunded.users set is_steward = false where id = '${bob.userId}'`);
    });
  });

  describe("daily_maintenance", () => {
    it("prunes old events, fails stale sends with an outcome row, records cron:daily", async () => {
      await db.exec(`
        insert into getfunded.events (name, created_at) values
          ('old_one', now() - interval '13 months'),
          ('old_two', now() - interval '400 days'),
          ('recent',  now() - interval '1 day');
        insert into getfunded.contacts (id, workspace_id, full_name, created_by)
          values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${alice.workspaceId}', 'Program Officer', '${alice.userId}');
        insert into getfunded.messages (id, workspace_id, contact_id, status, approved_by, approved_at, body, created_by)
          values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${alice.workspaceId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'sending', '${alice.userId}', now(), 'hello', '${alice.userId}'),
                 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '${alice.workspaceId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'sending', '${alice.userId}', now(), 'hello', '${alice.userId}'),
                 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '${alice.workspaceId}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'approved', '${alice.userId}', now(), 'hello', '${alice.userId}');
        -- Backdate two of them past the stale window. The set_updated_at trigger
        -- would reset updated_at to now(), so pause it for this seed only.
        alter table getfunded.messages disable trigger trg_messages_updated;
        update getfunded.messages set updated_at = now() - interval '2 hours' where id in ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
        alter table getfunded.messages enable trigger trg_messages_updated;
      `);

      const out = await db.asUser(null, (tx) =>
        tx.query<{ events_pruned: number | string; sends_failed: number | string }>("select * from getfunded.daily_maintenance()"),
      );
      expect(Number(out.rows[0].events_pruned)).toBe(2);
      expect(Number(out.rows[0].sends_failed)).toBe(1);

      const names = (await db.rows<{ name: string }>("select name from getfunded.events where name in ('old_one','old_two','recent','cron:daily') order by name")).map((r) => r.name);
      expect(names).toEqual(["cron:daily", "recent"]);

      const msgs = await db.rows<{ id: string; status: string; error: string | null }>(
        "select id, status, error from getfunded.messages order by id",
      );
      expect(msgs.find((m) => m.id.startsWith("cccccccc"))).toMatchObject({ status: "failed" });
      expect(msgs.find((m) => m.id.startsWith("cccccccc"))!.error).toMatch(/did not finish/);
      expect(msgs.find((m) => m.id.startsWith("dddddddd"))).toMatchObject({ status: "sending", error: null });
      expect(msgs.find((m) => m.id.startsWith("eeeeeeee"))).toMatchObject({ status: "approved" });

      const outcome = await db.one<{ outcome: string; provider_payload: { reason: string } }>(
        "select outcome, provider_payload from getfunded.send_outcomes where message_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'",
      );
      expect(outcome).toEqual({ outcome: "failed", provider_payload: { reason: "stale_sending", reconciled_by: "cron:daily" } });

      const cron = await db.one<{ props: unknown }>("select props from getfunded.events where name = 'cron:daily' order by id desc limit 1");
      // ledger_reaped joined the props in 0011; the reservations made above are minutes old, so none is reaped here.
      expect(cron!.props).toEqual({ events_pruned: 2, sends_failed: 1, ledger_reaped: 0 });
    });

    it("refuses a retention under 30 days or a stale window under 5 minutes", async () => {
      const r = await expectPgError(() => db.asUser(null, (tx) => tx.query("select * from getfunded.daily_maintenance(interval '1 day')")));
      expect(r.message).toMatch(/at least 30 days/);
      const s = await expectPgError(() => db.asUser(null, (tx) => tx.query("select * from getfunded.daily_maintenance(interval '12 months', interval '1 minute')")));
      expect(s.message).toMatch(/at least 5 minutes/);
    });

    it("the app role still cannot delete events directly", async () => {
      const err = await expectPgError(() => db.asUser(steward.userId, (tx) => tx.query("delete from getfunded.events")));
      expect(err.message).toMatch(/permission denied/i);
    });
  });

  it("grants execute on the three doors to the app role and nothing to public", async () => {
    const r = await db.one<{ a: boolean; b: boolean; c: boolean }>(
      `select has_function_privilege('getfunded_app', 'getfunded.set_steward(uuid, boolean)', 'execute') as a,
              has_function_privilege('getfunded_app', 'getfunded.claim_steward(text[])', 'execute') as b,
              has_function_privilege('getfunded_app', 'getfunded.daily_maintenance(interval, interval)', 'execute') as c`,
    );
    expect(r).toEqual({ a: true, b: true, c: true });
  });

  it("replays idempotently", async () => {
    await db.replayMigrations();
    const policies = await db.rows<{ polname: string }>(
      "select polname from pg_policy where polname like 'p_%_steward_%' order by 1",
    );
    // users, workspaces, members, subscriptions, api_keys, usage_ledger, events (1 each),
    // plan_overrides (select/insert/update/delete), flags (select/insert/update).
    expect(policies.length).toBe(14);
    const flags = await db.one<{ n: number }>("select count(*)::int as n from getfunded.flags");
    expect(flags!.n).toBe(2);
  });
});
