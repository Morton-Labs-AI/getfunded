/**
 * GET /api/health → { ok, version, db: "ok" | "down", ai: "enabled" | "disabled" | "mock" }
 * 200 when the database answers `select 1` within 2 seconds, 503 otherwise.
 */
import { connection } from "next/server";
import pkg from "@/package.json";
import { healthReport } from "@/lib/billing/health";

export async function GET(): Promise<Response> {
  await connection();
  const report = await healthReport(pkg.version);
  return Response.json(report, { status: report.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
