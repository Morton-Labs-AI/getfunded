import "server-only";
/**
 * The one place the billing, metering, rate-limit and API-key layer touches
 * the app database. Everything under lib/billing, lib/api, lib/ratelimit.ts
 * and the billing/health routes imports `withUser` and `appDb` from here so
 * tests can swap the whole database with one `vi.mock("@/lib/billing/db")`.
 *
 * `withUser(userId, fn)` runs `fn` in a transaction with `app.user_id` set, so
 * Row Level Security applies, and rethrows Postgres failures as `DbError`.
 * `appDb` is the raw pool (no user): only for SECURITY DEFINER doors such as
 * `getfunded.take_token`, `getfunded.apply_subscription` and
 * `getfunded.verify_api_key`, and for the `select 1` health check.
 */
import type postgres from "postgres";

export { appDb, withUser } from "@/lib/db/app";

/** A tagged-template SQL runner: the pool or a transaction handle. */
export type Db = postgres.Sql | postgres.TransactionSql;
