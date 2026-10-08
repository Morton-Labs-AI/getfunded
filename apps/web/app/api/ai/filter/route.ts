/**
 * POST /api/ai/filter  { sentence, current? }  →  FilterResponse
 *
 * One sentence becomes the same search chips a person could set by hand.
 * Same-origin, signed in, plan gate `nl_filter`, metered as 'filter'
 * (1 credit) inside runFilter(). The model never writes SQL here: it fills a
 * fixed tool schema, the normaliser drops anything invalid, and
 * lib/ai/filter-search translates the rest into lib/search/params state.
 * The client navigates to `/app/search?` + toQueryString(params).
 */
import { FilterBody, type FilterResponse } from "@/lib/ai/api-schemas";
import { runFilter } from "@/lib/ai/filter";
import { aiRoute } from "@/lib/ai/route";
import { CREDIT_COSTS } from "@/lib/plans";
import { boundedJson } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * One short fast-model tool call (seconds, not minutes). A hung call is cut by
 * the platform at 60 s; the daily reaper (migration 0011) refunds any row that
 * is left 'reserved' by that.
 */
export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  return aiRoute(req, "nl_filter", async ({ ctx }) => {
    const body = await boundedJson(req, FilterBody, 16_000);
    const result = await runFilter(ctx, { text: body.sentence, current: body.current });
    const payload: FilterResponse = {
      params: result.searchParams,
      chips: result.chips,
      dropped: result.dropped,
      replace: result.replace,
      interpretation: result.interpretation,
      mock: result.mock,
      credits: CREDIT_COSTS.filter,
    };
    return Response.json(payload, { headers: NO_STORE });
  });
}
