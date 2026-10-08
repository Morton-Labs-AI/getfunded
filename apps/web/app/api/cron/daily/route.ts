/**
 * GET|POST /api/cron/daily — Vercel Cron (see apps/web/vercel.json) or any
 * scheduler that sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Runs getfunded.daily_maintenance(): prunes events older than 12 months,
 * marks messages stuck in 'sending' for over an hour as 'failed' (with a
 * send_outcomes row) so the outreach runner can reconcile them, and records
 * a 'cron:daily' event. 503 when CRON_SECRET is unset, 401 on a bad secret.
 */
import { connection } from "next/server";

import { authorizeCron, runDailyMaintenance } from "@/lib/admin/cron";
import { appDb } from "@/lib/billing/db";
import { jsonError } from "@/lib/security";

async function run(req: Request): Promise<Response> {
  await connection();
  const auth = authorizeCron(req);
  if (!auth.ok) return jsonError(auth.status, auth.code, auth.message);
  try {
    const result = await runDailyMaintenance(appDb);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[cron:daily] failed", { error: err instanceof Error ? err.message : String(err) });
    return jsonError(500, "maintenance_failed", "Daily maintenance did not complete. Check the server log.");
  }
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}
