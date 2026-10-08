/**
 * PGlite harness for the getfunded schema migrations.
 *
 * Boots an in-memory PostgreSQL (PGlite, with citext + pgcrypto), stubs
 * `auth.users` (Supabase Auth is not present), applies `migrations/*.sql` in
 * order and hands back helpers that run statements as the application role
 * (`set local role getfunded_app` + `set_config('app.user_id', …)`), which is
 * exactly how the web app talks to the database.
 *
 * Roles blocks. Every migration keeps its CREATE ROLE / GRANT / REVOKE text
 * between `-- @roles-begin` and `-- @roles-end`. Blocks tagged
 * `-- @roles-begin corpus` reference internal.* objects that exist only in the
 * real database and are always stripped. The remaining blocks are applied by
 * default (PGlite 0.5 supports NOLOGIN roles, GRANT, column grants and SET
 * ROLE), so grant behaviour is tested for real; pass `{ roles: "strip" }` to
 * strip every block and run as the superuser only. In strip mode the role is
 * still created (empty, no grants) so a stray GRANT in a migration that does
 * not follow the block convention cannot break the apply.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../migrations/", import.meta.url));
export const APP_ROLE = "getfunded_app";

export type RolesMode = "apply" | "strip";

export interface RolesBlock {
  file: string;
  tag: string;
  body: string;
}

/** Migration filenames in apply order. */
export function listMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => /^getfunded_\d{4}_.+\.sql$/.test(f))
    .sort();
}

export function readMigration(file: string, dir: string = MIGRATIONS_DIR): string {
  return readFileSync(join(dir, file), "utf8");
}

const BLOCK_RE = /^[ \t]*-- @roles-begin(?:[ \t]+([^\r\n]*?))?[ \t]*\r?\n([\s\S]*?)^[ \t]*-- @roles-end[ \t]*(?:\r?\n|$)/gm;

/** Every roles block in a migration, with its tag ("" when untagged). */
export function rolesBlocks(sql: string, file = ""): RolesBlock[] {
  const out: RolesBlock[] = [];
  for (const m of sql.matchAll(BLOCK_RE)) {
    out.push({ file, tag: (m[1] ?? "").trim(), body: m[2] });
  }
  return out;
}

/**
 * Remove roles blocks. `corpus`-tagged blocks always go; untagged blocks go
 * only in "strip" mode.
 */
export function stripRolesBlocks(sql: string, mode: RolesMode = "apply"): string {
  return sql.replace(BLOCK_RE, (whole, tag: string | undefined) => {
    const t = (tag ?? "").trim();
    if (t === "corpus" || mode === "strip") return "";
    return whole;
  });
}

/** The stub that stands in for Supabase Auth. */
export const AUTH_STUB_SQL = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
`;

export interface Row {
  [column: string]: unknown;
}

export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  exec(sql: string): Promise<unknown>;
}

export interface ProvisionedUser {
  userId: string;
  workspaceId: string;
  isNew: boolean;
}

export interface TestDb {
  pg: PGlite;
  /** Superuser query, first row (or undefined). */
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  /** Superuser query, all rows. */
  rows<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Superuser multi-statement exec. */
  exec(sql: string): Promise<void>;
  /** Insert an auth.users stub row and provision the user. */
  createUser(email: string, displayName?: string | null): Promise<ProvisionedUser>;
  /**
   * Run `fn` inside one transaction as the app role with app.user_id set
   * (null = anonymous). Throws propagate and roll the transaction back.
   */
  asUser<T>(userId: string | null, fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Apply every migration again (idempotency probe). */
  replayMigrations(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateTestDbOptions {
  roles?: RolesMode;
  migrationsDir?: string;
}

async function applyMigrations(pg: PGlite, mode: RolesMode, dir: string): Promise<void> {
  for (const file of listMigrationFiles(dir)) {
    const sql = stripRolesBlocks(readMigration(file, dir), mode);
    try {
      await pg.exec(sql);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`migration ${file} failed: ${message}`);
    }
  }
}

export async function createTestDb(opts: CreateTestDbOptions = {}): Promise<TestDb> {
  const mode: RolesMode = opts.roles ?? "apply";
  const dir = opts.migrationsDir ?? MIGRATIONS_DIR;
  const pg = new PGlite({ extensions: { citext, pgcrypto } });
  await pg.waitReady;
  await pg.exec(AUTH_STUB_SQL);
  if (mode === "strip") {
    await pg.exec(`create role ${APP_ROLE} nologin nobypassrls`);
  }
  await applyMigrations(pg, mode, dir);

  const db: TestDb = {
    pg,
    async one<T = Row>(sql: string, params?: unknown[]) {
      const r = await pg.query<T>(sql, params);
      return r.rows[0];
    },
    async rows<T = Row>(sql: string, params?: unknown[]) {
      const r = await pg.query<T>(sql, params);
      return r.rows;
    },
    async exec(sql: string) {
      await pg.exec(sql);
    },
    async createUser(email: string, displayName: string | null = null) {
      const auth = await pg.query<{ id: string }>(
        "insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id",
        [email],
      );
      const authId = auth.rows[0].id;
      const r = await pg.query<{ user_id: string; workspace_id: string; is_new: boolean }>(
        "select * from getfunded.provision_user($1, $2, $3)",
        [authId, email, displayName],
      );
      const row = r.rows[0];
      return { userId: row.user_id, workspaceId: row.workspace_id, isNew: row.is_new };
    },
    async asUser<T>(userId: string | null, fn: (tx: Queryable) => Promise<T>) {
      return pg.transaction(async (tx: Transaction) => {
        if (mode === "apply") {
          await tx.exec(`set local role ${APP_ROLE}`);
        }
        await tx.query("select set_config('app.user_id', $1, true)", [userId ?? ""]);
        return fn(tx);
      });
    },
    async replayMigrations() {
      await applyMigrations(pg, mode, dir);
    },
    async close() {
      await pg.close();
    },
  };
  return db;
}

/** Shape of a Postgres error as PGlite surfaces it. */
export interface PgError extends Error {
  code?: string;
  detail?: string;
  hint?: string;
}

/** Run `fn` and return the thrown Postgres error (fails if nothing throws). */
export async function expectPgError(fn: () => Promise<unknown>): Promise<PgError> {
  try {
    await fn();
  } catch (err) {
    return err as PgError;
  }
  throw new Error("expected the statement to fail, but it succeeded");
}
