/**
 * GET /api/funders/[id] → { funder, financials, officers, contacts, similar, filings }
 *
 * Everything the profile page shows except the paged grants, which live at
 * /api/funders/[id]/grants. 404 when the id is unknown, 400 when it is not a
 * uuid. Same rate limit as search.
 */
import { DbError } from "@/lib/db/app";
import {
  getFunder,
  getFunderContacts,
  getFunderFilings,
  getFunderFinancials,
  getFunderOfficers,
  getSimilarFunders,
} from "@/lib/queries/corpus/funder";
import { isUuid, softFail } from "@/lib/queries/corpus/safe";
import { limitSearchRequest } from "@/lib/search/limit";
import { jsonError } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id", "The funder id must be a UUID.");

  const limited = await limitSearchRequest(req);
  if (limited) return limited;

  try {
    const funder = await getFunder(id);
    if (!funder) return jsonError(404, "not_found", "No funder with that id.");
    const [financials, officers, contacts, similar, filings] = await Promise.all([
      softFail("financials", [], () => getFunderFinancials(id)),
      softFail("officers", [], () => getFunderOfficers(id)),
      softFail("contacts", [], () => getFunderContacts(id)),
      softFail("similar", [], () => getSimilarFunders(id)),
      softFail("filings", [], () => getFunderFilings(id)),
    ]);
    return Response.json({ funder, financials, officers, contacts, similar, filings }, { headers: NO_STORE });
  } catch (err) {
    const e = DbError.from(err);
    if (DbError.is(e, "timeout")) return jsonError(504, "timeout", "That request took too long. Please try again.");
    console.error("[api/funders]", e instanceof Error ? e.message : e);
    return jsonError(500, "funder_failed", "The funder could not be loaded. Please try again.");
  }
}
