/**
 * POST /api/integrations/gmail/disconnect  { senderIdentityId?: uuid }
 * → { ok: true }
 *
 * Same-origin, signed in. A member disconnects their own mailbox; an owner or
 * admin may disconnect any mailbox in the workspace. Revokes at Google (best
 * effort), deletes the sealed token, marks the identity disconnected.
 *
 * A signed-out caller gets 401 JSON; `requireWorkspace()` (which redirects by
 * throwing) runs outside the try so its redirect is never turned into a 500.
 */
import { connection } from "next/server";
import { z } from "zod";

import { getUserOrNull } from "@/lib/auth/session";
import { disconnectGmail, getSenderIdentity, mySenderIdentity } from "@/lib/outreach/senders";
import { assertSameOrigin, boundedJson, jsonError } from "@/lib/security";
import { requireWorkspace } from "@/lib/workspace/context";

const Body = z.object({ senderIdentityId: z.uuid().optional() });

export async function POST(req: Request): Promise<Response> {
  await connection();
  try {
    assertSameOrigin(req);
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  if (!(await getUserOrNull())) return jsonError(401, "sign_in_required", "Sign in to manage your mailbox.");
  const { user, workspace } = await requireWorkspace();
  try {
    const ctx = { userId: user.id, workspaceId: workspace.id };
    const body = await boundedJson(req, Body, 2_000);
    const identity = body.senderIdentityId ? await getSenderIdentity(ctx, body.senderIdentityId) : await mySenderIdentity(ctx);
    if (!identity) return jsonError(404, "not_connected", "There is no connected mailbox to disconnect.");
    const admin = workspace.role === "owner" || workspace.role === "admin";
    if (identity.userId !== user.id && !admin) return jsonError(403, "forbidden", "Only the mailbox owner or a workspace admin can disconnect it.");
    await disconnectGmail(ctx, identity.id);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[gmail/disconnect] failed", { error: error instanceof Error ? error.message : String(error) });
    return jsonError(500, "disconnect_failed", "Could not disconnect the mailbox. Try again in a minute.");
  }
}
