// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  expectPgError,
  listMigrationFiles,
  readMigration,
  rolesBlocks,
  type ProvisionedUser,
  type TestDb,
} from "./harness";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

describe("row level security", () => {
  let db: TestDb;
  let alice: ProvisionedUser; // owner of workspace A
  let bob: ProvisionedUser; // owner of workspace B
  let carol: ProvisionedUser; // plain member of workspace A
  let funderA: string;
  let funderB: string;

  beforeAll(async () => {
    db = await createTestDb();
    alice = await db.createUser("alice@example.org", "Alice Example");
    bob = await db.createUser("bob@example.org", "Bob Example");
    carol = await db.createUser("carol@example.org", "Carol Example");

    // Alice (owner) adds Carol to workspace A as a plain member.
    await db.asUser(alice.userId, async (tx) => {
      await tx.query(
        "insert into getfunded.members (workspace_id, user_id, role, invited_by) values ($1, $2, 'member', $3)",
        [alice.workspaceId, carol.userId, alice.userId],
      );
    });

    funderA = (
      await db.asUser(alice.userId, (tx) =>
        tx.query<{ id: string }>(
          `insert into getfunded.saved_funders (workspace_id, org_id, snapshot, created_by)
           values ($1, $2, '{"name":"Placeholder Foundation A"}', $3) returning id`,
          [alice.workspaceId, ORG_A, alice.userId],
        ),
      )
    ).rows[0].id;

    funderB = (
      await db.asUser(bob.userId, (tx) =>
        tx.query<{ id: string }>(
          `insert into getfunded.saved_funders (workspace_id, org_id, snapshot, created_by)
           values ($1, $2, '{"name":"Placeholder Foundation B"}', $3) returning id`,
          [bob.workspaceId, ORG_B, bob.userId],
        ),
      )
    ).rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("lets a member read only their own workspace's saved_funders", async () => {
    const seen = await db.asUser(alice.userId, (tx) =>
      tx.query<{ id: string; workspace_id: string }>("select id, workspace_id from getfunded.saved_funders"),
    );
    expect(seen.rows.map((r) => r.id)).toEqual([funderA]);

    const direct = await db.asUser(alice.userId, (tx) =>
      tx.query("select id from getfunded.saved_funders where id = $1", [funderB]),
    );
    expect(direct.rows).toEqual([]);

    const bobs = await db.asUser(bob.userId, (tx) =>
      tx.query<{ id: string }>("select id from getfunded.saved_funders"),
    );
    expect(bobs.rows.map((r) => r.id)).toEqual([funderB]);
  });

  it("returns nothing when app.user_id is not set (fail closed)", async () => {
    const seen = await db.asUser(null, (tx) => tx.query("select id from getfunded.saved_funders"));
    expect(seen.rows).toEqual([]);
    const ws = await db.asUser(null, (tx) => tx.query("select id from getfunded.workspaces"));
    expect(ws.rows).toEqual([]);
  });

  it("refuses an insert into a workspace the caller is not a member of", async () => {
    const err = await expectPgError(() =>
      db.asUser(alice.userId, (tx) =>
        tx.query(
          "insert into getfunded.saved_funders (workspace_id, org_id) values ($1, $2)",
          [bob.workspaceId, "33333333-3333-4333-8333-333333333333"],
        ),
      ),
    );
    expect(err.message).toMatch(/row-level security/i);
    expect(err.code).toBe("42501");
  });

  it("refuses an update that would move a row to another workspace", async () => {
    const err = await expectPgError(() =>
      db.asUser(alice.userId, (tx) =>
        tx.query("update getfunded.saved_funders set workspace_id = $1 where id = $2", [bob.workspaceId, funderA]),
      ),
    );
    expect(err.message).toMatch(/row-level security/i);
  });

  it("lets only admins update workspaces", async () => {
    const asMember = await db.asUser(carol.userId, (tx) =>
      tx.query("update getfunded.workspaces set name = 'Renamed by member' where id = $1", [alice.workspaceId]),
    );
    expect(asMember.affectedRows ?? 0).toBe(0);

    const asOwner = await db.asUser(alice.userId, (tx) =>
      tx.query("update getfunded.workspaces set name = 'Renamed by owner' where id = $1", [alice.workspaceId]),
    );
    expect(asOwner.affectedRows).toBe(1);

    const row = await db.one<{ name: string; version: number }>(
      "select name, version from getfunded.workspaces where id = $1",
      [alice.workspaceId],
    );
    expect(row).toEqual({ name: "Renamed by owner", version: 2 });

    // Carol can still read it.
    const read = await db.asUser(carol.userId, (tx) =>
      tx.query<{ name: string }>("select name from getfunded.workspaces where id = $1", [alice.workspaceId]),
    );
    expect(read.rows[0]?.name).toBe("Renamed by owner");
  });

  it("never lets the app write plan state directly", async () => {
    const err = await expectPgError(() =>
      db.asUser(alice.userId, (tx) =>
        tx.query("update getfunded.workspaces set plan = 'enterprise' where id = $1", [alice.workspaceId]),
      ),
    );
    expect(err.message).toMatch(/permission denied/i);

    const ins = await expectPgError(() =>
      db.asUser(alice.userId, (tx) =>
        tx.query("insert into getfunded.workspaces (slug, name) values ('rogue', 'Rogue')"),
      ),
    );
    expect(ins.message).toMatch(/permission denied/i);

    const sub = await expectPgError(() =>
      db.asUser(alice.userId, (tx) =>
        tx.query(
          "insert into getfunded.subscriptions (workspace_id, plan, status) values ($1, 'pro', 'active')",
          [alice.workspaceId],
        ),
      ),
    );
    expect(sub.message).toMatch(/permission denied/i);
  });

  it("lets only admins manage members", async () => {
    const err = await expectPgError(() =>
      db.asUser(carol.userId, (tx) =>
        tx.query("insert into getfunded.members (workspace_id, user_id, role) values ($1, $2, 'admin')", [
          alice.workspaceId,
          bob.userId,
        ]),
      ),
    );
    expect(err.message).toMatch(/row-level security/i);

    const promote = await db.asUser(carol.userId, (tx) =>
      tx.query("update getfunded.members set role = 'owner' where workspace_id = $1 and user_id = $2", [
        alice.workspaceId,
        carol.userId,
      ]),
    );
    expect(promote.affectedRows ?? 0).toBe(0);
  });

  it("keeps ai_analyses append-only: insert and select work, update and delete are refused", async () => {
    const inserted = await db.asUser(alice.userId, (tx) =>
      tx.query<{ id: string }>(
        `insert into getfunded.ai_analyses
           (workspace_id, saved_funder_id, org_id, kind, model, prompt_version, input_fingerprint, evidence, output, score, created_by)
         values ($1, $2, $3, 'fit', 'mock', 'v1', 'abc', '{}', '{"reasons":[]}', 42, $4)
         returning id`,
        [alice.workspaceId, funderA, ORG_A, alice.userId],
      ),
    );
    const analysisId = inserted.rows[0].id;

    const read = await db.asUser(alice.userId, (tx) =>
      tx.query<{ id: string }>("select id from getfunded.ai_analyses where id = $1", [analysisId]),
    );
    expect(read.rows).toHaveLength(1);

    const upd = await expectPgError(() =>
      db.asUser(alice.userId, (tx) =>
        tx.query("update getfunded.ai_analyses set is_latest = true where id = $1", [analysisId]),
      ),
    );
    expect(upd.message).toMatch(/permission denied/i);

    const del = await expectPgError(() =>
      db.asUser(alice.userId, (tx) => tx.query("delete from getfunded.ai_analyses where id = $1", [analysisId])),
    );
    expect(del.message).toMatch(/permission denied/i);

    // The door flips is_latest, and only for a member.
    await db.asUser(alice.userId, (tx) => tx.query("select getfunded.mark_latest_analysis($1)", [analysisId]));
    const latest = await db.one<{ is_latest: boolean }>(
      "select is_latest from getfunded.ai_analyses where id = $1",
      [analysisId],
    );
    expect(latest?.is_latest).toBe(true);

    const notMember = await expectPgError(() =>
      db.asUser(bob.userId, (tx) => tx.query("select getfunded.mark_latest_analysis($1)", [analysisId])),
    );
    expect(notMember.message).toMatch(/not a member/);

    // Bob cannot see Alice's analysis at all.
    const bobSees = await db.asUser(bob.userId, (tx) =>
      tx.query("select id from getfunded.ai_analyses where id = $1", [analysisId]),
    );
    expect(bobSees.rows).toEqual([]);
  });

  it("asserts the SQL text grants no UPDATE/DELETE on ai_analyses", () => {
    const text = readMigration(listMigrationFiles().find((f) => f.includes("0005"))!);
    const lines = rolesBlocks(text)
      .flatMap((b) => b.body.split(/\r?\n/))
      .filter((l) => /getfunded\.ai_analyses\b/.test(l) && /^\s*grant/i.test(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\s*grant select, insert on getfunded\.ai_analyses to getfunded_app;/);
  });

  it("keeps stage_history, activities and send_outcomes append-only", async () => {
    await db.asUser(alice.userId, (tx) =>
      tx.query(
        "insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by) values ($1, $2, 'note', 'hello', $3)",
        [alice.workspaceId, funderA, alice.userId],
      ),
    );
    const upd = await expectPgError(() =>
      db.asUser(alice.userId, (tx) => tx.query("update getfunded.activities set body = 'edited'")),
    );
    expect(upd.message).toMatch(/permission denied/i);
    const del = await expectPgError(() =>
      db.asUser(alice.userId, (tx) => tx.query("delete from getfunded.stage_history")),
    );
    expect(del.message).toMatch(/permission denied/i);
    const del2 = await expectPgError(() =>
      db.asUser(alice.userId, (tx) => tx.query("delete from getfunded.send_outcomes")),
    );
    expect(del2.message).toMatch(/permission denied/i);
  });

  it("hides secret ciphertext behind read_secret()", async () => {
    const secret = await db.asUser(alice.userId, (tx) =>
      tx.query<{ id: string }>(
        `insert into getfunded.secrets (workspace_id, owner_user_id, kind, ciphertext, iv, tag)
         values ($1, $2, 'gmail_refresh_token', '\\x01', '\\x02', '\\x03') returning id`,
        [alice.workspaceId, alice.userId],
      ),
    );
    const secretId = secret.rows[0].id;

    const direct = await expectPgError(() =>
      db.asUser(alice.userId, (tx) => tx.query("select ciphertext from getfunded.secrets where id = $1", [secretId])),
    );
    expect(direct.message).toMatch(/permission denied/i);

    const meta = await db.asUser(alice.userId, (tx) =>
      tx.query<{ kind: string }>("select kind from getfunded.secrets where id = $1", [secretId]),
    );
    expect(meta.rows[0]?.kind).toBe("gmail_refresh_token");

    const viaDoor = await db.asUser(alice.userId, (tx) =>
      tx.query<{ key_version: number }>("select key_version from getfunded.read_secret($1)", [secretId]),
    );
    expect(viaDoor.rows).toEqual([{ key_version: 1 }]);

    // Carol is a plain member, not the owner and not an admin.
    const carolErr = await expectPgError(() =>
      db.asUser(carol.userId, (tx) => tx.query("select * from getfunded.read_secret($1)", [secretId])),
    );
    expect(carolErr.message).toMatch(/forbidden/);

    // Bob is in another workspace entirely.
    const bobErr = await expectPgError(() =>
      db.asUser(bob.userId, (tx) => tx.query("select * from getfunded.read_secret($1)", [secretId])),
    );
    expect(bobErr.message).toMatch(/forbidden/);
  });

  it("lets anyone record an anonymous event and nobody delete one", async () => {
    await db.asUser(null, (tx) => tx.query("insert into getfunded.events (name, props) values ('search', '{}')"));
    await db.asUser(alice.userId, (tx) =>
      tx.query("insert into getfunded.events (workspace_id, user_id, name) values ($1, $2, 'saved_funder')", [
        alice.workspaceId,
        alice.userId,
      ]),
    );
    const spoof = await expectPgError(() =>
      db.asUser(alice.userId, (tx) =>
        tx.query("insert into getfunded.events (user_id, name) values ($1, 'spoof')", [bob.userId]),
      ),
    );
    expect(spoof.message).toMatch(/row-level security/i);

    const del = await expectPgError(() => db.asUser(alice.userId, (tx) => tx.query("delete from getfunded.events")));
    expect(del.message).toMatch(/permission denied/i);
  });

  it("lets co-members see each other's user rows but not strangers", async () => {
    const aliceSees = await db.asUser(alice.userId, (tx) =>
      tx.query<{ email: string }>("select email from getfunded.users order by email"),
    );
    expect(aliceSees.rows.map((r) => r.email)).toEqual(["alice@example.org", "carol@example.org"]);

    const bobSees = await db.asUser(bob.userId, (tx) =>
      tx.query<{ email: string }>("select email from getfunded.users order by email"),
    );
    expect(bobSees.rows.map((r) => r.email)).toEqual(["bob@example.org"]);

    const steward = await expectPgError(() =>
      db.asUser(bob.userId, (tx) => tx.query("update getfunded.users set is_steward = true where id = $1", [bob.userId])),
    );
    expect(steward.message).toMatch(/permission denied/i);
  });

  it("keeps rate_limits unreachable except through take_token()", async () => {
    const err = await expectPgError(() => db.asUser(alice.userId, (tx) => tx.query("select * from getfunded.rate_limits")));
    expect(err.message).toMatch(/permission denied/i);
    const ok = await db.asUser(null, (tx) =>
      tx.query<{ take_token: boolean }>("select getfunded.take_token('ip:test:search', 30, 0.5)"),
    );
    expect(ok.rows[0].take_token).toBe(true);
  });
});
