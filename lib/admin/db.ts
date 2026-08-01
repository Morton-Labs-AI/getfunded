import postgres from "postgres";

/**
 * Write-capable connection for the LABELING UI ONLY. Everything else in the
 * app stays on the read-only funder_ro pool (lib/db.ts).
 *
 * Two hard locks, both required:
 *  1. This module throws at import time outside NODE_ENV=development —
 *     a production build cannot even load the write path.
 *  2. Every route additionally calls assertAdminRequest(), which refuses
 *     non-localhost hosts. This never ships to a deployed environment.
 */

if (process.env.NODE_ENV !== "development") {
  throw new Error("lib/admin/db.ts is development-only and must never load in production");
}

if (!process.env.ADMIN_DATABASE_URL) {
  throw new Error("ADMIN_DATABASE_URL is not set (direct-host URL; see .env.example)");
}

export const adminSql = postgres(process.env.ADMIN_DATABASE_URL, {
  max: 2,
  connection: { application_name: "ofdb-labeling-ui" },
});

export function assertAdminRequest(req: Request): void {
  if (process.env.NODE_ENV !== "development") {
    throw new Response("admin routes are development-only", { status: 403 });
  }
  const host = req.headers.get("host") ?? "";
  const isLocalHost =
    host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("[::1]");
  // Next's dev server injects x-forwarded-for on every request, so require
  // loopback VALUES rather than absence.
  const fwd = req.headers.get("x-forwarded-for");
  const isLoopbackFwd =
    !fwd || fwd.split(",").every((ip) => {
      const t = ip.trim();
      return t === "127.0.0.1" || t === "::1" || t === "::ffff:127.0.0.1" || t === "localhost";
    });
  if (!isLocalHost || !isLoopbackFwd) {
    throw new Response("admin routes accept localhost requests only", { status: 403 });
  }
}

/** Route-handler wrapper: guard, run, and turn guard failures into responses. */
export async function adminRoute(
  req: Request,
  fn: () => Promise<Response>
): Promise<Response> {
  try {
    assertAdminRequest(req);
    return await fn();
  } catch (e) {
    if (e instanceof Response) return e;
    const msg = e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
