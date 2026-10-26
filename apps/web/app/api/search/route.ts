/**
 * GET /api/search?q=&mode=&type=&state=&posture=&min_distributions=&min_assets=&ntee=&giving_to=&standing=&sort=&page=&view=
 *
 * `standing=hide_revoked` leaves out organizations the IRS automatically
 * revoked; without it nothing is hidden (lib/search/standing-filter.ts).
 *
 * The same SearchResult the page renders, as JSON. No account needed; rate
 * limited per IP (30/min) or per user (120/min) when a session cookie is
 * present, except for the eval suite on a deployment that set EVAL_TOKEN
 * (lib/eval/token.ts). The v1 public API reuses this shape behind key auth.
 * `timing` and the Server-Timing header say where the time went.
 */
import { DbError } from "@/lib/db/app";
import { evalTokenOk } from "@/lib/eval/token";
import { searchFunders } from "@/lib/queries/corpus/search";
import type { SearchResult } from "@/lib/queries/corpus/types";
import { limitSearchRequest } from "@/lib/search/limit";
import { parseSearchParams } from "@/lib/search/params";
import { jsonError } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

function serverTiming(t: SearchResult["timing"]): string {
  if (!t) return "";
  const parts = [`total;dur=${t.totalMs}`, `db;dur=${t.dbMs}`];
  if (t.embedMs !== null) parts.push(`embed;dur=${t.embedMs}`);
  return parts.join(", ");
}

export async function GET(req: Request): Promise<Response> {
  if (!evalTokenOk(req)) {
    const limited = await limitSearchRequest(req);
    if (limited) return limited;
  }

  const params = parseSearchParams(new URL(req.url).searchParams);
  try {
    const result = await searchFunders(params);
    const timing = serverTiming(result.timing);
    return Response.json(result, { headers: timing ? { ...NO_STORE, "server-timing": timing } : NO_STORE });
  } catch (err) {
    const e = DbError.from(err);
    if (DbError.is(e, "timeout")) {
      return jsonError(504, "timeout", "That search took too long. Add a filter or try fewer words.");
    }
    console.error("[api/search]", e instanceof Error ? e.message : e);
    return jsonError(500, "search_failed", "The search could not be completed. Please try again.");
  }
}
