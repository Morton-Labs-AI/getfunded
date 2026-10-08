import "server-only";
/**
 * JSON route plumbing shared by app/api/invites and app/api/keys: the
 * signed-in admin preamble and the mapping from SettingsError / DbError to
 * one `{ error: { code, message } }` shape.
 */
import { getUserOrNull } from "@/lib/auth/session";
import { DbError } from "@/lib/db/app";
import { jsonError } from "@/lib/security";
import { requireWorkspace, type Workspace } from "@/lib/workspace/context";
import type { SessionUser } from "@/lib/auth/session";
import { isAdminRole } from "./roles";
import { SettingsError, type SettingsErrorCode } from "./service";

const STATUS: Record<SettingsErrorCode, number> = {
  forbidden: 403,
  stale: 409,
  not_found: 404,
  seat_limit: 409,
  plan_required: 402,
  owner_protected: 403,
  self_remove: 403,
  already_member: 409,
  invalid: 400,
};

/** A `Response` for anything a settings route can throw, or null to rethrow. */
export function settingsErrorResponse(error: unknown): Response | null {
  if (error instanceof Response) return error;
  if (SettingsError.is(error)) return jsonError(STATUS[error.code], error.code, error.message);
  if (DbError.is(error, "forbidden")) return jsonError(403, "forbidden", "You do not have permission to do that.");
  if (DbError.is(error, "conflict")) return jsonError(409, "conflict", "That already exists.");
  return null;
}

export type AdminContext = { user: SessionUser; workspace: Workspace };

/** 401 when signed out, 403 when not an owner or admin, else the workspace context. */
export async function requireAdminContext(): Promise<{ ctx: AdminContext } | { response: Response }> {
  const user = await getUserOrNull();
  if (!user) return { response: jsonError(401, "unauthorized", "Sign in to use this endpoint.") };
  const ctx = await requireWorkspace();
  if (!isAdminRole(ctx.workspace.role)) {
    return { response: jsonError(403, "admin_required", "Only workspace owners and admins can do that.") };
  }
  return { ctx };
}

export function ok(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
