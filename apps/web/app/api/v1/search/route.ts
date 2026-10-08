/**
 * GET /api/v1/search — Team+ API key, 600/min per key, same parameters and
 * response as /api/search (B1's searchFunders).
 */
import { requireApiKey } from "@/lib/api/keys";
import { searchFunders } from "@/lib/queries/corpus/search";
import { withRateLimit } from "@/lib/ratelimit";
import { parseSearchParams } from "@/lib/search/params";

import { handleV1Search } from "../_lib/handlers";

export async function GET(req: Request): Promise<Response> {
  return handleV1Search(req, {
    requireApiKey,
    withRateLimit,
    parseSearchParams: (raw) => parseSearchParams(raw),
    searchFunders: (params) => searchFunders(params as Parameters<typeof searchFunders>[0]),
  });
}
