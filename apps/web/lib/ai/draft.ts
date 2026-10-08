import "server-only";
/**
 * `polishDraft`: rewrite an outreach template using only the funder's public
 * facts, the dossier facts and the applicant profile. Metered as 'draft'
 * (2 credits). The model's output must pass the schema, cite package ids for
 * every claim and never assert the funder's interest; one retry names the
 * problems, then the call fails. The credits are still charged when the model
 * billed tokens (the ledger row settles with `meta.failed = true`) and are
 * refunded only when none were spent (lib/billing/meter.ts failureStatus).
 */
import { z } from "zod";
import { addUsage, type AiClient, type AiRequest, type Usage } from "@/lib/ai/types";
import { meter, type MeterDeps } from "@/lib/billing/meter";
import {
  DRAFT_PROMPT_VERSION,
  DraftOutputSchema,
  buildDraftPackage,
  buildDraftRetry,
  buildDraftSystem,
  buildDraftTool,
  buildDraftUser,
  draftProblems,
  mockDraftOutput,
  toPolishedDraft,
  type DraftFunder,
  type DraftPackage,
  type PolishedDraft,
} from "./draft-schema";
import { normalizeToolInput, packageIds } from "./evidence";
import { AiOutputRejectedError } from "./http";

export type { DraftFunder, PolishedDraft } from "./draft-schema";

export type DraftContext = { userId: string; workspaceId: string };

export type PolishDraftInput = {
  /** The person's own draft or template, kept in substance. */
  template: string;
  funder: DraftFunder;
  /** A research dossier (ai_analyses kind 'research' output) when one exists. */
  dossier?: unknown;
  /** `workspaces.profile`. */
  orgProfile: unknown;
  /** The workspace name, used as the applicant's name in the package. */
  applicantName?: string;
};

const TemplateSchema = z.string().trim().min(20).max(6000);

/** Produce a validated draft from the package: forced tool, retry once, fail. */
export async function produceDraft(ai: AiClient, pkg: DraftPackage, template: string, userId: string): Promise<{ draft: PolishedDraft; usage: Usage }> {
  const allowed = packageIds(pkg.items);
  const tool = buildDraftTool();
  const messages: AiRequest["messages"] = [{ role: "user", content: buildDraftUser(pkg) }];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, model: "" };
  let problems: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await ai.fast({ system: buildDraftSystem(), messages, tools: [tool], toolChoice: { name: tool.name }, maxTokens: 3000, effort: "low", userId });
    usage = attempt === 0 ? res.usage : addUsage(usage, res.usage);
    const raw = res.mock ? mockDraftOutput(pkg, template) : normalizeToolInput(res.toolInput);
    const parsed = DraftOutputSchema.safeParse(raw);
    if (!parsed.success) {
      problems = parsed.error.issues.slice(0, 8).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
    } else {
      problems = draftProblems(parsed.data, allowed);
      if (problems.length === 0) return { draft: toPolishedDraft(parsed.data), usage };
    }
    messages.push({ role: "assistant", content: typeof raw === "object" && raw ? JSON.stringify(raw).slice(0, 20_000) : "(no tool call)" });
    messages.push({ role: "user", content: buildDraftRetry(problems) });
  }
  throw new AiOutputRejectedError(problems, usage);
}

/**
 * The shared contract: template + funder facts + dossier facts only; claims
 * cite evidence ids; never asserts funder interest. Metered 'draft'.
 */
export async function polishDraft(ctx: DraftContext, input: PolishDraftInput, deps: MeterDeps = {}): Promise<PolishedDraft> {
  const template = TemplateSchema.parse(input.template);
  const pkg = buildDraftPackage({ template, funder: input.funder, dossier: input.dossier, orgProfile: input.orgProfile, applicantName: input.applicantName });
  return meter(
    { userId: ctx.userId, workspaceId: ctx.workspaceId, feature: "draft", meta: { org_id: input.funder.orgId, prompt_version: DRAFT_PROMPT_VERSION } },
    async (ai) => {
      const { draft, usage } = await produceDraft(ai, pkg, template, ctx.userId);
      return { result: draft, usage };
    },
    deps,
  );
}
