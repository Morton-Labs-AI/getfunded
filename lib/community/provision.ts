import "server-only";

import { communitySql } from "@/lib/community/db";

/**
 * First-sign-in provisioning: create the community.members row for a new
 * auth.users identity, record the address, and consume the invite.
 *
 * WHY HERE AND NOT A TRIGGER ON auth.users:
 *
 *  - A trigger failure aborts the SIGNUP transaction. Supabase returns
 *    "Database error saving new user" and login is dead for everyone. That
 *    couples login availability to a table Supabase owns and alters during
 *    platform upgrades — an unacceptable failure mode for zero benefit.
 *  - A trigger cannot produce a handle. Handles are user-chosen and unique, so
 *    onboarding has to write anyway; one write path beats two.
 *  - The migration would live in the other repo, invisible from here. That is
 *    the gap lib/admin/guard.ts exists to close: the guard lives next to the
 *    thing it protects so it cannot be reintroduced by forgetting.
 *
 * WHY NOT INSIDE getViewer(): a getViewer() that can write is a function forty
 * call sites invoke without knowing it mutates. Provisioning happens exactly
 * once, at the one moment we know the identity is new, in the one place that
 * already has a write context. getViewer() stays a pure read forever.
 */
export type Provisioned =
  | { ok: true; memberId: string; status: string; isNew: boolean }
  | { ok: false; reason: "not_invited" };

export async function ensureMember(
  authUserId: string,
  email: string
): Promise<Provisioned> {
  // ONE definer call, not a hand-rolled transaction. Provisioning inserts the
  // very row whose id an RLS policy would test against, so it cannot run under
  // policy; and doing it DB-side makes it atomic by construction — the app
  // cannot get the invite claim right and the member_private write wrong.
  //
  // Zero rows returned means the address is not invited. That is the function's
  // whole vocabulary for refusal, deliberately: it never explains, so nothing
  // downstream can turn the reason into an enumeration oracle.
  const rows = await communitySql<
    { member_id: string; status: string; is_new: boolean }[]
  >`select * from community.provision_member(${authUserId}::uuid, ${email})`;

  const row = rows[0];
  if (!row) return { ok: false, reason: "not_invited" };

  return {
    ok: true,
    memberId: row.member_id,
    status: row.status,
    isNew: row.is_new,
  };
}
