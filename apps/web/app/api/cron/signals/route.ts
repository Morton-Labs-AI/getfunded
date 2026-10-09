/**
 * GET|POST /api/cron/signals — Vercel Cron (see apps/web/vercel.json) or any
 * scheduler that sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Runs getfunded.sync_signal_notifications(): every published funder signal
 * the corpus pipeline has added since the last run becomes a notification
 * for the members it concerns (saved funders always; discovery matches on
 * paid plans or self-installs) and a system activity on the saved funder.
 * 503 when CRON_SECRET is unset, 401 on a bad secret. Safe to run often: the
 * door keeps a cursor per workspace.
 */
import { connection } from "next/server";

import { authorizeCron, runSignalSync } from "@/lib/admin/cron";
import { appDb } from "@/lib/billing/db";
import { isSelfHosted } from "@/lib/plans";
import { jsonError } from "@/lib/security";

async function run(req: Request): Promise<Response> {
  await connection();
  const auth = authorizeCron(req);
  if (!auth.ok) return jsonError(auth.status, auth.code, auth.message);
  try {
    const result = await runSignalSync(appDb, { discoveryForAll: isSelfHosted() });
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[cron:signals] failed", { error: err instanceof Error ? err.message : String(err) });
    return jsonError(500, "signal_sync_failed", "Signal sync did not complete. Check the server log.");
  }
}

export async function GET(req: Request): Promise<Response> {
  return run(req);
}

export async function POST(req: Request): Promise<Response> {
  return run(req);
}
