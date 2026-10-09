import { headers } from "next/headers";
import { notFound } from "next/navigation";

/**
 * The admin guard, in a module with NO database import and NO import-time
 * throw — so `app/admin/layout.tsx` can import it safely in any environment.
 *
 * lib/admin/db.ts throws when it loads outside an admin build. A layout that
 * imported it would 500 the whole /admin subtree (and surface an error page)
 * instead of quietly 404ing, so the page guard has to live apart from the
 * write pool it protects.
 *
 * WHY THIS EXISTS. The route wrapper in lib/admin/db.ts covers the six
 * /api/admin handlers, and it was assumed to cover the pages too. It does not:
 * app/admin/enrich/[id]/page.tsx is a force-dynamic Server Component that
 * reads through the UNGUARDED read-only pool (lib/db.ts) and renders
 * internal.org_web_facts — license `publisher_website`, republishable = false,
 * which migration 0012 states never surfaces publicly. Deployed as-is,
 * /admin/enrich/<any-org-uuid> served that on a public URL. The publishability
 * boundary was bypassed through React rather than SQL, so no boundary
 * assertion in export.py could see it.
 *
 * Applying this via a layout rather than per page is deliberate: every current
 * and future page under /admin inherits it by nesting, so the gap cannot be
 * reintroduced by forgetting.
 */

/**
 * Explicit opt-in, replacing the old `NODE_ENV !== "development"` test.
 *
 * Keying a security property to build mode meant the production branch could
 * not be exercised without a production build, so it was never tested. An
 * explicit flag is greppable, testable, and allows an admin-enabled build in a
 * protected staging environment without pretending to be a dev server.
 */
export function adminEnabled(): boolean {
  return process.env.ADMIN_ENABLED === "1";
}

function isLoopback(host: string, fwd: string | null): boolean {
  const localHost =
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]");
  // Next's dev server injects x-forwarded-for on every request, so require
  // loopback VALUES rather than absence.
  const loopbackFwd =
    !fwd ||
    fwd.split(",").every((ip) => {
      const t = ip.trim();
      return (
        t === "127.0.0.1" ||
        t === "::1" ||
        t === "::ffff:127.0.0.1" ||
        t === "localhost"
      );
    });
  return localHost && loopbackFwd;
}

/**
 * Server Component guard. 404s rather than 403s: an admin surface that is not
 * enabled should be indistinguishable from one that does not exist.
 */
export async function assertAdminPage(): Promise<void> {
  if (!adminEnabled()) notFound();
  const h = await headers();
  if (!isLoopback(h.get("host") ?? "", h.get("x-forwarded-for"))) notFound();
}

/** Request-scoped twin, for the /api/admin route wrapper. */
export function assertAdminRequest(req: Request): void {
  if (!adminEnabled()) {
    throw new Response("admin routes are not enabled", { status: 403 });
  }
  if (!isLoopback(req.headers.get("host") ?? "", req.headers.get("x-forwarded-for"))) {
    throw new Response("admin routes accept localhost requests only", { status: 403 });
  }
  // CSRF: with Host no longer the only gate, a cross-site form POST to a
  // localhost dev server would otherwise be accepted. Same-origin only.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new Response("cross-site admin requests are refused", { status: 403 });
  }
}
