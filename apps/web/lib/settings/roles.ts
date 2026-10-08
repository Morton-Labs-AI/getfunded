/**
 * Who may do what in a workspace. Pure, so every rule has a unit test.
 *
 * These mirror the Row Level Security policies in
 * migrations/getfunded_0002_accounts.sql (admins manage members, invites and
 * API keys; only admins update the workspace row) and add the product rules
 * the database does not know about: an owner cannot be removed or leave, a
 * person cannot remove themself through "remove" (they "leave"), only the
 * owner may delete the workspace, and seats are counted against the plan.
 */
import { PLANS, isPlanId, type PlanFeature, type PlanId } from "@/lib/plans";

export const MEMBER_ROLES = ["owner", "admin", "member"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  owner: "Created the workspace. Can do everything, including delete it.",
  admin: "Can change the organization profile, invite and remove people, manage billing and API keys.",
  member: "Can search, save funders, run AI analysis and work the pipeline.",
};

export function isMemberRole(value: unknown): value is MemberRole {
  return typeof value === "string" && (MEMBER_ROLES as readonly string[]).includes(value);
}

/** Owners and admins. Matches `getfunded.is_admin()`. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export const canEditOrganization = isAdminRole;
export const canInvite = isAdminRole;
export const canManageBilling = isAdminRole;
export const canManageApiKeys = isAdminRole;
export const canExportWorkspace = isAdminRole;

export function canDeleteWorkspace(role: string | null | undefined): boolean {
  return role === "owner";
}

/** Owners cannot leave; someone else must own the workspace first. */
export function canLeave(role: string | null | undefined): boolean {
  return role === "admin" || role === "member";
}

/** Roles an inviter may hand out. `getfunded.invites.role` allows admin and member only. */
export function assignableInviteRoles(role: string | null | undefined): ("member" | "admin")[] {
  return isAdminRole(role) ? ["member", "admin"] : [];
}

export type RemoveDecision = { ok: true } | { ok: false; reason: string };

export function canRemoveMember(input: {
  actorRole: string | null | undefined;
  actorId: string;
  targetRole: string | null | undefined;
  targetId: string;
}): RemoveDecision {
  if (!isAdminRole(input.actorRole)) return { ok: false, reason: "Only a workspace owner or admin can remove people." };
  if (input.actorId === input.targetId) return { ok: false, reason: "To remove yourself, use Leave workspace." };
  if (input.targetRole === "owner") return { ok: false, reason: "The owner cannot be removed." };
  return { ok: true };
}

export type SeatCheck = {
  limit: number | null;
  used: number;
  remaining: number | null;
  full: boolean;
};

/**
 * Seats on a plan. Pending invitations count as taken so a workspace cannot
 * outrun its plan by inviting first and accepting later. `limit` null means
 * unlimited.
 */
export function seatCheck(input: { limit: number | null; members: number; pendingInvites: number }): SeatCheck {
  const used = Math.max(0, input.members) + Math.max(0, input.pendingInvites);
  if (input.limit === null || !Number.isFinite(input.limit)) {
    return { limit: null, used, remaining: null, full: false };
  }
  const limit = Math.max(0, Math.floor(input.limit));
  return { limit, used, remaining: Math.max(0, limit - used), full: used >= limit };
}

/** The cheapest public plan that includes a feature, or null when none does. */
export function lowestPlanWith(feature: PlanFeature): PlanId | null {
  const order: PlanId[] = ["free", "starter", "pro", "team", "enterprise"];
  for (const id of order) {
    if (PLANS[id].features[feature]) return id;
  }
  return null;
}

/** The cheapest public plan whose seat count is at least `seats`, or null. */
export function lowestPlanWithSeats(seats: number): PlanId | null {
  const order: PlanId[] = ["free", "starter", "pro", "team", "enterprise"];
  for (const id of order) {
    const m = PLANS[id].members;
    if (m === null || m >= seats) return id;
  }
  return null;
}

/** Normalise a stored plan value for display. */
export function planIdOf(value: unknown): PlanId {
  return isPlanId(value) ? value : "free";
}
