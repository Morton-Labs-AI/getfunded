// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, expectPgError, type ProvisionedUser, type TestDb } from "./harness";

const ORG = "44444444-4444-4444-8444-444444444444";

describe("funders: move_stage and compare-and-swap", () => {
  let db: TestDb;
  let dev: ProvisionedUser;
  let stranger: ProvisionedUser;
  let funderId: string;

  beforeAll(async () => {
    db = await createTestDb();
    dev = await db.createUser("dev@example.org", "Development Director");
    stranger = await db.createUser("stranger@example.org", "Stranger");
    funderId = (
      await db.asUser(dev.userId, (tx) =>
        tx.query<{ id: string }>(
          `insert into getfunded.saved_funders (workspace_id, org_id, snapshot, created_by, source_detail)
           values ($1, $2, '{"name":"Placeholder Foundation","ein":"000000000"}', $3, 'test')
           returning id`,
          [dev.workspaceId, ORG, dev.userId],
        ),
      )
    ).rows[0].id;
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  const move = (user: string, id: string, stage: string, expected: number | null, note: string | null) =>
    db.asUser(user, (tx) =>
      tx.query<{ v: number }>("select getfunded.move_stage($1, $2, $3, $4) as v", [id, stage, expected, note]),
    );

  it("moves the stage, bumps the version, and writes history plus a system activity", async () => {
    const r = await move(dev.userId, funderId, "researching", 1, "Kickoff call booked");
    expect(r.rows[0].v).toBe(2);

    const funder = await db.one<{ stage: string; version: number }>(
      "select stage, version from getfunded.saved_funders where id = $1",
      [funderId],
    );
    expect(funder).toEqual({ stage: "researching", version: 2 });

    const history = await db.rows<{ from_stage: string; to_stage: string; changed_by: string; note: string; workspace_id: string }>(
      "select from_stage, to_stage, changed_by, note, workspace_id from getfunded.stage_history where saved_funder_id = $1 order by id",
      [funderId],
    );
    expect(history).toEqual([
      {
        from_stage: "identified",
        to_stage: "researching",
        changed_by: dev.userId,
        note: "Kickoff call booked",
        workspace_id: dev.workspaceId,
      },
    ]);

    const activities = await db.rows<{ kind: string; body: string; created_by: string; meta: Record<string, unknown> }>(
      "select kind, body, created_by, meta from getfunded.activities where saved_funder_id = $1 order by created_at",
      [funderId],
    );
    expect(activities).toHaveLength(1);
    expect(activities[0].kind).toBe("system");
    expect(activities[0].created_by).toBe(dev.userId);
    expect(activities[0].body).toBe("Stage changed from identified to researching: Kickoff call booked");
    expect(activities[0].meta).toEqual({
      event: "stage_change",
      from: "identified",
      to: "researching",
      note: "Kickoff call booked",
    });

    // The member can read both rows under RLS.
    const seen = await db.asUser(dev.userId, (tx) =>
      tx.query<{ n: number }>("select count(*)::int as n from getfunded.stage_history where saved_funder_id = $1", [funderId]),
    );
    expect(seen.rows[0].n).toBe(1);
  });

  it("rejects a stale version and writes nothing", async () => {
    const err = await expectPgError(() => move(dev.userId, funderId, "qualified", 1, null));
    expect(err.message).toBe("stale_version");
    expect(err.code).toBe("40001");
    expect(JSON.parse(err.detail ?? "{}")).toEqual({ expected: 1, actual: 2 });

    const funder = await db.one<{ stage: string; version: number }>(
      "select stage, version from getfunded.saved_funders where id = $1",
      [funderId],
    );
    expect(funder).toEqual({ stage: "researching", version: 2 });
    const n = await db.one<{ n: number }>(
      "select count(*)::int as n from getfunded.stage_history where saved_funder_id = $1",
      [funderId],
    );
    expect(n?.n).toBe(1);
  });

  it("accepts the current version and a null note", async () => {
    const r = await move(dev.userId, funderId, "qualified", 2, null);
    expect(r.rows[0].v).toBe(3);
    const last = await db.one<{ from_stage: string; to_stage: string; note: string | null }>(
      "select from_stage, to_stage, note from getfunded.stage_history where saved_funder_id = $1 order by id desc limit 1",
      [funderId],
    );
    expect(last).toEqual({ from_stage: "researching", to_stage: "qualified", note: null });
    const body = await db.one<{ body: string }>(
      "select body from getfunded.activities where saved_funder_id = $1 order by created_at desc limit 1",
      [funderId],
    );
    expect(body?.body).toBe("Stage changed from researching to qualified");
  });

  it("is a no-op when the stage does not change", async () => {
    const r = await move(dev.userId, funderId, "qualified", 3, "again");
    expect(r.rows[0].v).toBe(3);
    const n = await db.one<{ n: number }>(
      "select count(*)::int as n from getfunded.stage_history where saved_funder_id = $1",
      [funderId],
    );
    expect(n?.n).toBe(2);
  });

  it("refuses a non-member, an unknown stage and an unknown funder", async () => {
    const notMember = await expectPgError(() => move(stranger.userId, funderId, "awarded", 3, null));
    expect(notMember.message).toMatch(/not a member/);
    expect(notMember.code).toBe("42501");

    const anon = await expectPgError(() => move(null as unknown as string, funderId, "awarded", 3, null));
    expect(anon.message).toMatch(/not a member/);

    const badStage = await expectPgError(() => move(dev.userId, funderId, "won", 3, null));
    expect(badStage.message).toMatch(/unknown stage/);

    const missing = await expectPgError(() =>
      move(dev.userId, "99999999-9999-4999-8999-999999999999", "awarded", 1, null),
    );
    expect(missing.message).toBe("saved_funder_not_found");
  });

  it("bumps version once on a plain update and once on an explicit bump", async () => {
    const before = await db.one<{ version: number; updated_at: string }>(
      "select version, updated_at::text from getfunded.saved_funders where id = $1",
      [funderId],
    );
    expect(before?.version).toBe(3);

    // App-style CAS without touching version: the trigger bumps it.
    const cas = await db.asUser(dev.userId, (tx) =>
      tx.query("update getfunded.saved_funders set tier = 2 where id = $1 and version = 3", [funderId]),
    );
    expect(cas.affectedRows).toBe(1);
    let row = await db.one<{ version: number; tier: number; updated_at: string }>(
      "select version, tier, updated_at::text from getfunded.saved_funders where id = $1",
      [funderId],
    );
    expect(row).toMatchObject({ version: 4, tier: 2 });
    expect(new Date(row!.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before!.updated_at).getTime());

    // Explicit bump: not doubled.
    await db.asUser(dev.userId, (tx) =>
      tx.query("update getfunded.saved_funders set tier = 1, version = version + 1 where id = $1 and version = 4", [funderId]),
    );
    row = await db.one("select version, tier, updated_at::text from getfunded.saved_funders where id = $1", [funderId]);
    expect(row).toMatchObject({ version: 5, tier: 1 });

    // Stale CAS matches no row.
    const stale = await db.asUser(dev.userId, (tx) =>
      tx.query("update getfunded.saved_funders set tier = 3 where id = $1 and version = 4", [funderId]),
    );
    expect(stale.affectedRows ?? 0).toBe(0);
  });

  it("enforces one saved row per (workspace, org) and the stage/tier checks", async () => {
    const dup = await expectPgError(() =>
      db.asUser(dev.userId, (tx) =>
        tx.query("insert into getfunded.saved_funders (workspace_id, org_id) values ($1, $2)", [dev.workspaceId, ORG]),
      ),
    );
    expect(dup.code).toBe("23505");

    const badTier = await expectPgError(() =>
      db.asUser(dev.userId, (tx) =>
        tx.query("update getfunded.saved_funders set tier = 9 where id = $1", [funderId]),
      ),
    );
    expect(badTier.code).toBe("23514");
  });

  it("keeps collection items visible only through a visible collection", async () => {
    const col = await db.asUser(dev.userId, (tx) =>
      tx.query<{ id: string }>(
        "insert into getfunded.collections (workspace_id, name, is_shared, created_by) values ($1, 'Spring asks', false, $2) returning id",
        [dev.workspaceId, dev.userId],
      ),
    );
    await db.asUser(dev.userId, (tx) =>
      tx.query("insert into getfunded.collection_items (collection_id, saved_funder_id, position) values ($1, $2, 1)", [
        col.rows[0].id,
        funderId,
      ]),
    );
    const mine = await db.asUser(dev.userId, (tx) =>
      tx.query("select * from getfunded.collection_items where collection_id = $1", [col.rows[0].id]),
    );
    expect(mine.rows).toHaveLength(1);
    const theirs = await db.asUser(stranger.userId, (tx) =>
      tx.query("select * from getfunded.collection_items where collection_id = $1", [col.rows[0].id]),
    );
    expect(theirs.rows).toHaveLength(0);
  });
});
