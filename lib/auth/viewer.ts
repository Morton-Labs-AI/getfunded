import { cache } from "react";

import { communitySql } from "@/lib/community/db";
import { supabaseAuthUser } from "@/lib/supabase/server";

/**
 * THE AUTH SEAM. One file. Everything else calls getViewer/requireViewer and
 * knows nothing about Supabase.
 *
 * This is dnw-funder-intelligence/lib/auth/acting-user.ts's shape, and that
 * file's own comment predicted this moment: "Adding Supabase Auth later = swap
 * the internals of this one function to read the session and map auth_user_id
 * -> users.id. Nothing else changes." That is exactly what happened; the seam
 * held. Keep it that way — no route, page or action may read a cookie itself.
 *
 * NOTE WHAT IS NOT ON Viewer: the email address. The session already has it
 * (supabaseAuthUser), and anything that genuinely needs it asks by name via
 * viewerEmail(). Keeping it off the type means a Viewer can be handed toward a
 * client component without leaking an address — a whole class of mistake that
 * simply cannot be made here.
 */
export type MemberStatus = "invited" | "active" | "suspended" | "banned" | "deleted";

export type Viewer = {
  memberId: string;
  authUserId: string;
  /** null until onboarding calls community.activate_member(). */
  handle: string | null;
  displayName: string | null;
  roles: string[];
  status: MemberStatus;
  role: "member" | "maintainer";
  trustTier: number;
};

type ViewerRow = {
  id: string;
  auth_user_id: string;
  handle: string | null;
  display_name: string | null;
  roles: string[];
  status: MemberStatus;
  role: "member" | "maintainer";
  trust_tier: number;
};

/**
 * React.cache() is load-bearing, not an optimization: Nav(), the page body and
 * every Server Action in one render may each call getViewer(). Without it that
 * is N JWT verifications and N round trips per request.
 *
 * Returns null for "not signed in" AND for "signed in but not provisioned" —
 * the latter only happens if the callback route failed midway, and treating it
 * as signed-out is the safe reading.
 *
 * A suspended or banned member IS returned, deliberately. They are signed in;
 * they simply cannot act. Hiding that behind a null would render a sign-in
 * button to someone already holding a session, which is a confusing lie.
 * requireActiveViewer() is what gates every write.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const authUser = await supabaseAuthUser();
  if (!authUser) return null;

  try {
    // Through the SECURITY DEFINER function, NOT a direct select. This is
    // forced by RLS (community_0005): we are looking a member up BY
    // auth_user_id, which is precisely the moment before app.member_id can be
    // known, so a direct read would be filtered to zero rows and sign-in would
    // break for everyone. The function takes an auth.users id the caller has
    // already proven by verifying a JWT, and returns profile fields only.
    const rows = await communitySql<ViewerRow[]>`
      select * from community.member_by_auth_user(${authUser.id}::uuid)`;

    const r = rows[0];
    if (!r) return null;

    return {
      memberId: r.id,
      authUserId: r.auth_user_id,
      handle: r.handle,
      displayName: r.display_name,
      roles: r.roles ?? [],
      status: r.status,
      role: r.role,
      trustTier: r.trust_tier,
    };
  } catch (e) {
    // The community schema may not exist yet on a given deployment, and a
    // signed-out corpus reader must never see a 500 because of it. Soft-fail
    // to "no viewer" — every community surface then renders as signed out.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[getViewer]", e instanceof Error ? e.message : e);
    }
    return null;
  }
});

/** The address, asked for by name. Never put this on Viewer. */
export async function viewerEmail(): Promise<string | null> {
  return (await supabaseAuthUser())?.email ?? null;
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new Error("Sign in to continue.");
  return v;
}

/** The gate on every write. Onboarding is the only thing an invited member may do. */
export async function requireActiveViewer(): Promise<Viewer> {
  const v = await requireViewer();
  if (v.status === "invited") throw new Error("Finish setting up your profile first.");
  if (v.status !== "active") throw new Error("Your account is not active.");
  return v;
}

export async function requireMaintainer(): Promise<Viewer> {
  const v = await requireActiveViewer();
  if (v.role !== "maintainer") throw new Error("Maintainers only.");
  return v;
}

/**
 * The serializable subset safe to hand a client component. Note it cannot
 * carry an email because Viewer has none — that is the point.
 */
export type ViewerChip = {
  handle: string | null;
  displayName: string | null;
  initials: string;
  status: MemberStatus;
  isMaintainer: boolean;
};

export function toChip(v: Viewer, fallback?: string | null): ViewerChip {
  // A member provisioned seconds ago has neither a display name nor a handle
  // (both arrive at onboarding), so the caller may pass the address to derive a
  // monogram from. Only the INITIALS cross to the client, never the address.
  const source = (v.displayName ?? v.handle ?? fallback?.split("@")[0] ?? "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
      : source.slice(0, 2).toUpperCase();

  return {
    handle: v.handle,
    displayName: v.displayName,
    initials: initials || "?",
    status: v.status,
    isMaintainer: v.role === "maintainer",
  };
}
