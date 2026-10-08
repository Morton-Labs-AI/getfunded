/**
 * GET /api/admin/stats?days=30 — the overview numbers as JSON, for a steward's
 * own monitoring. Stewards only (404 otherwise, so the surface stays hidden).
 */
import { connection } from "next/server";
import { z } from "zod";

import { requireStewardApi } from "@/lib/admin/gate";
import { getOverview } from "@/lib/admin/queries";
import { jsonError } from "@/lib/security";

export async function GET(req: Request): Promise<Response> {
  await connection();
  const gate = await requireStewardApi();
  if (!gate.ok) return gate.response;

  const days = z.coerce.number().int().min(1).max(90).default(30).safeParse(new URL(req.url).searchParams.get("days") ?? undefined);
  if (!days.success) return jsonError(400, "invalid_params", "days must be a whole number from 1 to 90.");

  const overview = await getOverview(gate.session.user.id, days.data);
  return Response.json(overview, { headers: { "Cache-Control": "private, no-store" } });
}
