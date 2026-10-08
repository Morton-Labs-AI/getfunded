import "server-only";
/**
 * The one place the outreach modules touch the app database, so a test can
 * swap the whole thing with `vi.mock("@/lib/outreach/db")`. Everything here
 * runs under `withUser()`: Row Level Security applies, and Postgres failures
 * come back as `DbError`.
 */
import type postgres from "postgres";

export { DbError, withUser } from "@/lib/db/app";

export type Tx = postgres.TransactionSql;

/** Who is acting and in which workspace. Every server module takes one. */
export type Ctx = { userId: string; workspaceId: string };

/** Postgres timestamps arrive as Date objects or strings; normalise to ISO strings for the UI. */
export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function str(value: unknown): string | null {
  return typeof value === "string" ? value : value === null || value === undefined ? null : String(value);
}
