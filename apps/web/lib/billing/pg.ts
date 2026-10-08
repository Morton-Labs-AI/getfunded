/**
 * Small pure helpers for values that come back from postgres.js. Kept apart
 * from ./db so tests can mock the database seam without re-implementing them.
 */

type ErrorLike = { code?: unknown; cause?: unknown };

/** The Postgres SQLSTATE of an error, looking through wrapper errors' `cause`. */
export function pgErrorCode(err: unknown): string | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const e = cur as ErrorLike;
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    cur = e.cause;
  }
  return null;
}

/** Postgres returns bigint/numeric as strings; turn a ledger id or count into a safe integer. */
export function toInt(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : fallback;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : fallback;
  }
  return fallback;
}
