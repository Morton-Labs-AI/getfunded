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
  /**
   * Per server instance. A funder page runs about ten corpus reads in
   * parallel; more sockets than this per instance only moves the queue from
   * here to the pooler.
   */
  max: 5,
  /** Seconds. Close an idle socket quickly so a quiet instance holds nothing. */
  idle_timeout: 10,
  connect_timeout: 10,
  /** Seconds. Recycle sockets well inside the pooler's own limits. */
  max_lifetime: 60 * 5,
  /** The Supabase pooler does not support named prepared statements. */
  prepare: false,
} as const;

/** Supavisor, the Supabase shared pooler: aws-0-<region>.pooler.supabase.com. */
const SUPAVISOR_HOST = /\.pooler\.supabase\.com$/i;
const SUPAVISOR_SESSION_PORT = "5432";
const SUPAVISOR_TRANSACTION_PORT = "6543";

export type PoolMode = "transaction" | "session" | "direct";

/**
 * The connection string the app actually dials, and the pooler mode it lands in.
 *
 * Serverless instances must use Supavisor's TRANSACTION mode (port 6543). In
 * SESSION mode (port 5432) every open socket holds one of the pooler's
 * `pool_size` server connections for as long as the socket lives, so a few
 * warm instances fill the pool and every other request fails with
 * "max clients reached in session mode" (the getfunded.ai outage of
 * 2026-10-13). In transaction mode a server connection is held only for the
 * length of one transaction, so many instances share the same pool.
 *
 * The app needs nothing that transaction mode takes away: every
 * `set_config(..., true)` and `set local` is transaction-scoped, prepared
 * statements are off, and nothing in lib/ uses LISTEN, advisory locks or
 * temporary tables. (scripts/db-migrate.mjs does take an advisory lock; it
 * reads MIGRATE_DATABASE_URL and never passes through here.)
 *
 * So a Supavisor URL on the session port is moved to the transaction port.
 * Same host, same user, same password; only the port changes, so no secret
 * has to be edited. `DATABASE_POOL_MODE=session` keeps the URL as given (an
 * escape hatch, not a recommendation). Any other host is left alone.
 */
export function resolvePoolUrl(
  url: string,
  modeOverride: string | undefined = envUrl("DATABASE_POOL_MODE"),
): { url: string; mode: PoolMode } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, mode: "direct" };
  }
  if (!SUPAVISOR_HOST.test(parsed.hostname)) return { url, mode: "direct" };
  const port = parsed.port || SUPAVISOR_SESSION_PORT;
  if (port === SUPAVISOR_TRANSACTION_PORT) return { url, mode: "transaction" };
  if (port !== SUPAVISOR_SESSION_PORT || modeOverride?.toLowerCase() === "session") return { url, mode: "session" };
  parsed.port = SUPAVISOR_TRANSACTION_PORT;
  return { url: parsed.toString(), mode: "transaction" };
}

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
      "DATABASE_URL is not set. It must be the Supabase pooler URL for the " +
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
export const corpus: postgres.Sql = lazyPool("app", () => {
  const { url } = resolvePoolUrl(requireDatabaseUrl());
  return postgres(url, {
    ...POOL_OPTIONS,
    connection: { application_name: "getfunded-web" },
  });
});

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
  ? lazyPool("analyst", () => {
      const { url, mode } = resolvePoolUrl(envUrl("ANALYST_DATABASE_URL") as string);
      return postgres(url, {
        ...POOL_OPTIONS,
        // In transaction mode a server connection is shared, so session
        // startup settings cannot be relied on. They are not needed: funder_ro
        // carries default_transaction_read_only and statement_timeout as role
        // settings (getfunded_0010), and lib/ai/ask.ts runs every query in
        // BEGIN READ ONLY with its own `set local statement_timeout`.
        connection:
          mode === "transaction"
            ? { application_name: "getfunded-analyst" }
            : { application_name: "getfunded-analyst", default_transaction_read_only: true, statement_timeout: 15_000 },
      });
    })
  : null;
