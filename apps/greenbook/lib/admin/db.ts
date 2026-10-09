import postgres from "postgres";

import { adminEnabled, assertAdminRequest } from "./guard";

/**
 * Write-capable connection for the ADMIN SURFACE ONLY. Everything else in the
 * app stays on the read-only funder_ro pool (lib/db.ts).
 *
 * Three hard locks, all required:
 *  1. The pool is constructed lazily and refuses to build unless
 *     ADMIN_ENABLED=1, so no credential is read on a normal deployment.
 *  2. Every route calls assertAdminRequest(), which refuses non-localhost
 *     hosts and cross-site POSTs (lib/admin/guard.ts).
 *  3. Every PAGE under /admin inherits assertAdminPage() via
 *     app/admin/layout.tsx. The guard lives in ./guard so the layout can
 *     import it without pulling in this module's pool.
 *
 * ADMIN_DATABASE_URL must NOT be a superuser. It was `postgres.<ref>` — the
 * Supabase superuser, DDL rights over all 27.8GB — for flows that write five
 * tables and need no DDL at all. Use funder_rw (migration 0022).
 */

type AdminSql = ReturnType<typeof postgres>;

let pool: AdminSql | null = null;

/**
 * The pool is built on FIRST USE, not at import.
 *
 * This module used to throw while loading. That looked like a strong lock but
 * it made the app impossible to build at all: `next build` collects page data
 * for the six /api/admin route modules, each imports this file, and the throw
 * aborted the build — under the old NODE_ENV test just as surely as under
 * ADMIN_ENABLED, since a production build sets NODE_ENV=production. An app
 * that cannot be built cannot be deployed, and "safe because it does not
 * compile" stops being true the moment somebody relaxes the check to ship.
 *
 * Deferring construction keeps the guarantee where it belongs: no pool is ever
 * constructed, and no credential is ever read, unless a guarded caller
 * actually reaches for the database.
 */
function realSql(): AdminSql {
  if (!adminEnabled()) {
    throw new Error("admin surface is not enabled (ADMIN_ENABLED=1 required)");
  }
  if (!process.env.ADMIN_DATABASE_URL) {
    throw new Error("ADMIN_DATABASE_URL is not set (direct-host URL; see .env.example)");
  }
  pool ??= postgres(process.env.ADMIN_DATABASE_URL, {
    max: 2,
    connection: { application_name: "ofdb-labeling-ui" },
  });
  return pool;
}

/**
 * Proxy so callers keep using `adminSql` as a value — tagged templates,
 * `.begin()`, `.json()` — with construction deferred to the first touch.
 */
export const adminSql = new Proxy(function () {} as unknown as AdminSql, {
  apply(_target, thisArg, args) {
    const s = realSql() as unknown as (...a: unknown[]) => unknown;
    return Reflect.apply(s, thisArg, args);
  },
  get(_target, prop) {
    const s = realSql() as unknown as Record<string | symbol, unknown>;
    const v = s[prop];
    return typeof v === "function"
      ? (v as (...a: unknown[]) => unknown).bind(s)
      : v;
  },
});

export { assertAdminRequest };

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
