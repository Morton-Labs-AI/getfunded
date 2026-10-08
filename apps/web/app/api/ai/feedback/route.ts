/**
 * POST /api/ai/feedback  { analysisId, verdict, editedOutput? }  →  FeedbackResponse
 *
 * Record accept / edit / dismiss on one stored analysis. Append-only
 * (`getfunded.ai_feedback`); the analysis must belong to the caller's
 * workspace or the insert is refused with 404. No model call, no credits;
 * the plan gate is `fit` because the verdict is on a fit analysis.
 */
import { FeedbackBody, type FeedbackResponse } from "@/lib/ai/api-schemas";
import { recordAnalysisFeedback } from "@/lib/ai/fit";
import { aiRoute } from "@/lib/ai/route";
import { boundedJson } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function POST(req: Request): Promise<Response> {
  return aiRoute(req, "fit", async ({ ctx }) => {
    const body = await boundedJson(req, FeedbackBody, 64_000);
    const { id } = await recordAnalysisFeedback(ctx, {
      analysisId: body.analysisId,
      verdict: body.verdict,
      editedOutput: body.verdict === "edited" ? body.editedOutput : undefined,
    });
    const payload: FeedbackResponse = { id, verdict: body.verdict };
    return Response.json(payload, { status: 201, headers: NO_STORE });
  });
}
