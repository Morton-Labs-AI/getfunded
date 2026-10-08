import "server-only";
/**
 * Settings data access. Every function takes the `sql` handle of an open
 * `withUser()` transaction, so Row Level Security applies and tests can pass
 * the fake from tests/unit/billing/fake-sql.ts.
 *
 * Authorization is checked twice on purpose: here, through
 * `getfunded.is_admin()` in SQL, and again by the RLS policies on the rows.
 * The rules the database does not know (an owner cannot be removed, seats
 * follow the plan) live in ./roles.ts and are applied here before any write.
 */
import { generateApiKey, type ApiScope } from "@/lib/api/keys";
import type { Db } from "@/lib/billing/db";
import { loadWorkspacePlan, type WorkspacePlan } from "@/lib/billing/meter";
import { toInt } from "@/lib/billing/pg";
import { can } from "@/lib/plans";
import type { WorkspaceProfile } from "@/lib/workspace/context";
import {
  EXPORT_ROW_CAP,
  buildWorkspaceExport,
  type ExportActivity,
  type ExportMember,
  type ExportSavedFunder,
  type ExportStageHistory,
  type ExportTask,
  type ExportWorkspace,
  type WorkspaceExport,
} from "./export";
import { generateInviteToken, inviteExpiry, type GeneratedInviteToken, type InvitePreview, type InviteRole } from "./invites";
import { canRemoveMember, isMemberRole, seatCheck, type MemberRole } from "./roles";

type Env = Record<string, string | undefined>;

export type SettingsErrorCode =
  | "forbidden"
  | "stale"
  | "not_found"
  | "seat_limit"
  | "plan_required"
  | "owner_protected"
  | "self_remove"
  | "already_member"
  | "invalid";

export class SettingsError extends Error {
  readonly code: SettingsErrorCode;
  constructor(code: SettingsErrorCode, message: string) {
    super(message);
    this.name = "SettingsError";
    this.code = code;
  }
  static is(error: unknown, code?: SettingsErrorCode): error is SettingsError {
    return error instanceof SettingsError && (code === undefined || error.code === code);
  }
}

/** `getfunded.is_admin(ws)` for the transaction's user, or a `forbidden` SettingsError. */
export async function assertAdmin(sql: Db, workspaceId: string): Promise<void> {
  const rows = await sql`select getfunded.is_admin(${workspaceId}::uuid) as ok`;
  if (!rows[0]?.ok) throw new SettingsError("forbidden", "Only a workspace owner or admin can do that.");
}

export async function isAdmin(sql: Db, workspaceId: string): Promise<boolean> {
  const rows = await sql`select getfunded.is_admin(${workspaceId}::uuid) as ok`;
  return Boolean(rows[0]?.ok);
}

/* ----------------------------------------------------------------------------
   Members and invites
---------------------------------------------------------------------------- */

export type MemberRow = {
  user_id: string;
  role: MemberRole;
  email: string | null;
  display_name: string | null;
  last_seen_at: Date | null;
  joined_at: Date;
};

export async function listMembers(sql: Db, workspaceId: string): Promise<MemberRow[]> {
  const rows = await sql`
    select m.user_id, m.role, m.created_at as joined_at, u.email, u.display_name, u.last_seen_at
    from getfunded.members m
    left join getfunded.users u on u.id = m.user_id
    where m.workspace_id = ${workspaceId}::uuid
    order by (m.role = 'owner') desc, (m.role = 'admin') desc, m.created_at asc`;
  return rows.map((r) => ({
    user_id: String(r.user_id),
    role: isMemberRole(r.role) ? r.role : "member",
    email: r.email ? String(r.email) : null,
    display_name: r.display_name ? String(r.display_name) : null,
    last_seen_at: r.last_seen_at ? new Date(r.last_seen_at as string) : null,
    joined_at: new Date(r.joined_at as string),
  }));
}

export type InviteRow = {
  id: string;
  email: string;
  role: InviteRole;
  expires_at: Date;
  created_at: Date;
  invited_by: string | null;
};

/** Pending invites (not accepted, not expired). Admin-only by RLS: a member sees none. */
export async function listInvites(sql: Db, workspaceId: string): Promise<InviteRow[]> {
  const rows = await sql`
    select id, email, role, expires_at, created_at, invited_by
    from getfunded.invites
    where workspace_id = ${workspaceId}::uuid
      and accepted_at is null
      and expires_at > now()
    order by created_at desc`;
  return rows.map((r) => ({
    id: String(r.id),
    email: String(r.email),
    role: r.role === "admin" ? "admin" : "member",
    expires_at: new Date(r.expires_at as string),
    created_at: new Date(r.created_at as string),
    invited_by: r.invited_by ? String(r.invited_by) : null,
  }));
}

export type SeatSummary = ReturnType<typeof seatCheck> & { planName: string; planId: string };

export async function seatSummary(sql: Db, workspaceId: string, env: Env = process.env): Promise<SeatSummary> {
  const { plan } = await loadWorkspacePlan(sql, workspaceId, env);
  const members = await sql`select count(*)::int as n from getfunded.members where workspace_id = ${workspaceId}::uuid`;
  const invites = await sql`
    select count(*)::int as n from getfunded.invites
    where workspace_id = ${workspaceId}::uuid and accepted_at is null and expires_at > now()`;
  return {
    ...seatCheck({ limit: plan.members, members: toInt(members[0]?.n, 0), pendingInvites: toInt(invites[0]?.n, 0) }),
    planName: plan.name,
    planId: plan.id,
  };
}

export type CreatedInvite = { id: string; token: string; email: string; role: InviteRole; expiresAt: Date };

/**
 * Write an invite row. Replaces any pending invite for the same email, refuses
 * an address that already belongs to a member, and counts seats on the plan.
 */
export async function createInvite(
  sql: Db,
  input: { workspaceId: string; email: string; role: InviteRole; invitedBy: string },
  deps: { token?: GeneratedInviteToken; now?: Date; env?: Env } = {},
): Promise<CreatedInvite> {
  await assertAdmin(sql, input.workspaceId);
  const email = input.email.trim().toLowerCase();

  const existing = await sql`
    select 1 from getfunded.members m
    join getfunded.users u on u.id = m.user_id
    where m.workspace_id = ${input.workspaceId}::uuid and u.email = ${email}::citext
    limit 1`;
  if (existing.length > 0) throw new SettingsError("already_member", "That person is already a member of this workspace.");

  await sql`
    delete from getfunded.invites
    where workspace_id = ${input.workspaceId}::uuid and email = ${email}::citext and accepted_at is null`;

  const seats = await seatSummary(sql, input.workspaceId, deps.env);
  if (seats.full) {
    throw new SettingsError(
      "seat_limit",
      seats.limit === 1
        ? `The ${seats.planName} plan has one seat. Upgrade to invite people.`
        : `The ${seats.planName} plan has ${seats.limit} seats and they are all taken. Upgrade to invite more people.`,
    );
  }

  const token = deps.token ?? generateInviteToken();
  const expiresAt = inviteExpiry(deps.now ?? new Date());
  const rows = await sql`
    insert into getfunded.invites (workspace_id, email, role, token_hash, expires_at, invited_by)
    values (${input.workspaceId}::uuid, ${email}::citext, ${input.role}, ${token.hash}, ${expiresAt.toISOString()}::timestamptz, ${input.invitedBy}::uuid)
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new SettingsError("invalid", "The invitation could not be created.");
  return { id: String(id), token: token.token, email, role: input.role, expiresAt };
}

export async function revokeInvite(sql: Db, input: { workspaceId: string; inviteId: string }): Promise<boolean> {
  await assertAdmin(sql, input.workspaceId);
  const rows = await sql`
    delete from getfunded.invites
    where id = ${input.inviteId}::uuid and workspace_id = ${input.workspaceId}::uuid and accepted_at is null
    returning id`;
  return rows.length > 0;
}

/** Remove someone else. The owner is protected; "remove yourself" is `leaveWorkspace`. */
export async function removeMember(
  sql: Db,
  input: { workspaceId: string; actorId: string; actorRole: string; targetId: string },
): Promise<boolean> {
  await assertAdmin(sql, input.workspaceId);
  const target = await sql`
    select role from getfunded.members where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.targetId}::uuid`;
  if (target.length === 0) throw new SettingsError("not_found", "That person is not a member of this workspace.");
  const decision = canRemoveMember({
    actorRole: input.actorRole,
    actorId: input.actorId,
    targetRole: String(target[0].role),
    targetId: input.targetId,
  });
  if (!decision.ok) {
    const code: SettingsErrorCode = decision.reason.includes("owner") ? "owner_protected" : decision.reason.includes("yourself") ? "self_remove" : "forbidden";
    throw new SettingsError(code, decision.reason);
  }
  const rows = await sql`
    delete from getfunded.members
    where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.targetId}::uuid and role <> 'owner'
    returning user_id`;
  return rows.length > 0;
}

export async function leaveWorkspace(sql: Db, input: { workspaceId: string; userId: string }): Promise<boolean> {
  const me = await sql`
    select role from getfunded.members where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.userId}::uuid`;
  if (me.length === 0) throw new SettingsError("not_found", "You are not a member of this workspace.");
  if (me[0].role === "owner") {
    throw new SettingsError("owner_protected", "The owner cannot leave. Delete the workspace instead, or ask us to transfer ownership.");
  }
  const rows = await sql`
    delete from getfunded.members
    where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.userId}::uuid and role <> 'owner'
    returning user_id`;
  return rows.length > 0;
}

/** `getfunded.accept_invite(token)` → the workspace joined. Errors are mapped by the caller. */
export async function acceptInvite(sql: Db, token: string): Promise<string> {
  const rows = await sql`select getfunded.accept_invite(${token}) as workspace_id`;
  const id = rows[0]?.workspace_id;
  if (!id) throw new SettingsError("invalid", "The invitation could not be accepted.");
  return String(id);
}

/**
 * `getfunded.invite_preview(token)` (migration 0011): the invited address,
 * workspace name, role and status for the signed-in holder of a link, or null
 * for an unknown token. Lets /invite/<token> say which account must accept.
 */
export async function invitePreview(sql: Db, token: string): Promise<InvitePreview | null> {
  const rows = await sql`select email, workspace_name, role, status from getfunded.invite_preview(${token})`;
  const r = rows[0];
  if (!r) return null;
  const status = String(r.status);
  return {
    email: String(r.email),
    workspaceName: String(r.workspace_name ?? ""),
    role: r.role === "admin" ? "admin" : "member",
    status: status === "used" ? "accepted" : status === "expired" ? "expired" : "pending",
  };
}

/* ----------------------------------------------------------------------------
   Organization
---------------------------------------------------------------------------- */

/** CAS update of name and profile. Returns the new version, or null when the row moved on. */
export async function updateOrganization(
  sql: Db,
  input: { workspaceId: string; version: number; name: string; profile: WorkspaceProfile },
): Promise<number | null> {
  await assertAdmin(sql, input.workspaceId);
  const rows = await sql`
    update getfunded.workspaces
    set name = ${input.name}, profile = ${JSON.stringify(input.profile)}::jsonb, version = version + 1
    where id = ${input.workspaceId}::uuid and version = ${input.version} and deleted_at is null
    returning version`;
  return rows.length > 0 ? toInt(rows[0].version, input.version + 1) : null;
}

/** Team and above may switch the daily soft cap off. CAS on version. */
export async function setDailyCap(
  sql: Db,
  input: { workspaceId: string; version: number; enabled: boolean },
  env: Env = process.env,
): Promise<number | null> {
  await assertAdmin(sql, input.workspaceId);
  const { plan } = await loadWorkspacePlan(sql, input.workspaceId, env);
  if (!plan.can_disable_daily_cap && !input.enabled) {
    throw new SettingsError("plan_required", "Turning the daily cap off is included in the Team plan and above.");
  }
  const rows = await sql`
    update getfunded.workspaces
    set settings = coalesce(settings, '{}'::jsonb) || ${JSON.stringify({ daily_cap_enabled: input.enabled })}::jsonb,
        version = version + 1
    where id = ${input.workspaceId}::uuid and version = ${input.version} and deleted_at is null
    returning version`;
  return rows.length > 0 ? toInt(rows[0].version, input.version + 1) : null;
}

/** Soft delete: `deleted_at = now()`. Every query in the app filters on it. */
export async function softDeleteWorkspace(sql: Db, input: { workspaceId: string; version: number }): Promise<boolean> {
  await assertAdmin(sql, input.workspaceId);
  const rows = await sql`
    update getfunded.workspaces
    set deleted_at = now(), version = version + 1
    where id = ${input.workspaceId}::uuid and version = ${input.version} and deleted_at is null
    returning id`;
  return rows.length > 0;
}

/* ----------------------------------------------------------------------------
   Billing read models
---------------------------------------------------------------------------- */

export type SubscriptionRow = {
  plan: string;
  status: "trialing" | "active" | "past_due" | "canceled" | "unpaid";
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
  stripe_subscription_id: string | null;
};

export async function getSubscription(sql: Db, workspaceId: string): Promise<SubscriptionRow | null> {
  const rows = await sql`
    select plan, status, current_period_start, current_period_end, cancel_at_period_end, stripe_subscription_id
    from getfunded.subscriptions where workspace_id = ${workspaceId}::uuid`;
  const r = rows[0];
  if (!r) return null;
  const status = String(r.status);
  return {
    plan: String(r.plan),
    status: (["trialing", "active", "past_due", "canceled", "unpaid"].includes(status) ? status : "unpaid") as SubscriptionRow["status"],
    current_period_start: r.current_period_start ? new Date(r.current_period_start as string) : null,
    current_period_end: r.current_period_end ? new Date(r.current_period_end as string) : null,
    cancel_at_period_end: Boolean(r.cancel_at_period_end),
    stripe_subscription_id: r.stripe_subscription_id ? String(r.stripe_subscription_id) : null,
  };
}

export async function hasBillingAccount(sql: Db, workspaceId: string): Promise<boolean> {
  const rows = await sql`select stripe_customer_id from getfunded.workspaces where id = ${workspaceId}::uuid`;
  return Boolean(rows[0]?.stripe_customer_id);
}

export { loadWorkspacePlan };
export type { WorkspacePlan };

/* ----------------------------------------------------------------------------
   API keys (Team and above; admins only by RLS)
---------------------------------------------------------------------------- */

export type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiScope[];
  created_by: string | null;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
};

export async function listApiKeys(sql: Db, workspaceId: string): Promise<ApiKeyRow[]> {
  const rows = await sql`
    select id, name, key_prefix, scopes, created_by, created_at, last_used_at, revoked_at
    from getfunded.api_keys
    where workspace_id = ${workspaceId}::uuid
    order by (revoked_at is null) desc, created_at desc`;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ""),
    key_prefix: String(r.key_prefix ?? ""),
    scopes: (Array.isArray(r.scopes) ? r.scopes : ["read"]).filter((s): s is ApiScope => s === "read" || s === "write"),
    created_by: r.created_by ? String(r.created_by) : null,
    created_at: new Date(r.created_at as string),
    last_used_at: r.last_used_at ? new Date(r.last_used_at as string) : null,
    revoked_at: r.revoked_at ? new Date(r.revoked_at as string) : null,
  }));
}

export type CreatedApiKey = { id: string; plaintext: string; prefix: string; name: string; scopes: ApiScope[] };

export async function createApiKey(
  sql: Db,
  input: { workspaceId: string; name: string; scopes: ApiScope[]; createdBy: string },
  deps: { env?: Env; generate?: () => ReturnType<typeof generateApiKey> } = {},
): Promise<CreatedApiKey> {
  await assertAdmin(sql, input.workspaceId);
  const { plan } = await loadWorkspacePlan(sql, input.workspaceId, deps.env ?? process.env);
  if (!can(plan, "api")) throw new SettingsError("plan_required", "API access is included in the Team plan and above.");
  const key = (deps.generate ?? generateApiKey)();
  const scopes = input.scopes.length > 0 ? input.scopes : (["read"] as ApiScope[]);
  const rows = await sql`
    insert into getfunded.api_keys (workspace_id, name, key_prefix, key_hash, scopes, created_by)
    values (${input.workspaceId}::uuid, ${input.name}, ${key.prefix}, ${key.hash}, ${scopes}::text[], ${input.createdBy}::uuid)
    returning id`;
  const id = rows[0]?.id;
  if (!id) throw new SettingsError("invalid", "The key could not be created.");
  return { id: String(id), plaintext: key.plaintext, prefix: key.prefix, name: input.name, scopes };
}

export async function revokeApiKey(sql: Db, input: { workspaceId: string; keyId: string }): Promise<boolean> {
  await assertAdmin(sql, input.workspaceId);
  const rows = await sql`
    update getfunded.api_keys
    set revoked_at = now(), version = version + 1
    where id = ${input.keyId}::uuid and workspace_id = ${input.workspaceId}::uuid and revoked_at is null
    returning id`;
  return rows.length > 0;
}

/* ----------------------------------------------------------------------------
   Integrations read model
---------------------------------------------------------------------------- */

export type IntegrationStatus = {
  /** Steward flag `ai_enabled` in getfunded.flags; null when the row is absent. */
  aiFlagEnabled: boolean | null;
  /** Gmail sender identities connected by the current user in this workspace. */
  gmailConnected: number;
};

export async function getIntegrationStatus(sql: Db, workspaceId: string, userId: string): Promise<IntegrationStatus> {
  const flags = await sql`select value from getfunded.flags where key = 'ai_enabled'`;
  let aiFlagEnabled: boolean | null = null;
  if (flags.length > 0) {
    const v = flags[0].value;
    aiFlagEnabled = !(v === false || v === "false" || v === 0 || (v && typeof v === "object" && (v as { enabled?: unknown }).enabled === false));
  }
  let gmailConnected = 0;
  try {
    const rows = await sql`
      select count(*)::int as n from getfunded.sender_identities
      where workspace_id = ${workspaceId}::uuid and user_id = ${userId}::uuid and status = 'connected'`;
    gmailConnected = toInt(rows[0]?.n, 0);
  } catch {
    gmailConnected = 0;
  }
  return { aiFlagEnabled, gmailConnected };
}

/* ----------------------------------------------------------------------------
   Export
---------------------------------------------------------------------------- */

async function capped<T>(rows: unknown[], label: string, truncated: string[]): Promise<T[]> {
  if (rows.length > EXPORT_ROW_CAP) {
    truncated.push(label);
    return rows.slice(0, EXPORT_ROW_CAP) as T[];
  }
  return rows as T[];
}

/** Everything the workspace owns, under RLS, shaped for the archive. */
export async function loadWorkspaceExport(
  sql: Db,
  input: { workspaceId: string; exportedBy: { user_id: string; email: string }; now?: Date },
): Promise<WorkspaceExport> {
  await assertAdmin(sql, input.workspaceId);
  const ws = await sql`
    select id, slug, name, plan, profile, settings, created_at
    from getfunded.workspaces where id = ${input.workspaceId}::uuid and deleted_at is null`;
  if (ws.length === 0) throw new SettingsError("not_found", "This workspace was not found.");
  const workspace = ws[0] as unknown as ExportWorkspace;
  const limit = EXPORT_ROW_CAP + 1;
  const truncated: string[] = [];

  const memberRows = await sql`
    select m.user_id, m.role, m.created_at as joined_at, u.email, u.display_name
    from getfunded.members m left join getfunded.users u on u.id = m.user_id
    where m.workspace_id = ${input.workspaceId}::uuid order by m.created_at asc`;
  const funderRows = await sql`
    select id, org_id, snapshot, stage, tier, owner_id, ask_amount, next_action, next_action_due,
           source_detail, tags, archived_at, created_at, updated_at
    from getfunded.saved_funders where workspace_id = ${input.workspaceId}::uuid
    order by created_at asc limit ${limit}`;
  const taskRows = await sql`
    select id, saved_funder_id, title, details, due_date, assignee_id, status, completed_at, created_by, created_at, updated_at
    from getfunded.tasks where workspace_id = ${input.workspaceId}::uuid
    order by created_at asc limit ${limit}`;
  const activityRows = await sql`
    select id, saved_funder_id, kind, body, occurred_at, created_by, meta, created_at
    from getfunded.activities where workspace_id = ${input.workspaceId}::uuid
    order by occurred_at asc limit ${limit}`;
  const historyRows = await sql`
    select id, saved_funder_id, from_stage, to_stage, changed_by, note, created_at
    from getfunded.stage_history where workspace_id = ${input.workspaceId}::uuid
    order by created_at asc limit ${limit}`;

  return buildWorkspaceExport({
    workspace,
    members: memberRows.map((m) => ({
      user_id: String(m.user_id),
      role: String(m.role),
      email: m.email ? String(m.email) : null,
      display_name: m.display_name ? String(m.display_name) : null,
      joined_at: m.joined_at as string,
    })) satisfies ExportMember[],
    saved_funders: await capped<ExportSavedFunder>(funderRows, "saved_funders", truncated),
    tasks: await capped<ExportTask>(taskRows, "tasks", truncated),
    activities: await capped<ExportActivity>(activityRows, "activities", truncated),
    stage_history: await capped<ExportStageHistory>(historyRows, "stage_history", truncated),
    exported_by: input.exportedBy,
    exported_at: input.now ?? new Date(),
    truncated,
  });
}
