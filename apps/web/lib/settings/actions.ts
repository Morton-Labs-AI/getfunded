"use server";

/**
 * Settings Server Actions. Each one: parse with zod, re-check the signed-in
 * user and their role, do the write inside `withUser()` (RLS + `is_admin()` in
 * SQL), then `refresh()` so the page shows the change in the same roundtrip.
 *
 * Next.js already refuses cross-origin POSTs to Server Actions (Origin vs
 * Host), so there is no `assertSameOrigin` here; the JSON routes under
 * app/api/invites and app/api/keys do that check themselves.
 */
import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { appUrl } from "@/lib/auth/env";
import { DbError, withUser } from "@/lib/db/app";
import { WORKSPACE_COOKIE, requireWorkspace, setActiveWorkspace, type WorkspaceProfile } from "@/lib/workspace/context";
import { ACCEPT_INVITE_COPY, acceptInviteFailure, inviteUrl, parseInviteToken } from "./invites";
import { canDeleteWorkspace, canLeave, canManageApiKeys, isAdminRole } from "./roles";
import {
  PROFILE_KEYS,
  apiKeyCreateSchema,
  apiKeyRevokeSchema,
  dailyCapSchema,
  deleteWorkspaceSchema,
  fieldErrorsOf,
  formToRecord,
  inviteCreateSchema,
  inviteRevokeSchema,
  memberRemoveSchema,
  organizationFormSchema,
  type OrganizationForm,
} from "./schemas";
import { SettingsError, type CreatedApiKey } from "./service";
import * as svc from "./service";

export type ActionState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
  message?: string;
};

export type InviteState = ActionState & {
  invite?: { id: string; email: string; role: "member" | "admin"; url: string; expiresAt: string };
};

export type ApiKeyState = ActionState & {
  key?: Omit<CreatedApiKey, "id"> & { id: string };
};

const GENERIC = "Something went wrong. Try again in a moment.";

function failure(error: unknown, log: string): ActionState {
  if (SettingsError.is(error)) return { ok: false, error: error.message };
  if (DbError.is(error, "forbidden")) return { ok: false, error: "You do not have permission to do that." };
  if (DbError.is(error, "conflict")) return { ok: false, error: "That already exists." };
  console.error(`[settings] ${log}`, error instanceof Error ? error.message : error);
  return { ok: false, error: GENERIC };
}

/** APP_URL, or the origin this request arrived on (preview deploys, local dev). */
async function requestOrigin(): Promise<string> {
  const configured = appUrl();
  if (configured) return configured;
  try {
    const h = await headers();
    const origin = h.get("origin");
    if (origin) return origin;
    const host = h.get("x-forwarded-host") ?? h.get("host");
    const proto = h.get("x-forwarded-proto") ?? "https";
    return host ? `${proto}://${host}` : "";
  } catch {
    return "";
  }
}

/** Merge the form into the stored profile; a cleared field removes its key. */
function mergeProfile(existing: WorkspaceProfile, form: OrganizationForm): WorkspaceProfile {
  const next: Record<string, unknown> = { ...existing };
  const values: Record<(typeof PROFILE_KEYS)[number], unknown> = {
    mission: form.mission,
    ein: form.ein,
    website: form.website,
    state: form.state,
    counties: form.counties,
    program_areas: form.program_areas,
    annual_budget: form.annual_budget,
    populations_served: form.populations_served,
    keywords: form.keywords,
  };
  for (const key of PROFILE_KEYS) {
    const value = values[key];
    const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
    else next[key] = value;
  }
  return next as WorkspaceProfile;
}

/* ----------------------------------------------------------------------------
   Organization
---------------------------------------------------------------------------- */

export async function updateOrganizationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = organizationFormSchema.safeParse(formToRecord(formData));
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const form = parsed.data;
  const { user, workspace } = await requireWorkspace();
  if (workspace.id !== form.workspace_id) {
    return { ok: false, error: "This form belongs to a different workspace. Reload the page and try again." };
  }
  if (!isAdminRole(workspace.role)) {
    return { ok: false, error: "Only a workspace owner or admin can change the organization profile." };
  }
  const profile = mergeProfile(workspace.profile, form);
  try {
    const version = await withUser(user.id, (sql) =>
      svc.updateOrganization(sql, { workspaceId: workspace.id, version: form.version, name: form.name, profile }),
    );
    if (version === null) {
      return { ok: false, error: "This profile was changed somewhere else. Reload the page and try again." };
    }
  } catch (error) {
    return failure(error, "updateOrganization");
  }
  refresh();
  return { ok: true, message: "Saved." };
}

/* ----------------------------------------------------------------------------
   Members and invites
---------------------------------------------------------------------------- */

export async function createInviteAction(_prev: InviteState, formData: FormData): Promise<InviteState> {
  const parsed = inviteCreateSchema.safeParse(formToRecord(formData));
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { user, workspace } = await requireWorkspace();
  if (!isAdminRole(workspace.role)) return { ok: false, error: "Only a workspace owner or admin can invite people." };
  try {
    const created = await withUser(user.id, (sql) =>
      svc.createInvite(sql, { workspaceId: workspace.id, email: parsed.data.email, role: parsed.data.role, invitedBy: user.id }),
    );
    const url = inviteUrl(await requestOrigin(), created.token);
    refresh();
    return {
      ok: true,
      message: "Invitation created. Copy the link and send it yourself.",
      invite: { id: created.id, email: created.email, role: created.role, url, expiresAt: created.expiresAt.toISOString() },
    };
  } catch (error) {
    return failure(error, "createInvite");
  }
}

export async function revokeInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = inviteRevokeSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return { ok: false, error: "That invitation id is not valid." };
  const { user, workspace } = await requireWorkspace();
  if (!isAdminRole(workspace.role)) return { ok: false, error: "Only a workspace owner or admin can revoke invitations." };
  try {
    const done = await withUser(user.id, (sql) => svc.revokeInvite(sql, { workspaceId: workspace.id, inviteId: parsed.data.invite_id }));
    if (!done) return { ok: false, error: "That invitation was already used or revoked." };
  } catch (error) {
    return failure(error, "revokeInvite");
  }
  refresh();
  return { ok: true, message: "Invitation revoked." };
}

export async function removeMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = memberRemoveSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return { ok: false, error: "That member id is not valid." };
  const { user, workspace } = await requireWorkspace();
  try {
    const done = await withUser(user.id, (sql) =>
      svc.removeMember(sql, { workspaceId: workspace.id, actorId: user.id, actorRole: workspace.role, targetId: parsed.data.user_id }),
    );
    if (!done) return { ok: false, error: "That person is no longer a member." };
  } catch (error) {
    return failure(error, "removeMember");
  }
  refresh();
  return { ok: true, message: "Removed from the workspace." };
}

/** useActionState form action; it needs neither the previous state nor the form data. */
export async function leaveWorkspaceAction(): Promise<ActionState> {
  const { user, workspace } = await requireWorkspace();
  if (!canLeave(workspace.role)) {
    return { ok: false, error: "The owner cannot leave. Delete the workspace instead, or ask us to transfer ownership." };
  }
  try {
    const done = await withUser(user.id, (sql) => svc.leaveWorkspace(sql, { workspaceId: workspace.id, userId: user.id }));
    if (!done) return { ok: false, error: "You are no longer a member of this workspace." };
  } catch (error) {
    return failure(error, "leaveWorkspace");
  }
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);
  redirect("/app");
}

export async function acceptInviteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const token = parseInviteToken(formToRecord(formData).token);
  if (!token) return { ok: false, error: ACCEPT_INVITE_COPY.invalid };
  const { user } = await requireWorkspace();
  let workspaceId: string;
  try {
    workspaceId = await withUser(user.id, (sql) => svc.acceptInvite(sql, token));
  } catch (error) {
    const reason = acceptInviteFailure(error);
    if (reason === "unknown") console.error("[settings] acceptInvite", error instanceof Error ? error.message : error);
    return { ok: false, error: ACCEPT_INVITE_COPY[reason] };
  }
  const switched = await setActiveWorkspace(workspaceId);
  if (!switched.ok) return { ok: false, error: switched.error };
  redirect("/app");
}

/* ----------------------------------------------------------------------------
   Billing settings
---------------------------------------------------------------------------- */

export async function setDailyCapAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = dailyCapSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return { ok: false, error: "That request was not valid. Reload the page and try again." };
  const { user, workspace } = await requireWorkspace();
  if (workspace.id !== parsed.data.workspace_id) return { ok: false, error: "This form belongs to a different workspace." };
  if (!isAdminRole(workspace.role)) return { ok: false, error: "Only a workspace owner or admin can change this." };
  try {
    const version = await withUser(user.id, (sql) =>
      svc.setDailyCap(sql, { workspaceId: workspace.id, version: parsed.data.version, enabled: parsed.data.daily_cap_enabled }),
    );
    if (version === null) return { ok: false, error: "Settings changed somewhere else. Reload the page and try again." };
  } catch (error) {
    return failure(error, "setDailyCap");
  }
  refresh();
  return { ok: true, message: parsed.data.daily_cap_enabled ? "Daily cap on." : "Daily cap off." };
}

/* ----------------------------------------------------------------------------
   API keys
---------------------------------------------------------------------------- */

export async function createApiKeyAction(_prev: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const raw = formToRecord(formData);
  const scopes = formData.getAll("scopes").filter((v): v is string => typeof v === "string");
  const parsed = apiKeyCreateSchema.safeParse({ name: raw.name ?? "", scopes: scopes.length > 0 ? scopes : ["read"] });
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const { user, workspace } = await requireWorkspace();
  if (!canManageApiKeys(workspace.role)) return { ok: false, error: "Only a workspace owner or admin can create API keys." };
  try {
    const key = await withUser(user.id, (sql) =>
      svc.createApiKey(sql, { workspaceId: workspace.id, name: parsed.data.name, scopes: parsed.data.scopes, createdBy: user.id }),
    );
    refresh();
    return { ok: true, message: "Key created. Copy it now; it will not be shown again.", key };
  } catch (error) {
    return failure(error, "createApiKey");
  }
}

export async function revokeApiKeyAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = apiKeyRevokeSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return { ok: false, error: "That key id is not valid." };
  const { user, workspace } = await requireWorkspace();
  if (!canManageApiKeys(workspace.role)) return { ok: false, error: "Only a workspace owner or admin can revoke API keys." };
  try {
    const done = await withUser(user.id, (sql) => svc.revokeApiKey(sql, { workspaceId: workspace.id, keyId: parsed.data.key_id }));
    if (!done) return { ok: false, error: "That key was already revoked." };
  } catch (error) {
    return failure(error, "revokeApiKey");
  }
  refresh();
  return { ok: true, message: "Key revoked. Requests with it stop working now." };
}

/* ----------------------------------------------------------------------------
   Data
---------------------------------------------------------------------------- */

export async function deleteWorkspaceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = deleteWorkspaceSchema.safeParse(formToRecord(formData));
  if (!parsed.success) return { ok: false, error: "That request was not valid. Reload the page and try again." };
  const { user, workspace } = await requireWorkspace();
  if (workspace.id !== parsed.data.workspace_id) return { ok: false, error: "This form belongs to a different workspace." };
  if (!canDeleteWorkspace(workspace.role)) return { ok: false, error: "Only the workspace owner can delete it." };
  if (parsed.data.confirm.trim().toLowerCase() !== workspace.name.trim().toLowerCase()) {
    return { ok: false, error: "Type the workspace name exactly as shown to confirm.", fieldErrors: { confirm: "The name does not match." } };
  }
  try {
    const done = await withUser(user.id, (sql) => svc.softDeleteWorkspace(sql, { workspaceId: workspace.id, version: parsed.data.version }));
    if (!done) return { ok: false, error: "The workspace changed somewhere else. Reload the page and try again." };
  } catch (error) {
    return failure(error, "deleteWorkspace");
  }
  const store = await cookies();
  store.delete(WORKSPACE_COOKIE);
  redirect("/app");
}
