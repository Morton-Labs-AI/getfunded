/**
 * POST /api/outreach/send  { messageIds?: uuid[], senderIdentityId?: uuid, limit?: 1..100 }
 * → { ok, reports: SendReport[] }
 *
 * The send run. Same-origin, signed in, Pro and above. A member sends only
 * from their own connected mailbox (and so only messages they approved);
 * an owner or admin may run every connected mailbox in the workspace. The
 * runner itself sends only status 'approved' email, re-checks the do-not-
 * contact list, honours the daily cap, reconciles interrupted sends by
 * Message-ID and records an outcome for every attempt. Nothing in the
 * response or the log ever contains a token.
 */
import { connection } from "next/server";

import { OutreachRunError, runSendForCaller } from "@/lib/outreach/run";
import { sendRequestSchema } from "@/lib/outreach/types";
import { userSubject, withRateLimit } from "@/lib/ratelimit";
import { assertSameOrigin, boundedJson, jsonError } from "@/lib/security";
import { requireWorkspace } from "@/lib/workspace/context";

const SEND_RUNS = { name: "outreach_send", capacity: 10, refillPerSec: 10 / 60 };

export async function POST(req: Request): Promise<Response> {
  await connection();
  try {
    assertSameOrigin(req);
    const { user, workspace } = await requireWorkspace();
    const limited = await withRateLimit(req, SEND_RUNS, () => userSubject(user.id));
    if (limited) return limited;
    const body = await boundedJson(req, sendRequestSchema, 16_000);
    const result = await runSendForCaller({ userId: user.id, workspaceId: workspace.id, role: workspace.role, plan: workspace.plan }, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof OutreachRunError) return jsonError(error.status, error.code, error.message);
    console.error("[outreach/send] failed", { error: error instanceof Error ? error.message : String(error) });
    return jsonError(500, "send_failed", "The send run did not finish. Nothing was sent twice; try again in a minute.");
  }
}
