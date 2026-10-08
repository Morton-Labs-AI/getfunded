/**
 * POST /api/ai/draft  { orgId, template, savedFunderId? }  →  DraftResponse
 *
 * Polish the person's own outreach template for one funder using ONLY the
 * funder's public facts, the latest research dossier (when one exists) and the
 * workspace profile. Same-origin, signed in, plan gate `draft`, metered as
 * 'draft' (2 credits) inside polishDraft(). Every factual claim in the draft
 * cites a package id; a draft that asserts the funder's interest is refused
 * (lib/ai/draft-schema.ts). The ledger then records the tokens the model
 * billed: settled when tokens were spent, refunded when none were
 * (lib/billing/meter.ts failureStatus).
 */
import { DraftBody, type DraftResponse } from "@/lib/ai/api-schemas";
import { polishDraft, type DraftFunder } from "@/lib/ai/draft";
import { FunderNotFoundError } from "@/lib/ai/http";
import { getLatestResearch } from "@/lib/ai/research";
import { aiRoute } from "@/lib/ai/route";
import { CREDIT_COSTS } from "@/lib/plans";
import { getFunder } from "@/lib/queries/corpus/funder";
import type { FunderRecord } from "@/lib/queries/corpus/types";
import { boundedJson } from "@/lib/security";

const NO_STORE = { "cache-control": "no-store" } as const;

/** One fast-model call plus a funder read; a hung call is cut at 60 s and the reaper refunds the row. */
export const maxDuration = 60;

/** The posture words the draft package expects follow the corpus enum, not the URL spelling. */
function toDraftFunder(f: FunderRecord): DraftFunder {
  const posture = f.posture === "preselected" ? "preselected_only" : f.posture;
  return {
    orgId: f.orgId,
    name: f.name,
    ein: f.ein,
    orgType: f.orgType,
    city: f.city,
    state: f.state,
    website: f.website,
    posture: posture ?? null,
    howToApply: f.application?.howToApply ?? null,
  };
}

export async function POST(req: Request): Promise<Response> {
  return aiRoute(req, "draft", async ({ ctx, workspace }) => {
    const body = await boundedJson(req, DraftBody, 32_000);
    const funder = await getFunder(body.orgId);
    if (!funder) throw new FunderNotFoundError(body.orgId);
    // A missing or unreadable dossier is not a reason to refuse a draft.
    const dossier = await getLatestResearch(ctx, body.orgId).then(
      (r) => r?.dossier ?? undefined,
      () => undefined,
    );
    const draft = await polishDraft(ctx, {
      template: body.template,
      funder: toDraftFunder(funder),
      dossier,
      orgProfile: workspace.profile,
      applicantName: workspace.name,
    });
    const payload: DraftResponse = { draft, credits: CREDIT_COSTS.draft };
    return Response.json(payload, { headers: NO_STORE });
  });
}
