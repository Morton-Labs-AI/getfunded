/**
 * GET  /api/invites            → { invites: [...] }   pending invitations (owner/admin)
 * POST /api/invites { email, role? } → { id, email, role, url, expiresAt }
 *
 * Same-origin, signed-in, owner or admin. The link is returned once and never
 * stored in the clear. GetFunded does not send the email; the caller does.
 */
import { appUrl } from "@/lib/auth/env";
import { withUser } from "@/lib/db/app";
import { assertSameOrigin, boundedJson } from "@/lib/security";
import { ok, requireAdminContext, settingsErrorResponse } from "@/lib/settings/http";
import { inviteUrl } from "@/lib/settings/invites";
import { inviteCreateSchema } from "@/lib/settings/schemas";
import { createInvite, listInvites } from "@/lib/settings/service";

function originOf(req: Request): string {
  return appUrl() || new URL(req.url).origin;
}

export async function GET(): Promise<Response> {
  const pre = await requireAdminContext();
  if ("response" in pre) return pre.response;
  const { user, workspace } = pre.ctx;
  try {
    const invites = await withUser(user.id, (sql) => listInvites(sql, workspace.id));
    return ok({
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        expiresAt: i.expires_at.toISOString(),
        createdAt: i.created_at.toISOString(),
      })),
    });
  } catch (error) {
    const res = settingsErrorResponse(error);
    if (res) return res;
    throw error;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    const pre = await requireAdminContext();
    if ("response" in pre) return pre.response;
    const { user, workspace } = pre.ctx;
    const body = await boundedJson(req, inviteCreateSchema, 4_000);
    const created = await withUser(user.id, (sql) =>
      createInvite(sql, { workspaceId: workspace.id, email: body.email, role: body.role, invitedBy: user.id }),
    );
    return ok(
      {
        id: created.id,
        email: created.email,
        role: created.role,
        url: inviteUrl(originOf(req), created.token),
        expiresAt: created.expiresAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    const res = settingsErrorResponse(error);
    if (res) return res;
    throw error;
  }
}
