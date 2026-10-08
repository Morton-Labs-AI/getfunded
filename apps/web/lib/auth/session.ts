import "server-only";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { hasSupabaseEnv } from "./env";
import { displayNameFromMetadata, isAdminEmail } from "./identity";
import { safeNextPath, signInPath } from "./next-path";
import { createSupabaseServerClient } from "./supabase";

/**
 * THE AUTH SEAM. Pages, layouts, route handlers and server actions call
 * `getSession()` / `requireUser()` and know nothing about Supabase.
 */

export type SessionUser = {
  /** `auth.users.id`, which is also `getfunded.users.id`. */
  id: string;
  email: string;
  displayName: string | null;
};

export type User = SessionUser;

export type Session = { user: SessionUser };

/** Set by proxy.ts so `requireUser()` can send the user back where they were. */
export const PATHNAME_HEADER = "x-gf-pathname";

/**
 * The verified identity for this request, or null.
 *
 * `getClaims()` verifies the JWT signature (locally against the project's
 * JWKS, or via the auth server for legacy HS256 projects) and refreshes an
 * expired access token. It never trusts the cookie's user object as-is.
 *
 * `cache()` is load-bearing: the layout, the page and every server action in
 * one render may each ask. Without it that is N verifications per request.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error || !data?.claims) return null;

    const { sub, email, user_metadata } = data.claims;
    if (typeof sub !== "string" || typeof email !== "string" || email.length === 0) return null;

    return {
      user: {
        id: sub,
        email: email.toLowerCase(),
        displayName: displayNameFromMetadata(user_metadata),
      },
    };
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[getSession]", error instanceof Error ? error.message : error);
    }
    return null;
  }
});

export async function getUserOrNull(): Promise<SessionUser | null> {
  return (await getSession())?.user ?? null;
}

/** The current path (`/app/saved?x=1`), as recorded by proxy.ts, or null. */
export async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get(PATHNAME_HEADER);
  } catch {
    return null;
  }
}

/**
 * The signed-in user, or a redirect to `/signin?next=<where they were>`.
 * `redirect()` throws, so the return type is honest: this never resolves
 * without a user.
 */
export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUserOrNull();
  if (user) return user;
  const target = safeNextPath(next ?? (await currentPath()));
  redirect(signInPath(target));
}

/** True when the signed-in user is listed in `ADMIN_EMAILS`. */
export async function isSteward(): Promise<boolean> {
  const user = await getUserOrNull();
  return user ? isAdminEmail(user.email) : false;
}

/**
 * The steward, or a redirect (not signed in) or a 404 (signed in but not a
 * steward). The 404 hides the admin surface instead of advertising it.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) notFound();
  return user;
}
