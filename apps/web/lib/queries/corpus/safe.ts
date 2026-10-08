/**
 * Soft-fail for optional profile panels. A funder page must render when one
 * side query (similar funders, officers) fails or times out; the panel shows
 * "Not available" instead. The error is logged, never swallowed silently.
 */
export async function softFail<T>(what: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[corpus] ${what} unavailable:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: string | null | undefined): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Positive numerics only: a BMF zero means "nothing reported" far more often than a true zero. */
export function positive(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? String(v) : null;
}

export function toInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
