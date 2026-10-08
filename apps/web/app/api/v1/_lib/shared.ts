/**
 * Shared pieces of the public API v1 (Team and above). Pure; the routes wire
 * the real `requireApiKey` and `withRateLimit` in, tests pass fakes.
 *
 * Error shape, every status: `{ error: "<code>", message: "...", ...extra }`,
 * the same flat envelope lib/api/keys.ts (401/403) and lib/ratelimit.ts (429)
 * already use. No CORS headers on purpose: keys are for servers, not browsers.
 */
import type { ApiPrincipal, ApiScope, RequireApiKeyResult } from "@/lib/api/keys";
import type { RateLimitPreset } from "@/lib/ratelimit";

/** 600 requests per minute per key, with the full minute available as a burst. */
export const API_V1_KEY_LIMIT: RateLimitPreset = { name: "api", capacity: 600, refillPerSec: 10 };

/** Bucket subject for a key: `key:<key id>` → rate-limit key `key:<key id>:api`. */
export function keySubject(keyId: string): string {
  return `key:${keyId}`;
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
};

export type V1Auth = { ok: true; principal: ApiPrincipal } | { ok: false; response: Response };

/** Key check (401/403 from lib/api/keys) then the per-key bucket (429). */
export async function authenticateV1(req: Request, deps: V1AuthDeps, scope: ApiScope = "read"): Promise<V1Auth> {
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
