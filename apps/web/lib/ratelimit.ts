import "server-only";
/**
 * Token-bucket rate limiting in Postgres (`getfunded.rate_limits`), through the
 * SECURITY DEFINER door `getfunded.take_token(key, capacity, refill_per_sec)`.
 * Anonymous search: 30 requests per minute per IP. Signed-in search: 120 per
 * minute per user. Keys look like `ip:1.2.3.4:search` or `user:<uuid>:search`.
 */
import { z } from "zod";
import { appDb, type Db } from "@/lib/billing/db";

export type RateLimitPreset = {
  /** Suffix of the bucket key, so one subject can have several independent buckets. */
  name: string;
  /** Bucket size = burst allowance. */
  capacity: number;
  /** Sustained rate. 30/min = 0.5 per second. */
  refillPerSec: number;
};

export const ANON_SEARCH: RateLimitPreset = { name: "search", capacity: 30, refillPerSec: 30 / 60 };
export const USER_SEARCH: RateLimitPreset = { name: "search", capacity: 120, refillPerSec: 120 / 60 };
/** Public API keys: 60 requests per minute per key. */
export const API_KEY_REQUESTS: RateLimitPreset = { name: "api", capacity: 60, refillPerSec: 1 };

const LimitInput = z.object({
  key: z.string().min(1).max(256),
  capacity: z.number().positive().max(1_000_000),
  refillPerSec: z.number().positive().max(1_000_000),
});

export type RateLimitResult = { ok: boolean; retryAfterSec?: number };

export type RateLimitDeps = {
  sql?: Db;
  /** When the database is unreachable, allow the request (default) instead of failing it. */
  failOpen?: boolean;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

/** Take one token from the bucket `key`. */
export async function limit(
  key: string,
  opts: { capacity: number; refillPerSec: number },
  deps: RateLimitDeps = {},
): Promise<RateLimitResult> {
  const input = LimitInput.parse({ key, capacity: opts.capacity, refillPerSec: opts.refillPerSec });
  const sql = deps.sql ?? appDb;
  try {
    const rows = await sql`
      select getfunded.take_token(${input.key}, ${input.capacity}, ${input.refillPerSec}) as ok`;
    if (rows[0]?.ok === true) return { ok: true };
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(1 / input.refillPerSec)) };
  } catch (err) {
    (deps.log ?? ((m, e) => console.error(`[ratelimit] ${m}`, e ?? {})))("take_token failed", {
      key: input.key,
      error: err instanceof Error ? err.message : String(err),
    });
    if (deps.failOpen ?? true) return { ok: true };
    throw err;
  }
}

/** `ip:1.2.3.4` + preset `search` → `ip:1.2.3.4:search`. */
export function rateLimitKey(preset: RateLimitPreset, subject: string): string {
  return `${subject}:${preset.name}`;
}

export function ipSubject(ip: string | null | undefined): string | null {
  const v = ip?.trim();
  return v ? `ip:${v}` : null;
}

export function userSubject(userId: string | null | undefined): string | null {
  return userId ? `user:${userId}` : null;
}

/** The 429 response: JSON body plus `Retry-After` in seconds. */
export function tooManyRequests(retryAfterSec: number): Response {
  const secs = Math.max(1, Math.ceil(retryAfterSec));
  return Response.json(
    {
      error: "rate_limited",
      message: `Too many requests. Try again in ${secs} second${secs === 1 ? "" : "s"}.`,
      retryAfterSec: secs,
    },
    { status: 429, headers: { "Retry-After": String(secs), "Cache-Control": "no-store" } },
  );
}

export type KeyFn = (req: Request) => string | null | undefined | Promise<string | null | undefined>;

/**
 * Route-handler helper. Returns `null` when the request may proceed, or a
 * ready-made 429 `Response` when the bucket is empty. `keyFn` names the
 * subject (`ipSubject(clientIp(req))`, `userSubject(user.id)`); when it returns
 * null the request cannot be attributed and is allowed through.
 */
export async function withRateLimit(
  req: Request,
  preset: RateLimitPreset,
  keyFn: KeyFn,
  deps: RateLimitDeps = {},
): Promise<Response | null> {
  const subject = await keyFn(req);
  if (!subject) return null;
  const result = await limit(rateLimitKey(preset, subject), preset, deps);
  return result.ok ? null : tooManyRequests(result.retryAfterSec ?? 1);
}
