import "server-only";

import type postgres from "postgres";

import { corpus } from "./corpus";

/**
 * The workspace plane (`getfunded.*`) under Row Level Security.
 *
 * Every policy in schema `getfunded` reads the caller's identity from
 * `current_setting('app.user_id')` through `getfunded.current_user_id()`.
 * `withUser()` is therefore THE ONLY WAY to query `getfunded.*`: it opens a
 * transaction, sets `app.user_id` for that transaction only (`is_local = true`,
 * so it reverts on COMMIT or ROLLBACK and can never leak to the next request
 * that reuses the pooled connection), and runs `fn`.
 *
 * Fail-closed by construction: an anonymous caller passes null, which becomes
 * the empty string, which `current_user_id()` maps to NULL, which every policy
 * predicate rejects. A query that forgets this wrapper entirely runs with no
 * identity and returns ZERO ROWS, never another workspace's rows.
 */

/**
 * The app pool is the same pool as `corpus` (one `DATABASE_URL`, role
 * `getfunded_login`). Two names, one connection budget: the plane a query
 * touches is decided by the SQL and the grants, not by which pool ran it.
 */
export const appDb: postgres.Sql = corpus;

export type DbErrorCode = "conflict" | "quota_exceeded" | "forbidden" | "timeout" | "unknown";

type PgErrorLike = Error & {
  code: string;
  detail?: string;
  constraint_name?: string;
  table_name?: string;
};

function isPostgresError(error: unknown): error is PgErrorLike {
  return (
    error instanceof Error &&
    (error as { name?: string }).name === "PostgresError" &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

/** `raise exception 'quota_exceeded' using detail = '{"used":..}'` or `'quota_exceeded: {..}'`. */
function parseQuotaDetail(error: PgErrorLike): unknown {
  const candidates = [error.detail, error.message.replace(/^quota_exceeded[:\s]*/i, "")];
  for (const candidate of candidates) {
    if (!candidate || !candidate.trim().startsWith("{")) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/**
 * A Postgres failure translated into something a route can act on. Codes:
 *  - `conflict`        unique_violation (23505) — the row already exists
 *  - `quota_exceeded`  `reserve_credits()` refused; `.detail` is `{used, limit, period_end}`
 *  - `forbidden`       insufficient_privilege (42501) — RLS or a missing grant
 *  - `timeout`         query_canceled (57014) — the statement timeout fired
 *  - `unknown`         anything else; `.pgCode` carries the SQLSTATE
 */
export class DbError extends Error {
  readonly code: DbErrorCode;
  readonly pgCode: string | undefined;
  readonly detail: unknown;
  readonly constraint: string | undefined;

  constructor(
    code: DbErrorCode,
    message: string,
    options: { pgCode?: string; detail?: unknown; constraint?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DbError";
    this.code = code;
    this.pgCode = options.pgCode;
    this.detail = options.detail ?? null;
    this.constraint = options.constraint;
  }

  /** Map a thrown value. Non-Postgres errors are returned unchanged. */
  static from(error: unknown): unknown {
    if (error instanceof DbError) return error;
    if (!isPostgresError(error)) return error;
    return DbError.fromPostgres(error);
  }

  static fromPostgres(error: PgErrorLike): DbError {
    const base = { pgCode: error.code, constraint: error.constraint_name, cause: error };
    switch (error.code) {
      case "23505":
        return new DbError("conflict", "That record already exists.", base);
      case "42501":
        return new DbError("forbidden", "You do not have permission to do that.", base);
      case "57014":
        return new DbError("timeout", "The query took too long and was stopped.", base);
      case "P0001":
        if (/^quota_exceeded/i.test(error.message)) {
          return new DbError("quota_exceeded", "This workspace has used its AI credits for the period.", {
            ...base,
            detail: parseQuotaDetail(error),
          });
        }
        return new DbError("unknown", error.message, base);
      default:
        return new DbError("unknown", error.message, base);
    }
  }

  static is(error: unknown, code?: DbErrorCode): error is DbError {
    return error instanceof DbError && (code === undefined || error.code === code);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in a transaction with `app.user_id` set to the verified Supabase
 * Auth user id (or to the empty string for an anonymous caller). Postgres
 * errors are rethrown as `DbError`; everything else (including Next.js
 * `redirect()` control-flow errors) passes through untouched.
 */
export async function withUser<T>(
  userId: string | null,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  if (userId !== null && !UUID_RE.test(userId)) {
    throw new Error("withUser: userId must be a UUID or null.");
  }
  try {
    return (await appDb.begin(async (sql) => {
      await sql`select set_config('app.user_id', ${userId ?? ""}, true)`;
      return fn(sql);
    })) as T;
  } catch (error) {
    throw DbError.from(error);
  }
}
