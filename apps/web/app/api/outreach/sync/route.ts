/**
 * POST /api/outreach/sync  { senderIdentityId?: uuid, limit?: 1..100 }
 * → { ok, reports: SyncReport[] }
 *
 * Reply detection from Gmail thread metadata (headers and timestamps only,
 * never a body). A reply records a 'replied' outcome and cancels pending
 * follow-ups to that contact; a delivery failure records 'bounced'.
 */
import { connection } from "next/server";

import { OutreachRunError, runSyncForCaller } from "@/lib/outreach/run";
import { syncRequestSchema } from "@/lib/outreach/types";
import { userSubject, withRateLimit } from "@/lib/ratelimit";
import { assertSameOrigin, boundedJson, jsonError } from "@/lib/security";
import { requireWorkspace } from "@/lib/workspace/context";

const SYNC_RUNS = { name: "outreach_sync", capacity: 6, refillPerSec: 6 / 60 };

export async function POST(req: Request): Promise<Response> {
  await connection();
  try {
    assertSameOrigin(req);
    const { user, workspace } = await requireWorkspace();
    const limited = await withRateLimit(req, SYNC_RUNS, () => userSubject(user.id));
    if (limited) return limited;
    const body = await boundedJson(req, syncRequestSchema, 4_000);
    const result = await runSyncForCaller({ userId: user.id, workspaceId: workspace.id, role: workspace.role, plan: workspace.plan }, body);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof OutreachRunError) return jsonError(error.status, error.code, error.message);
    console.error("[outreach/sync] failed", { error: error instanceof Error ? error.message : String(error) });
    return jsonError(500, "sync_failed", "Checking for replies did not finish. Try again in a minute.");
  }
}
