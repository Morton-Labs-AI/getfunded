/**
 * POST /api/ai/fit  { orgId, savedFunderId?, force? }  →  FitResponse
 *
 * Runs (or reuses) the fit analysis for one funder against the caller's
 * workspace profile. Same-origin, signed in, plan gate `fit`, metered as
 * 'fit' (5 credits) inside runFit(), which spends nothing when a fresh
 * analysis with the same evidence fingerprint already exists. The response is
 * the stored analysis: every reason cites evidence ids that resolve against
 * the `evidence` list returned alongside it.
 *
 *   402 quota_exceeded · 403 plan_feature · 404 funder_not_found
 *   422 evidence_too_thin · 502 ai_output_rejected · 503 ai_disabled
 */
import { FitBody, type FitResponse } from "@/lib/ai/api-schemas";
import { runFit } from "@/lib/ai/fit";
import { aiRoute } from "@/lib/ai/route";
import { CREDIT_COSTS } from "@/lib/plans";
import { boundedJson } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

/**
 * One fast-model call with one retry (90 s per attempt, lib/ai/client.ts) plus
 * the evidence build: 120 s lets the ledger row settle or refund before the
 * platform kills the function with the row still 'reserved'.
 */
export const maxDuration = 120;

export async function POST(req: Request): Promise<Response> {
  return aiRoute(req, "fit", async ({ ctx }) => {
    const body = await boundedJson(req, FitBody, 4_000);
    const result = await runFit(ctx, { orgId: body.orgId, savedFunderId: body.savedFunderId ?? null, force: body.force });
    const payload: FitResponse = {
      analysisId: result.analysisId,
      reused: result.reused,
      isMock: result.isMock,
      analysis: result.analysis,
      evidence: result.evidence,
      credits: result.reused ? 0 : CREDIT_COSTS.fit,
    };
    return Response.json(payload, { headers: NO_STORE });
  });
}
