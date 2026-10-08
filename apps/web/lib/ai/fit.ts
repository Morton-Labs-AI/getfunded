import "server-only";
/**
 * The fit engine. One entry point for the route, the panel and (in
 * AI_MODE=mock) the end-to-end suite.
 *
 * Pipeline: evidence package -> fingerprint -> fresh check (no credits spent
 * when nothing changed) -> meter('fit') -> model with a forced tool -> zod +
 * evidence-reference validation (retry ONCE naming the violations, then fail)
 * -> deterministic composite -> append to ai_analyses + mark_latest_analysis.
 *
 * The model never computes the overall score and never sees anything outside
 * the package. Mock output is stored with is_mock=true in its own namespace.
 */
import { z } from "zod";
import { aiMode, modelsFromEnv } from "@/lib/ai/client";
import { addUsage, type AiClient, type AiRequest, type MessageParam, type Usage } from "@/lib/ai/types";
import { withUser, type Db } from "@/lib/billing/db";
import { meter, type MeterDeps } from "@/lib/billing/meter";
import { insertAnalysis, insertFeedback, latestAnalysis, latestFeedback, type AnalysisRow, type FeedbackVerdict } from "./analyses";
import { fingerprintOf, normalizeToolInput, packageIds, type EvidenceItem } from "./evidence";
import { buildFitEvidence, type CorpusRunner, type FitEvidencePackage } from "./fit-evidence";
import { mockFitOutput } from "./fit-mock";
import { buildFitRetry, buildFitSystem, buildFitUser } from "./fit-prompt";
import {
  FIT_PROMPT_VERSION,
  FIT_WEIGHTS_VERSION,
  ModelFitOutputSchema,
  buildFitTool,
  readEvidenceItems,
  readFitAnalysis,
  toFitAnalysis,
  validateFitRefs,
  type FitAnalysis,
  type ModelFitOutput,
} from "./fit-schema";
import { AiFeatureError, AiOutputRejectedError, EvidenceTooThinError } from "./http";

export type FitContext = { userId: string; workspaceId: string };

type Runner = <T>(userId: string | null, fn: (sql: Db) => Promise<T>) => Promise<T>;

/**
 * `savedFunderId` comes from the client. It must be a saved funder of THIS
 * workspace: the analysis row and the activity row would otherwise be written
 * against a stranger's list. Checked before any credit is reserved. RLS hides
 * foreign rows from this SELECT, so "not found" covers both cases.
 */
export async function assertOwnsSavedFunder(wu: Runner, ctx: FitContext, savedFunderId: string): Promise<void> {
  const owned = await wu(ctx.userId, async (sql) => {
    const rows = await sql`
      select 1 as ok from getfunded.saved_funders
      where id = ${savedFunderId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
    return rows.length > 0;
  });
  if (!owned) throw new AiFeatureError("saved_funder_not_found", 404, "That saved funder is not on this workspace's list.", { savedFunderId });
}

const RunFitInput = z.object({
  orgId: z.uuid(),
  savedFunderId: z.uuid().nullish(),
  /** Re-run even when the fingerprint has not changed. */
  force: z.boolean().optional(),
});
export type RunFitInput = z.infer<typeof RunFitInput>;

export type FitDeps = MeterDeps & { corpus?: CorpusRunner };

export type RunFitResult = {
  analysisId: string;
  /** True when a fresh analysis with the same fingerprint already existed; no credits were spent. */
  reused: boolean;
  analysis: FitAnalysis;
  evidence: EvidenceItem[];
  isMock: boolean;
};

const FIT_MAX_TOKENS = 16_000;

function modelTagFor(env: Record<string, string | undefined>): { isMock: boolean; model: string } {
  const mode = aiMode(env);
  return { isMock: mode === "mock", model: mode === "mock" ? "mock" : modelsFromEnv(env).fast };
}

/**
 * Call the model with the forced tool, validate, retry once naming the
 * violations, then fail. Returns the validated output and the summed usage.
 */
export async function produceFitOutput(
  ai: AiClient,
  pkg: FitEvidencePackage,
  userId: string,
): Promise<{ out: ModelFitOutput; usage: Usage }> {
  const allowed = packageIds(pkg.items);
  const tool = buildFitTool();
  const system = buildFitSystem();
  const user = buildFitUser({ funderName: pkg.funderName, applicantName: pkg.applicantName, items: pkg.items });
  const messages: MessageParam[] = [{ role: "user", content: user }];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, model: "" };
  let violations: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const req: AiRequest = {
      system,
      messages,
      tools: [tool],
      toolChoice: { name: tool.name },
      maxTokens: FIT_MAX_TOKENS,
      userId,
    };
    const res = await ai.fast(req);
    usage = attempt === 0 ? res.usage : addUsage(usage, res.usage);

    // AI_MODE=mock: a deterministic, evidence-aware output that still passes the whole validation path.
    const raw: unknown = res.mock ? mockFitOutput({ funderName: pkg.funderName, items: pkg.items }) : normalizeToolInput(res.toolInput);

    if (!res.mock && res.stopReason === "max_tokens") {
      violations = [
        "your previous answer was cut off before the tool call finished; be more concise: at most 3 reasons, at most 3 concerns, one short sentence per dimension",
      ];
    } else {
      const parsed = ModelFitOutputSchema.safeParse(raw);
      if (!parsed.success) {
        violations = parsed.error.issues.slice(0, 8).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
      } else {
        violations = validateFitRefs(parsed.data, allowed);
        if (violations.length === 0) return { out: parsed.data, usage };
      }
    }
    // Echo what the model produced so the retry sees its own work, then name the violations.
    messages.push({ role: "assistant", content: typeof raw === "object" && raw ? JSON.stringify(raw).slice(0, 20_000) : "(no tool call)" });
    messages.push({ role: "user", content: buildFitRetry(violations) });
  }
  throw new AiOutputRejectedError(violations, usage);
}

/**
 * Run (or reuse) the fit analysis for one funder. Spends 5 credits only when
 * the evidence fingerprint changed or `force` is set.
 */
export async function runFit(ctx: FitContext, inputIn: RunFitInput, deps: FitDeps = {}): Promise<RunFitResult> {
  const input = RunFitInput.parse(inputIn);
  const env = deps.env ?? process.env;
  const wu = deps.withUser ?? withUser;
  const { isMock, model } = modelTagFor(env);

  if (input.savedFunderId) await assertOwnsSavedFunder(wu, ctx, input.savedFunderId);

  const pkg = await buildFitEvidence({ orgId: input.orgId, workspaceId: ctx.workspaceId, userId: ctx.userId }, { corpus: deps.corpus, withUser: wu });
  if (pkg.thin) throw new EvidenceTooThinError();

  const fingerprint = fingerprintOf({ items: pkg.items, promptVersion: FIT_PROMPT_VERSION, weightsVersion: FIT_WEIGHTS_VERSION, model });

  if (!input.force) {
    const latest = await wu(ctx.userId, (sql) => latestAnalysis(sql, { workspaceId: ctx.workspaceId, orgId: input.orgId, kind: "fit", isMock }));
    const analysis = latest ? readFitAnalysis(latest.output) : null;
    if (latest && analysis && latest.inputFingerprint === fingerprint) {
      return { analysisId: latest.id, reused: true, analysis, evidence: readEvidenceItems(latest.evidence), isMock: latest.isMock };
    }
  }

  return meter(
    { userId: ctx.userId, workspaceId: ctx.workspaceId, feature: "fit", meta: { org_id: input.orgId, prompt_version: FIT_PROMPT_VERSION } },
    async (ai, reservation) => {
      const { out, usage } = await produceFitOutput(ai, pkg, ctx.userId);
      const analysis = toFitAnalysis({ orgId: input.orgId, out, model: usage.model || model, now: deps.now?.() });
      const evidence = { items: pkg.items };
      const analysisId = await wu(ctx.userId, async (sql) => {
        const id = await insertAnalysis(sql, {
          workspaceId: ctx.workspaceId,
          savedFunderId: input.savedFunderId ?? null,
          orgId: input.orgId,
          kind: "fit",
          model: analysis.model,
          promptVersion: FIT_PROMPT_VERSION,
          weightsVersion: FIT_WEIGHTS_VERSION,
          inputFingerprint: fingerprint,
          evidence,
          output: analysis,
          score: analysis.overallScore,
          rating: analysis.rating,
          isMock: ai.mode === "mock",
          usageLedgerId: reservation.ledgerId,
          createdBy: ctx.userId,
        });
        if (input.savedFunderId) {
          await sql`
            insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
            values (${ctx.workspaceId}::uuid, ${input.savedFunderId}::uuid, 'system',
                    ${`AI fit analysis: ${analysis.overallScore}/100 (${analysis.rating.replace("_", " ")})`},
                    ${ctx.userId}::uuid,
                    ${sql.json({ event: "ai_fit", analysis_id: id, score: analysis.overallScore, rating: analysis.rating, mock: ai.mode === "mock" } as never)}::jsonb)`;
        }
        return id;
      });
      return {
        result: { analysisId, reused: false, analysis, evidence: pkg.items, isMock: ai.mode === "mock" } satisfies RunFitResult,
        usage,
      };
    },
    deps,
  );
}

export type LatestFit = {
  row: AnalysisRow;
  analysis: FitAnalysis;
  evidence: EvidenceItem[];
  feedback: { verdict: FeedbackVerdict; createdAt: string } | null;
  /** True when the current evidence fingerprint differs from the one this analysis used. Null when not checked. */
  stale: boolean | null;
};

/**
 * The latest fit analysis for one funder in the caller's workspace (mock or
 * real namespace, matching the current AI mode). With `checkStale`, rebuilds
 * the evidence package and compares fingerprints; that costs a few corpus
 * reads and no credits.
 */
export async function getLatestFit(
  ctx: FitContext,
  orgId: string,
  opts: { checkStale?: boolean } = {},
  deps: FitDeps = {},
): Promise<LatestFit | null> {
  const id = z.uuid().parse(orgId);
  const env = deps.env ?? process.env;
  const wu = deps.withUser ?? withUser;
  const { isMock, model } = modelTagFor(env);

  const found = await wu(ctx.userId, async (sql) => {
    const row = await latestAnalysis(sql, { workspaceId: ctx.workspaceId, orgId: id, kind: "fit", isMock });
    if (!row) return null;
    const feedback = await latestFeedback(sql, row.id);
    return { row, feedback };
  });
  if (!found) return null;
  const analysis = readFitAnalysis(found.row.output);
  if (!analysis) return null;

  let stale: boolean | null = null;
  if (opts.checkStale) {
    try {
      const pkg = await buildFitEvidence({ orgId: id, workspaceId: ctx.workspaceId, userId: ctx.userId }, { corpus: deps.corpus, withUser: wu });
      stale = fingerprintOf({ items: pkg.items, promptVersion: FIT_PROMPT_VERSION, weightsVersion: FIT_WEIGHTS_VERSION, model }) !== found.row.inputFingerprint;
    } catch {
      stale = null;
    }
  }
  return {
    row: found.row,
    analysis,
    evidence: readEvidenceItems(found.row.evidence),
    feedback: found.feedback ? { verdict: found.feedback.verdict, createdAt: found.feedback.createdAt } : null,
    stale,
  };
}

const FeedbackInput = z.object({
  analysisId: z.uuid(),
  verdict: z.enum(["accepted", "edited", "dismissed"]),
  editedOutput: z.unknown().optional(),
});
export type FitFeedbackInput = z.infer<typeof FeedbackInput>;

/** Append an accept / edit / dismiss verdict to ai_feedback (append-only). */
export async function recordAnalysisFeedback(ctx: FitContext, inputIn: FitFeedbackInput, deps: Pick<FitDeps, "withUser"> = {}): Promise<{ id: string }> {
  const input = FeedbackInput.parse(inputIn);
  const wu = deps.withUser ?? withUser;
  const id = await wu(ctx.userId, (sql) =>
    insertFeedback(sql, {
      analysisId: input.analysisId,
      workspaceId: ctx.workspaceId,
      verdict: input.verdict,
      editedOutput: input.editedOutput,
      createdBy: ctx.userId,
    }),
  );
  return { id };
}
