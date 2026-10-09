import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * SESSION REFRESH ONLY. This file exists for exactly one reason and must never
 * grow a second one.
 *
 * Supabase refresh tokens rotate. A Server Component cannot persist a rotated
 * cookie (next/headers cookies() is read-only during render), so without a
 * refresh pass BEFORE render, every member is silently signed out when their
 * access token expires — one hour after signing in, with no error anywhere.
 * That is the whole job.
 *
 * TWO RULES, BOTH NON-NEGOTIABLE:
 *
 * 1. NO AUTHORIZATION HERE. Not a redirect-if-signed-out, not a role check,
 *    nothing. Proxy-based authorization is what CVE-2025-29927 was, and Next
 *    16.2.9 shipped a further App-Router-on-Turbopack proxy bypass
 *    (GHSA-6gpp-xcg3-4w24) — this repo uses Turbopack, which is why the
 *    framework was moved to 16.3.4. Even fully patched, a bypassable layer
 *    must not be the only thing standing between a stranger and a page. Every
 *    protected page calls requireViewer() itself, and every Server Action
 *    calls it again. The proxy refreshes; the seam authorizes.
 *
 * 2. NO DATABASE IMPORT. Cookies only. A postgres.js import here would open a
 *    pool on every request to every matched route, including static assets.
 *
 * FILENAME: `proxy`, not `middleware`. Next 16 deprecates the middleware file
 * convention (PROXY_FILENAME = 'proxy' in next/dist/lib/constants.js).
 */
export async function proxy(request: NextRequest) {
  // Nothing to refresh when the community layer is off. Cheapest possible exit.
  if (process.env.COMMUNITY_MODE !== "invite" && process.env.COMMUNITY_MODE !== "open") {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // getUser(), not getSession(): this call is what actually performs the
  // refresh and revalidates the JWT. Its RESULT IS DELIBERATELY DISCARDED —
  // see rule 1. If you ever find yourself wanting to branch on it here, the
  // branch belongs in the page.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *   _next/static, _next/image, favicon, image files — no session to refresh
     *   api/chat   — an SSE stream; no proxy hop on a streaming response
     *   api/admin  — guarded by loopback + ADMIN_ENABLED (lib/admin/guard.ts).
     *                That surface predates auth and must stay untouched by it.
     */
    "/((?!_next/static|_next/image|favicon.ico|api/chat|api/admin|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
