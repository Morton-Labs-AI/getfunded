import "server-only";

/**
 * Search rate limiting, the same policy for the page and the JSON API:
 * signed in → USER_SEARCH per user; signed out → ANON_SEARCH per IP.
 * The session is READ (getSession), never required: search needs no account.
 */
import { headers } from "next/headers";

import { getSession } from "@/lib/auth/session";
import { ANON_SEARCH, USER_SEARCH, ipSubject, limit, rateLimitKey, userSubject, withRateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/security";

export type SearchLimit = { ok: true; subject: "user" | "ip" } | { ok: false; retryAfterSec: number; subject: "user" | "ip" };

/**
 * The anonymous bucket subject. A request whose address cannot be read
 * (`clientIp` → "unknown": no trusted proxy headers) is NOT let through; every
 * such request shares the one `ip:unknown` bucket. Sharing is the safe
 * direction: an attacker who strips the headers gets 30/min in total, not
 * unlimited. Operators behind their own proxy set TRUST_PROXY (see .env.example).
 */
export function anonSearchSubject(req: Request): string {
  return ipSubject(clientIp(req)) ?? "ip:unknown";
}

/** For Server Components: reads the request headers itself. */
export async function limitSearchRender(): Promise<SearchLimit> {
  const session = await getSession();
  if (session) {
    const key = rateLimitKey(USER_SEARCH, userSubject(session.user.id) as string);
    const r = await limit(key, USER_SEARCH);
    return r.ok ? { ok: true, subject: "user" } : { ok: false, retryAfterSec: r.retryAfterSec ?? 1, subject: "user" };
  }
  const h = await headers();
  const subject = anonSearchSubject(new Request("http://search.local/", { headers: h }));
  const r = await limit(rateLimitKey(ANON_SEARCH, subject), ANON_SEARCH);
  return r.ok ? { ok: true, subject: "ip" } : { ok: false, retryAfterSec: r.retryAfterSec ?? 2, subject: "ip" };
}

/** For Route Handlers: null to proceed, or a ready 429 Response. */
export async function limitSearchRequest(req: Request): Promise<Response | null> {
  const session = await getSession();
  if (session) return withRateLimit(req, USER_SEARCH, () => userSubject(session.user.id));
  return withRateLimit(req, ANON_SEARCH, anonSearchSubject);
}
