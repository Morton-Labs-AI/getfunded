/**
 * GET /api/v1/funders/{id}?include=grants,financials,officers,contacts,similar
 * Team+ API key, 600/min per key. Profile from B1's getFunder; includes from
 * the sibling loaders in lib/queries/corpus/funder.ts.
 */
import { requireApiKey } from "@/lib/api/keys";
import {
  getFunder,
  getFunderContacts,
  getFunderFinancials,
  getFunderGrants,
  getFunderOfficers,
  getSimilarFunders,
} from "@/lib/queries/corpus/funder";
import { withRateLimit } from "@/lib/ratelimit";

import { handleV1Funder } from "../../_lib/handlers";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  return handleV1Funder(req, id, {
    requireApiKey,
    withRateLimit,
    getFunder: (orgId) => getFunder(orgId),
    getFunderGrants: (orgId) => getFunderGrants(orgId),
    getFunderFinancials: (orgId) => getFunderFinancials(orgId),
    getFunderOfficers: (orgId) => getFunderOfficers(orgId),
    getFunderContacts: (orgId) => getFunderContacts(orgId),
    getSimilarFunders: (orgId) => getSimilarFunders(orgId),
  });
}
