import "server-only";

import type postgres from "postgres";

import { withUser } from "@/lib/db/app";

import type { WorkspaceCtx } from "./types";

/**
 * Small shared helpers for the workspace data modules.
 *
 * Every query in lib/workspace runs through `withUser(ctx.userId, …)`, which
 * sets `app.user_id` for Row Level Security, AND filters on
 * `workspace_id = ctx.workspaceId`. The two are redundant on purpose: RLS is
 * the security boundary, the explicit filter is what keeps a multi-workspace
 * user's reads scoped to the workspace they are looking at.
 */

export type Sql = postgres.TransactionSql;

export type Runner = <T>(userId: string | null, fn: (sql: Sql) => Promise<T>) => Promise<T>;

/** Injectable transaction runner, so unit tests can pass a fake. */
export type Deps = { withUser?: Runner };

export function runner(deps: Deps | undefined): Runner {
  return deps?.withUser ?? withUser;
}

export function run<T>(ctx: WorkspaceCtx, deps: Deps | undefined, fn: (sql: Sql) => Promise<T>): Promise<T> {
  return runner(deps)(ctx.userId, fn);
}

/** Postgres timestamps arrive as Date objects from postgres.js; dates as strings. Normalise to ISO/`YYYY-MM-DD`. */
export function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

export function ymd(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") return value.slice(0, 10);
  return null;
}

export function int(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = int(value, Number.NaN);
  return Number.isFinite(n) ? n : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** `jsonb` arrives parsed; guard anyway. */
export function obj(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return {};
}

/** Null-safe ILIKE pattern for a free-text search box. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
