import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * The Next.js 16 request proxy (the file formerly called middleware).
 *
 * Three jobs, no more:
 *  1. Refresh the Supabase session cookie before render. A Server Component
 *     cannot write cookies, so without this pass every user would be signed out
 *     an hour after signing in, with no error anywhere.
 *  2. Send unauthenticated requests under /app, /admin and /welcome to
 *     /signin?next=<where they were>. This is a convenience, NOT the security
 *     boundary: every protected page calls requireUser() / requireWorkspace()
 *     itself, and every server action checks again.
 *  3. Add security headers to every response it touches.
 *
 * No database import. A postgres.js import here would open a pool on every
 * matched request.
 */

const PROTECTED_PREFIXES = ["/app", "/admin", "/welcome"];

/** Recorded for lib/auth/session.ts so requireUser() can build `next=`. */
const PATHNAME_HEADER = "x-gf-pathname";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
};

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function withSecurityHeaders<T extends Response>(response: T): T {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const forwardHeaders = () => {
    const headers = new Headers(request.headers);
    headers.set(PATHNAME_HEADER, pathname + search);
    return headers;
  };

  let response = NextResponse.next({ request: { headers: forwardHeaders() } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let signedIn = false;
  if (supabaseUrl && supabaseKey) {
    const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, cacheHeaders) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request: { headers: forwardHeaders() } });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
          for (const [name, value] of Object.entries(cacheHeaders ?? {})) response.headers.set(name, value);
        },
      },
    });

    // getClaims() verifies the JWT and performs the refresh. The result is used
    // ONLY for the redirect below; authorization happens in the page.
    const { data } = await supabase.auth.getClaims();
    signedIn = typeof data?.claims?.sub === "string";
  }

  if (!signedIn && isProtected(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    url.searchParams.set("next", pathname + search);
    const redirect = NextResponse.redirect(url);
    // Keep any cookie the refresh pass just rotated (or cleared).
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    redirect.headers.set("Cache-Control", "private, no-store");
    return withSecurityHeaders(redirect);
  }

  return withSecurityHeaders(response);
}

export const config = {
  matcher: [
    /*
     * Everything except:
     *  - Next internals and static assets (nothing to refresh, no headers needed)
     *  - /api/webhooks/** (machine callers with their own signature checks)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|robots\\.txt|sitemap\\.xml|api/webhooks(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|otf|css|js|map|txt|xml|webmanifest)$).*)",
  ],
};
