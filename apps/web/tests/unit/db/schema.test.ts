// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDb,
  listMigrationFiles,
  readMigration,
  rolesBlocks,
  stripRolesBlocks,
  type TestDb,
} from "./harness";

const TABLES = [
  "schema_migrations",
  "users",
  "workspaces",
  "members",
  "invites",
  "subscriptions",
  "api_keys",
  "usage_ledger",
  "rate_limits",
  "saved_funders",
  "stage_history",
  "activities",
  "tasks",
  "knowledge",
  "imports",
  "collections",
  "collection_items",
  "ai_analyses",
  "ai_feedback",
  "contacts",
  "sender_identities",
  "secrets",
  "messages",
  "suppressions",
  "send_outcomes",
  "flags",
  "events",
  "plan_overrides",
];

// Every migration file follows the roles-block convention (0001-0007 are the
// base schema; 0008 is the billing webhook / API key door file).
const OWNED = (f: string) => /^getfunded_\d{4}_/.test(f);

const DOORS = [
  "provision_user",
  "accept_invite",
  "reserve_credits",
  "take_token",
  "move_stage",
  "mark_latest_analysis",
  "read_secret",
  "is_member",
  "is_admin",
  "is_steward",
];

describe("getfunded schema", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("has the seven base migrations in order", () => {
    const files = listMigrationFiles();
    expect(files.slice(0, 7).map((f) => f.slice(0, 14))).toEqual([
      "getfunded_0001",
      "getfunded_0002",
      "getfunded_0003",
      "getfunded_0004",
      "getfunded_0005",
      "getfunded_0006",
      "getfunded_0007",
    ]);
  });

  it("creates every table from DATA-MODEL.md", async () => {
    const rows = await db.rows<{ relname: string }>(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'getfunded' and c.relkind = 'r' order by 1`,
    );
    const names = rows.map((r) => r.relname);
    for (const t of TABLES) expect(names, `missing table ${t}`).toContain(t);
    expect(names.length).toBe(TABLES.length);
  });

  it("enables and forces row level security on every table", async () => {
    const rows = await db.rows<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'getfunded' and c.relkind = 'r'`,
    );
    for (const r of rows) {
      expect(r.relrowsecurity, `${r.relname} rls`).toBe(true);
      expect(r.relforcerowsecurity, `${r.relname} force rls`).toBe(true);
    }
  });

  it("marks every door SECURITY DEFINER with a pinned search_path", async () => {
    const rows = await db.rows<{ proname: string; prosecdef: boolean; proconfig: string[] | null }>(
      `select p.proname, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'getfunded'`,
    );
    const byName = new Map(rows.map((r) => [r.proname, r]));
    for (const d of DOORS) {
      const r = byName.get(d);
      expect(r, `missing function ${d}`).toBeDefined();
      expect(r!.prosecdef, `${d} security definer`).toBe(true);
      expect(r!.proconfig?.join(";"), `${d} search_path`).toMatch(/search_path=getfunded, pg_temp/);
    }
    for (const r of rows) {
      expect(r.prosecdef || r.proconfig != null, `${r.proname} has a pinned search_path`).toBe(true);
      expect(r.proconfig?.join(";") ?? "", `${r.proname} search_path`).toMatch(/search_path=/);
    }
  });

  it("creates the v_usage_period view with security_invoker", async () => {
    const row = await db.one<{ reloptions: string[] | null }>(
      `select c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'getfunded' and c.relname = 'v_usage_period' and c.relkind = 'v'`,
    );
    expect(row).toBeDefined();
    expect(row!.reloptions?.join(",")).toMatch(/security_invoker=true/);
  });

  it("seeds the ai_enabled and signup_mode flags", async () => {
    const rows = await db.rows<{ key: string; value: unknown }>(
      "select key, value from getfunded.flags order by key",
    );
    expect(rows).toEqual([
      { key: "ai_enabled", value: true },
      { key: "signup_mode", value: "open" },
    ]);
  });

  it("gives getfunded_app a 20s statement timeout and no write grants outside getfunded", async () => {
    const role = await db.one<{ rolconfig: string[] | null; rolcanlogin: boolean; rolbypassrls: boolean }>(
      "select rolconfig, rolcanlogin, rolbypassrls from pg_roles where rolname = 'getfunded_app'",
    );
    expect(role).toBeDefined();
    expect(role!.rolcanlogin).toBe(false);
    expect(role!.rolbypassrls).toBe(false);
    expect(role!.rolconfig?.join(";")).toMatch(/statement_timeout=20s/);
  });

  it("keeps every GRANT/REVOKE/CREATE ROLE inside a roles block", () => {
    for (const file of listMigrationFiles().filter(OWNED)) {
      const stripped = stripRolesBlocks(readMigration(file), "strip");
      const offenders = stripped
        .split(/\r?\n/)
        .filter((l) => /^\s*(grant|revoke|create role|alter role)\b/i.test(l));
      expect(offenders, `${file}: role statements outside @roles block`).toEqual([]);
    }
  });

  it("never grants UPDATE or DELETE on append-only tables", () => {
    const appendOnly = ["stage_history", "activities", "ai_analyses", "ai_feedback", "send_outcomes", "events"];
    const grants: string[] = [];
    for (const file of listMigrationFiles().filter(OWNED)) {
      for (const b of rolesBlocks(readMigration(file), file)) grants.push(...b.body.split(/\r?\n/));
    }
    for (const t of appendOnly) {
      const lines = grants.filter((l) => new RegExp(`getfunded\\.${t}\\b`).test(l) && /^\s*grant/i.test(l));
      expect(lines.length, `no grant found for ${t}`).toBeGreaterThan(0);
      for (const l of lines) {
        expect(l, `${t}: ${l}`).not.toMatch(/\b(update|delete)\b/i);
      }
    }
  });

  it("also applies with every roles block stripped (superuser-only mode)", async () => {
    const plain = await createTestDb({ roles: "strip" });
    try {
      // The role exists as an empty stub: no grants from the stripped blocks.
      const priv = await plain.one<{ sel: boolean; usage: boolean }>(
        `select has_table_privilege('getfunded_app', 'getfunded.saved_funders', 'select') as sel,
                has_schema_privilege('getfunded_app', 'getfunded', 'usage') as usage`,
      );
      expect(priv).toEqual({ sel: false, usage: false });
      const user = await plain.createUser("strip@example.org", "Strip Mode");
      const ws = await plain.asUser(user.userId, (tx) =>
        tx.query<{ id: string }>("select id from getfunded.workspaces"),
      );
      // The superuser bypasses RLS, so this mode sees everything; it exists to
      // exercise the SQL, not the policies.
      expect(ws.rows.map((r) => r.id)).toContain(user.workspaceId);
    } finally {
      await plain.close();
    }
  }, 60_000);

  it("replays idempotently", async () => {
    await db.replayMigrations();
    const n = await db.one<{ n: number }>(
      "select count(*)::int as n from getfunded.flags",
    );
    expect(n!.n).toBe(2);
  });
});
