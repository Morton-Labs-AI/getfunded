/**
 * DELETE /api/invites/[id] → { ok: true }   revoke a pending invitation (owner/admin)
 */
import { z } from "zod";

import { withUser } from "@/lib/db/app";
import { assertSameOrigin, jsonError } from "@/lib/security";
import { ok, requireAdminContext, settingsErrorResponse } from "@/lib/settings/http";
import { revokeInvite } from "@/lib/settings/service";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(req);
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return jsonError(400, "invalid_id", "That invitation id is not valid.");
    const pre = await requireAdminContext();
    if ("response" in pre) return pre.response;
    const { user, workspace } = pre.ctx;
    const done = await withUser(user.id, (sql) => revokeInvite(sql, { workspaceId: workspace.id, inviteId: id.data }));
    if (!done) return jsonError(404, "not_found", "That invitation was already used or revoked.");
    return ok({ ok: true });
  } catch (error) {
    const res = settingsErrorResponse(error);
    if (res) return res;
    throw error;
  }
}
