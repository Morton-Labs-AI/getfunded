import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { ensureProvisioned } from "@/lib/auth/provision";
import { getUserOrNull, requireUser, type SessionUser } from "@/lib/auth/session";
import { withUser } from "@/lib/db/app";
import { jsonError } from "@/lib/security";

import { resolveSteward, type StewardSession } from "./steward";

export type { StewardSession } from "./steward";

/**
 * THE STEWARD GATE. Every /admin page, every admin server action and every
 * /api/admin route goes through one of these three:
 *
 *   requireSteward()   pages: redirect to sign-in when signed out, 404 when
 *                      signed in but not a steward (the admin surface is hidden,
 *                      not advertised)
 *   stewardOrNull()    server actions and route handlers: null instead of a throw
 *   requireStewardApi() route handlers: a ready 404 Response for non-stewards
 *
 * Steward = `users.is_steward` OR email in ADMIN_EMAILS (lib/admin/steward.ts).
 */

async function readFlag(userId: string): Promise<boolean | null> {
  return withUser(userId, async (sql) => {
    const rows = await sql<{ is_steward: boolean }[]>`
      select is_steward from getfunded.users where id = ${userId}::uuid`;
    return rows[0] ? rows[0].is_steward === true : null;
  });
}

async function claim(userId: string, emails: string[]): Promise<boolean> {
  return withUser(userId, async (sql) => {
    const rows = await sql<{ ok: boolean }[]>`select getfunded.claim_steward(${emails}::text[]) as ok`;
    return rows[0]?.ok === true;
  });
}

const resolveForUser = cache(async (user: SessionUser): Promise<StewardSession | null> => {
  // The users row is born in provision_user(); a steward who has never opened
  // /app would otherwise have no row for the flag to live on.
  try {
    await ensureProvisioned(user);
  } catch {
    /* the flag read below answers null and the email list still decides */
  }
  return resolveSteward(user, { readFlag, claim });
});

/** The steward session, or null when signed out or not a steward. Never throws. */
export const stewardOrNull = cache(async (): Promise<StewardSession | null> => {
  const user = await getUserOrNull();
  if (!user) return null;
  return resolveForUser(user);
});

/** For pages and layouts under /admin. */
export const requireSteward = cache(async (): Promise<StewardSession> => {
  const user = await requireUser();
  const session = await resolveForUser(user);
  if (!session) notFound();
  return session;
});

export type RequireStewardApiResult = { ok: true; session: StewardSession } | { ok: false; response: Response };

/** For /api/admin route handlers: 404 (not 401/403) hides the surface. */
export async function requireStewardApi(): Promise<RequireStewardApiResult> {
  const session = await stewardOrNull();
  if (!session) return { ok: false, response: jsonError(404, "not_found", "Not found.") };
  return { ok: true, session };
}
