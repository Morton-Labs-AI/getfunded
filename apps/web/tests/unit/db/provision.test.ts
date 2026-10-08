// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectPgError, type TestDb } from "./harness";

describe("provision_user and accept_invite", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  const provision = (authId: string, email: string, name: string | null) =>
    db.one<{ user_id: string; workspace_id: string; is_new: boolean }>(
      "select * from getfunded.provision_user($1, $2, $3)",
      [authId, email, name],
    );

  const newAuthUser = async (email: string) =>
    (await db.one<{ id: string }>("insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id", [email]))!.id;

  it("creates the user, a personal workspace and the owner membership on first call", async () => {
    const authId = await newAuthUser("First@Example.ORG");
    const r = (await provision(authId, "  First@Example.ORG ", "Demo Food Bank"))!;
    expect(r.is_new).toBe(true);
    expect(r.user_id).toBe(authId);

    const user = await db.one<{ email: string; display_name: string; last_seen_at: string | null }>(
      "select email, display_name, last_seen_at from getfunded.users where id = $1",
      [authId],
    );
    expect(user).toMatchObject({ email: "first@example.org", display_name: "Demo Food Bank" });
    expect(user?.last_seen_at).toBeTruthy();

    const ws = await db.one<{ slug: string; name: string; plan: string; billing_anchor_day: number }>(
      "select slug, name, plan, billing_anchor_day from getfunded.workspaces where id = $1",
      [r.workspace_id],
    );
    expect(ws).toEqual({ slug: "demo-food-bank", name: "Demo Food Bank", plan: "free", billing_anchor_day: 1 });

    const member = await db.one<{ role: string }>(
      "select role from getfunded.members where workspace_id = $1 and user_id = $2",
      [r.workspace_id, authId],
    );
    expect(member?.role).toBe("owner");
  });

  it("is idempotent: a second call returns the same ids and is_new = false", async () => {
    const authId = await newAuthUser("twice@example.org");
    const first = (await provision(authId, "twice@example.org", "Twice"))!;
    const second = (await provision(authId, "twice@example.org", "Twice Renamed"))!;
    expect(second.is_new).toBe(false);
    expect(second.user_id).toBe(first.user_id);
    expect(second.workspace_id).toBe(first.workspace_id);

    const counts = await db.one<{ users: number; workspaces: number; members: number }>(
      `select (select count(*)::int from getfunded.users where id = $1) as users,
              (select count(*)::int from getfunded.members where user_id = $1) as members,
              (select count(*)::int from getfunded.workspaces where id = $2) as workspaces`,
      [authId, first.workspace_id],
    );
    expect(counts).toEqual({ users: 1, workspaces: 1, members: 1 });

    // The original display name is kept; only a missing one is filled in.
    const name = await db.one<{ display_name: string }>("select display_name from getfunded.users where id = $1", [authId]);
    expect(name?.display_name).toBe("Twice");
  });

  it("makes slugs unique with a numeric suffix", async () => {
    const a = await newAuthUser("slug-a@example.org");
    const b = await newAuthUser("slug-b@example.org");
    const c = await newAuthUser("slug-c@example.org");
    const ra = (await provision(a, "slug-a@example.org", "River Valley Food Pantry"))!;
    const rb = (await provision(b, "slug-b@example.org", "River Valley Food Pantry"))!;
    const rc = (await provision(c, "slug-c@example.org", "  River   Valley Food Pantry!! "))!;
    const slugs = await db.rows<{ slug: string }>(
      "select slug from getfunded.workspaces where id in ($1, $2, $3) order by created_at",
      [ra.workspace_id, rb.workspace_id, rc.workspace_id],
    );
    expect(slugs.map((s) => s.slug)).toEqual([
      "river-valley-food-pantry",
      "river-valley-food-pantry-2",
      "river-valley-food-pantry-3",
    ]);
  });

  it("falls back to the email local part when the name is empty, and to 'workspace' when nothing slugs", async () => {
    const a = await newAuthUser("grants.team@example.org");
    const ra = (await provision(a, "grants.team@example.org", "   "))!;
    const wsA = await db.one<{ slug: string; name: string }>("select slug, name from getfunded.workspaces where id = $1", [ra.workspace_id]);
    expect(wsA).toEqual({ slug: "grants-team", name: "grants.team" });

    const b = await newAuthUser("ok@example.org");
    const rb = (await provision(b, "ok@example.org", "日本語"))!;
    const wsB = await db.one<{ slug: string }>("select slug from getfunded.workspaces where id = $1", [rb.workspace_id]);
    expect(wsB?.slug).toBe("workspace");
  });

  it("rejects a missing id or an invalid email", async () => {
    const noId = await expectPgError(() => provision(null as unknown as string, "x@example.org", "X"));
    expect(noId.message).toMatch(/auth_user_id is required/);
    const authId = await newAuthUser("bad@example.org");
    const badEmail = await expectPgError(() => provision(authId, "not-an-email", "X"));
    expect(badEmail.message).toMatch(/valid email/);
  });

  it("rejects an auth id that does not exist in auth.users (FK)", async () => {
    const err = await expectPgError(() => provision("55555555-5555-4555-8555-555555555555", "ghost@example.org", "Ghost"));
    expect(err.code).toBe("23503");
  });

  it("works when called as the app role before app.user_id is known", async () => {
    const authId = await newAuthUser("approle@example.org");
    const r = await db.asUser(null, (tx) =>
      tx.query<{ user_id: string; workspace_id: string; is_new: boolean }>(
        "select * from getfunded.provision_user($1, $2, $3)",
        [authId, "approle@example.org", "App Role"],
      ),
    );
    expect(r.rows[0].is_new).toBe(true);
    expect(r.rows[0].user_id).toBe(authId);
  });

  describe("accept_invite", () => {
    it("joins the workspace with a valid token exactly once", async () => {
      const owner = await db.createUser("inviter@example.org", "Inviter");
      const joiner = await db.createUser("joiner@example.org", "Joiner");

      await db.asUser(owner.userId, (tx) =>
        tx.query(
          `insert into getfunded.invites (workspace_id, email, role, token_hash, invited_by)
           values ($1, 'joiner@example.org', 'admin', getfunded.hash_token('secret-token-1'), $2)`,
          [owner.workspaceId, owner.userId],
        ),
      );

      // Node's sha256 hex and getfunded.hash_token agree.
      const { createHash } = await import("node:crypto");
      const nodeHash = createHash("sha256").update("secret-token-1").digest("hex");
      const pgHash = await db.one<{ h: string }>("select getfunded.hash_token('secret-token-1') as h");
      expect(pgHash?.h).toBe(nodeHash);

      const accepted = await db.asUser(joiner.userId, (tx) =>
        tx.query<{ ws: string }>("select getfunded.accept_invite($1) as ws", ["secret-token-1"]),
      );
      expect(accepted.rows[0].ws).toBe(owner.workspaceId);

      const member = await db.one<{ role: string; invited_by: string }>(
        "select role, invited_by from getfunded.members where workspace_id = $1 and user_id = $2",
        [owner.workspaceId, joiner.userId],
      );
      expect(member).toEqual({ role: "admin", invited_by: owner.userId });

      const invite = await db.one<{ accepted_at: string | null }>(
        "select accepted_at from getfunded.invites where workspace_id = $1",
        [owner.workspaceId],
      );
      expect(invite?.accepted_at).toBeTruthy();

      const again = await expectPgError(() =>
        db.asUser(joiner.userId, (tx) => tx.query("select getfunded.accept_invite($1)", ["secret-token-1"])),
      );
      expect(again.message).toBe("invite_used");
    });

    it("refuses unknown, expired and anonymous acceptances", async () => {
      const owner = await db.createUser("inviter2@example.org", "Inviter Two");
      const joiner = await db.createUser("joiner2@example.org", "Joiner Two");

      const unknown = await expectPgError(() =>
        db.asUser(joiner.userId, (tx) => tx.query("select getfunded.accept_invite('nope')")),
      );
      expect(unknown.message).toBe("invite_invalid");

      await db.asUser(owner.userId, (tx) =>
        tx.query(
          `insert into getfunded.invites (workspace_id, email, role, token_hash, invited_by, expires_at)
           values ($1, 'joiner2@example.org', 'member', getfunded.hash_token('old-token'), $2, now() - interval '1 minute')`,
          [owner.workspaceId, owner.userId],
        ),
      );
      const expired = await expectPgError(() =>
        db.asUser(joiner.userId, (tx) => tx.query("select getfunded.accept_invite('old-token')")),
      );
      expect(expired.message).toBe("invite_expired");

      const anon = await expectPgError(() =>
        db.asUser(null, (tx) => tx.query("select getfunded.accept_invite('old-token')")),
      );
      expect(anon.message).toMatch(/not signed in/);

      // A plain member cannot see the invite list.
      const seen = await db.asUser(joiner.userId, (tx) =>
        tx.query("select id from getfunded.invites where workspace_id = $1", [owner.workspaceId]),
      );
      expect(seen.rows).toEqual([]);
    });
  });
});
