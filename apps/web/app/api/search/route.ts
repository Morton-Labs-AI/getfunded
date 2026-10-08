/**
 * GET /api/search?q=&mode=&type=&state=&posture=&min_distributions=&min_assets=&ntee=&giving_to=&sort=&page=&view=
 *
 * The same SearchResult the page renders, as JSON. No account needed; rate
 * limited per IP (30/min) or per user (120/min) when a session cookie is
 * present. The v1 public API reuses this shape behind key auth.
 */
import { DbError } from "@/lib/db/app";
import { searchFunders } from "@/lib/queries/corpus/search";
import { limitSearchRequest } from "@/lib/search/limit";
import { parseSearchParams } from "@/lib/search/params";
import { jsonError } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request): Promise<Response> {
  const limited = await limitSearchRequest(req);
  if (limited) return limited;

  const params = parseSearchParams(new URL(req.url).searchParams);
  try {
    const result = await searchFunders(params);
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    const e = DbError.from(err);
    if (DbError.is(e, "timeout")) {
      return jsonError(504, "timeout", "That search took too long. Add a filter or try fewer words.");
    }
    console.error("[api/search]", e instanceof Error ? e.message : e);
    return jsonError(500, "search_failed", "The search could not be completed. Please try again.");
  }
}
