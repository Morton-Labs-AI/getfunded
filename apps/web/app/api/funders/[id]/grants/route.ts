/**
 * GET /api/funders/[id]/grants?page=&q= → GrantsPage
 * Largest grants first, 25 per page, with per-row provenance.
 */
import { z } from "zod";

import { DbError } from "@/lib/db/app";
import { GRANTS_MAX_PAGE, getFunder, getFunderGrants } from "@/lib/queries/corpus/funder";
import { isUuid } from "@/lib/queries/corpus/safe";
import { limitSearchRequest } from "@/lib/search/limit";
import { MAX_GIVING_TO_CHARS } from "@/lib/search/params";
import { jsonError } from "@/lib/security";

const Query = z.object({
  page: z.coerce.number().int().min(1).max(GRANTS_MAX_PAGE).catch(1),
  q: z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, MAX_GIVING_TO_CHARS))
    .optional()
    .catch(undefined),
});

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isUuid(id)) return jsonError(400, "invalid_id", "The funder id must be a UUID.");

  const limited = await limitSearchRequest(req);
  if (limited) return limited;

  const sp = new URL(req.url).searchParams;
  const query = Query.parse({ page: sp.get("page") ?? undefined, q: sp.get("q") ?? undefined });

  try {
    const funder = await getFunder(id);
    if (!funder) return jsonError(404, "not_found", "No funder with that id.");
    const grants = await getFunderGrants(id, { page: query.page, q: query.q || null });
    return Response.json(grants, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const e = DbError.from(err);
    if (DbError.is(e, "timeout")) return jsonError(504, "timeout", "That request took too long. Please try again.");
    console.error("[api/funders/grants]", e instanceof Error ? e.message : e);
    return jsonError(500, "grants_failed", "The grants could not be loaded. Please try again.");
  }
}
