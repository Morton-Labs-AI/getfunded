import "server-only";

import postgres from "postgres";

/**
 * Database pools for the web app.
 *
 * ONE Postgres, two planes (docs/ARCHITECTURE.md):
 *  - the corpus plane (`internal.*`, `public.*` views) is READ ONLY to the app,
 *    enforced by the grants on `getfunded_app`, not by anything in this file;
 *  - the workspace plane (`getfunded.*`) is written through `withUser()` in
 *    lib/db/app.ts, which sets `app.user_id` for Row Level Security.
 *
 * Both planes are reached through the same `DATABASE_URL` pool (role
 * `getfunded_login`, which inherits `getfunded_app`). `corpusQuery()` adds a
 * read-only transaction and a statement timeout on top, so a hand-written
 * corpus query can never write by accident and can never run away.
 *
 * `analyst` is a SECOND pool, on `ANALYST_DATABASE_URL` (role `funder_ro`). It
 * exists for exactly one caller: the "Ask the analyst" feature, which runs SQL
 * written by a language model. That role is read-only at the role level with a
 * 15 s statement timeout, and holds nothing in `getfunded.*`, so model-written
 * SQL cannot reach workspace data even in principle.
 *
 * Pools are created on FIRST USE, never at import time. Importing this module
 * in a unit test, during `next build` prerendering, or from a route that ends
 * up not touching the database reads no environment and opens no sockets.
 */

const POOL_OPTIONS = {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  /** The Supabase pooler does not support named prepared statements. */
  prepare: false,
} as const;

const globalForDb = globalThis as unknown as {
  __getfundedPools?: Map<string, postgres.Sql>;
};

function envUrl(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** The app connection string, or a sentence an operator can act on. */
export function requireDatabaseUrl(): string {
  const url = envUrl("DATABASE_URL");
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. It must be the Supabase session-pooler URL for the " +
        "getfunded_login role (see apps/web/.env.example).",
    );
  }
  return url;
}

/**
 * A `postgres.Sql` that materialises the real pool on first call or property
 * read. The Proxy forwards tagged-template calls (sql`...`), and property reads
 * (sql.begin, sql.unsafe, sql.json, sql.end) to the real pool. In development
 * the real pool is cached on globalThis so Fast Refresh does not leak
 * connections; in production the module-level variable is enough.
 */
function lazyPool(key: string, create: () => postgres.Sql): postgres.Sql {
  let pool: postgres.Sql | undefined;

  const resolve = (): postgres.Sql => {
    if (pool) return pool;
    const cache = (globalForDb.__getfundedPools ??= new Map());
    const resolved = cache.get(key) ?? create();
    if (process.env.NODE_ENV !== "production") cache.set(key, resolved);
    pool = resolved;
    return resolved;
  };

  const target = function lazySql() {} as unknown as postgres.Sql;
  return new Proxy(target, {
    apply(_target, _thisArg, args: unknown[]) {
      return Reflect.apply(resolve() as unknown as (...a: unknown[]) => unknown, undefined, args);
    },
    get(_target, prop) {
      const real = resolve();
      const value = Reflect.get(real, prop) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(real) : value;
    },
  });
}

/**
 * The app pool: role `getfunded_login` (inherits `getfunded_app`). SELECT and
 * EXECUTE on the corpus plane, DML on `getfunded.*` under RLS.
 */
export const corpus: postgres.Sql = lazyPool("app", () =>
  postgres(requireDatabaseUrl(), {
    ...POOL_OPTIONS,
    connection: { application_name: "getfunded-web" },
  }),
);

/**
 * Run `fn` inside `BEGIN READ ONLY` with a 15 s statement timeout. Use this
 * for every hand-written corpus query. The read-only mode is a belt on top of
 * the role grants (the braces); the timeout protects the pool from a slow
 * trigram or vector query.
 */
export async function corpusQuery<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return corpus.begin("read only", async (sql) => {
    await sql.unsafe("set local statement_timeout = '15s'");
    return fn(sql);
  }) as Promise<T>;
}

/** True when the analyst connection (`funder_ro`) is configured. */
export const analystEnabled: boolean = Boolean(envUrl("ANALYST_DATABASE_URL"));

/**
 * The analyst pool: role `funder_ro`, read-only at the role level. Null when
 * `ANALYST_DATABASE_URL` is unset, in which case "Ask the analyst" must refuse
 * with a clear notice rather than fall back to the app pool.
 */
export const analyst: postgres.Sql | null = analystEnabled
  ? lazyPool("analyst", () =>
      postgres(envUrl("ANALYST_DATABASE_URL") as string, {
        ...POOL_OPTIONS,
        connection: {
          application_name: "getfunded-analyst",
          default_transaction_read_only: true,
          statement_timeout: 15_000,
        },
      }),
    )
  : null;
