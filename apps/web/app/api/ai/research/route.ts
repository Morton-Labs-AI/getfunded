/**
 * POST /api/ai/research  { orgId, savedFunderId?, force? }  →  ResearchResponse
 *
 * A web research dossier for one funder: cited notes from the public web
 * (anchored by what the filings already say), then a structured, validated
 * dossier stored as ai_analyses kind 'research'. Same-origin, signed in,
 * plan gate `research`, metered as 'research' (10 credits) inside
 * runResearch(), which reuses a dossier younger than RESEARCH_FRESH_DAYS
 * unless `force` is set.
 */
import { ResearchBody, type ResearchResponse } from "@/lib/ai/api-schemas";
import { runResearch } from "@/lib/ai/research";
import { aiRoute } from "@/lib/ai/route";
import { CREDIT_COSTS } from "@/lib/plans";
import { boundedJson } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request): Promise<Response> {
  return aiRoute(req, "research", async ({ ctx }) => {
    const body = await boundedJson(req, ResearchBody, 4_000);
    const result = await runResearch(ctx, { orgId: body.orgId, savedFunderId: body.savedFunderId ?? null, force: body.force });
    const payload: ResearchResponse = {
      analysisId: result.analysisId,
      reused: result.reused,
      isMock: result.isMock,
      dossier: result.dossier,
      credits: result.reused ? 0 : CREDIT_COSTS.research,
    };
    return Response.json(payload, { headers: NO_STORE });
  });
}
