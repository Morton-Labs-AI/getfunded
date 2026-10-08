/**
 * Shared pieces of the public API v1 (Team and above). Pure; the routes wire
 * the real `requireApiKey` and `withRateLimit` in, tests pass fakes.
 *
 * Error shape, every status: `{ error: "<code>", message: "...", ...extra }`,
 * the same flat envelope lib/api/keys.ts (401/403) and lib/ratelimit.ts (429)
 * already use. No CORS headers on purpose: keys are for servers, not browsers.
 */
import type { ApiPrincipal, ApiScope, RequireApiKeyResult } from "@/lib/api/keys";
import { ipSubject, type RateLimitPreset } from "@/lib/ratelimit";
import { clientIp } from "@/lib/security";

/** 600 requests per minute per key, with the full minute available as a burst. */
export const API_V1_KEY_LIMIT: RateLimitPreset = { name: "api", capacity: 600, refillPerSec: 10 };

/**
 * The per-address bucket taken BEFORE the key is verified, so a client with no
 * key (or a guessed one) cannot hammer the `verify_api_key` door for free.
 * Deliberately wider than the per-key bucket: one busy server behind one
 * address with a valid key must never be throttled by it. Addresses that
 * cannot be read share the one `ip:unknown` bucket (see lib/security clientIp).
 */
export const API_V1_IP_LIMIT: RateLimitPreset = { name: "api_ip", capacity: 1200, refillPerSec: 20 };

/** Bucket subject for a key: `key:<key id>` → rate-limit key `key:<key id>:api`. */
export function keySubject(keyId: string): string {
  return `key:${keyId}`;
}

/** Bucket subject for the caller's address: `ip:<addr>` or `ip:unknown`, never null (no bypass). */
export function addressSubject(req: Request, env: Record<string, string | undefined> = process.env): string {
  return ipSubject(clientIp(req, env)) ?? "ip:unknown";
}

export const NO_STORE: Record<string, string> = { "Cache-Control": "no-store" };

export function v1Json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, { ...init, headers: { ...NO_STORE, ...(init.headers as Record<string, string> | undefined) } });
}

export function v1Error(status: number, code: string, message: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error: code, message, ...extra }, { status, headers: NO_STORE });
}

export type V1AuthDeps = {
  requireApiKey: (req: Request, opts?: { scope?: ApiScope }) => Promise<RequireApiKeyResult>;
  withRateLimit: (
    req: Request,
    preset: RateLimitPreset,
    keyFn: (req: Request) => string | null | undefined,
  ) => Promise<Response | null>;
  /** Environment for the proxy-trust decision in clientIp; tests pin it. */
  env?: Record<string, string | undefined>;
};

export type V1Auth = { ok: true; principal: ApiPrincipal } | { ok: false; response: Response };

/**
 * Per-address bucket (429) BEFORE the key is looked up, then the key check
 * (401/403 from lib/api/keys), then the per-key bucket (429). The address
 * bucket is what stops an unauthenticated client from costing a database
 * round trip per guess.
 */
export async function authenticateV1(req: Request, deps: V1AuthDeps, scope: ApiScope = "read"): Promise<V1Auth> {
  const env = deps.env ?? process.env;
  const addressLimited = await deps.withRateLimit(req, API_V1_IP_LIMIT, (r) => addressSubject(r, env));
  if (addressLimited) return { ok: false, response: addressLimited };
  const auth = await deps.requireApiKey(req, { scope });
  if (!auth.ok) return auth;
  const limited = await deps.withRateLimit(req, API_V1_KEY_LIMIT, () => keySubject(auth.principal.keyId));
  if (limited) return { ok: false, response: limited };
  return { ok: true, principal: auth.principal };
}

/** URLSearchParams → the `Record<string, string | string[]>` shape page search params use. */
export function searchParamsRecord(url: URL): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length === 1 ? all[0] : all;
  }
  return out;
}
