import "server-only";
/**
 * Research dossier: two model steps inside one metered call ('research',
 * 10 credits). Step one lets the deep model search the public web (the
 * Anthropic web_search server tool) and write cited notes, anchored by what
 * the filings already say. Step two converts the notes into the structured
 * dossier with a forced tool call and validates it. Stored as ai_analyses
 * kind 'research' with the filings facts and the notes as evidence.
 *
 * The AI client collapses a response to text plus the first tool call, so
 * source URLs come from the SOURCES list the model writes in its notes
 * (validated as http(s) URLs here), not from the raw search-result blocks.
 */
import { z } from "zod";
import { aiMode, modelsFromEnv } from "@/lib/ai/client";
import { AiError, addUsage, type AiClient, type AiRequest, type Tool, type Usage } from "@/lib/ai/types";
import { withUser } from "@/lib/billing/db";
import { meter, type MeterDeps } from "@/lib/billing/meter";
import { corpusQuery } from "@/lib/db/corpus";
import { insertAnalysis, latestAnalysis, type AnalysisRow } from "./analyses";
import { EvidenceBuilder, clip, fingerprintOf, normalizeToolInput, renderPackage, type EvidenceItem } from "./evidence";
import { assertOwnsSavedFunder } from "./fit";
import { addFunderEvidence, loadApplicant, type CorpusRunner } from "./fit-evidence";
import { AiOutputRejectedError } from "./http";
import {
  DossierSchema,
  RESEARCH_FRESH_DAYS,
  RESEARCH_PROMPT_VERSION,
  RESEARCH_SCHEMA_VERSION,
  buildDossierTool,
  buildNotesSystem,
  buildNotesUser,
  buildStructureSystem,
  buildStructureUser,
  mockDossier,
  readResearchOutput,
  sanitizeDossier,
  type Dossier,
  type ResearchOutput,
} from "./research-schema";

export type ResearchContext = { userId: string; workspaceId: string };

const RunResearchInput = z.object({
  orgId: z.uuid(),
  savedFunderId: z.uuid().nullish(),
  /** Search again even when a fresh dossier exists. */
  force: z.boolean().optional(),
});
export type RunResearchInput = z.infer<typeof RunResearchInput>;

export type ResearchDeps = MeterDeps & { corpus?: CorpusRunner };

export type RunResearchResult = { analysisId: string; reused: boolean; dossier: ResearchOutput; isMock: boolean };

/** The Anthropic web search server tool. Typed through the client's Tool slot; the API accepts it structurally. */
export const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 8 } as unknown as Tool;

const NOTES_MAX_TOKENS = 16_000;

/** Step one: cited notes from the web (deep model), or mock text. */
export async function researchNotes(ai: AiClient, input: { funderName: string; filingsFacts: string; applicantLine: string | null; userId: string }): Promise<{ text: string; usage: Usage }> {
  const req: AiRequest = {
    system: buildNotesSystem(),
    messages: [{ role: "user", content: buildNotesUser(input) }],
    tools: ai.mode === "mock" ? undefined : [WEB_SEARCH_TOOL],
    toolChoice: "auto",
    maxTokens: NOTES_MAX_TOKENS,
    effort: "medium",
    userId: input.userId,
  };
  const res = await ai.deep(req);
  // Both failures carry the usage: the model billed these tokens (web searches
  // included), so meter() settles the row instead of refunding a spent call.
  if (!res.text.trim() && res.stopReason === "pause_turn") {
    throw new AiError("ai_research_paused", 502, "The web research paused before writing any notes. Please try again.", { usage: res.usage });
  }
  if (!res.text.trim()) throw new AiError("ai_no_notes", 502, "The research model returned no notes.", { usage: res.usage });
  return { text: res.text, usage: res.usage };
}

/** Step two: structure the notes with a forced tool call; retry once naming the schema problems. */
export async function structureNotes(ai: AiClient, notes: string, mock: { funderName: string; items: ReadonlyArray<EvidenceItem> }, userId: string): Promise<{ dossier: Dossier; usage: Usage }> {
  const tool = buildDossierTool();
  const messages: AiRequest["messages"] = [{ role: "user", content: buildStructureUser(notes) }];
  let usage: Usage = { inputTokens: 0, outputTokens: 0, model: "" };
  let violations: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await ai.fast({ system: buildStructureSystem(), messages, tools: [tool], toolChoice: { name: tool.name }, maxTokens: 8000, effort: "low", userId });
    usage = attempt === 0 ? res.usage : addUsage(usage, res.usage);
    const raw = res.mock ? mockDossier(mock) : normalizeToolInput(res.toolInput);
    const parsed = DossierSchema.safeParse(raw);
    if (parsed.success) return { dossier: sanitizeDossier(parsed.data), usage };
    violations = parsed.error.issues.slice(0, 8).map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
    messages.push({ role: "assistant", content: typeof raw === "object" && raw ? JSON.stringify(raw).slice(0, 20_000) : "(no tool call)" });
    messages.push({ role: "user", content: `Your dossier was rejected:\n${violations.map((v) => `- ${v}`).join("\n")}\nCall emit_dossier again with a valid input.` });
  }
  throw new AiOutputRejectedError(violations, usage);
}

function modelTag(env: Record<string, string | undefined>): { isMock: boolean; model: string } {
  const mode = aiMode(env);
  return { isMock: mode === "mock", model: mode === "mock" ? "mock" : modelsFromEnv(env).deep };
}

function isFresh(row: AnalysisRow, now: Date): boolean {
  const age = now.getTime() - new Date(row.createdAt).getTime();
  return Number.isFinite(age) && age < RESEARCH_FRESH_DAYS * 24 * 60 * 60 * 1000;
}

/** Run (or reuse within RESEARCH_FRESH_DAYS) the web research dossier for one funder. */
export async function runResearch(ctx: ResearchContext, inputIn: RunResearchInput, deps: ResearchDeps = {}): Promise<RunResearchResult> {
  const input = RunResearchInput.parse(inputIn);
  const env = deps.env ?? process.env;
  const wu = deps.withUser ?? withUser;
  const corpus = deps.corpus ?? corpusQuery;
  const now = deps.now?.() ?? new Date();
  const { isMock, model } = modelTag(env);

  // A client-supplied saved funder id must belong to this workspace (404 otherwise), before any credit moves.
  if (input.savedFunderId) await assertOwnsSavedFunder(wu, ctx, input.savedFunderId);

  if (!input.force) {
    const latest = await wu(ctx.userId, (sql) => latestAnalysis(sql, { workspaceId: ctx.workspaceId, orgId: input.orgId, kind: "research", isMock }));
    const dossier = latest ? readResearchOutput(latest.output) : null;
    if (latest && dossier && isFresh(latest, now)) return { analysisId: latest.id, reused: true, dossier, isMock: latest.isMock };
  }

  // What the filings say: anchors the web search and is stored as evidence.
  const b = new EvidenceBuilder();
  const { facts } = await corpus((sql) => addFunderEvidence(b, sql, input.orgId));
  const items = b.items.filter((i) => i.kind !== "similar");
  const applicant = await wu(ctx.userId, (sql) => loadApplicant(sql, ctx.workspaceId));
  const applicantLine = applicant
    ? clip([applicant.name, applicant.profile.mission ? `mission: ${applicant.profile.mission}` : null, applicant.profile.state ? `state ${applicant.profile.state}` : null].filter(Boolean).join("; "), 400)
    : null;
  const fingerprint = fingerprintOf({ items, promptVersion: RESEARCH_PROMPT_VERSION, model });

  return meter(
    { userId: ctx.userId, workspaceId: ctx.workspaceId, feature: "research", meta: { org_id: input.orgId, prompt_version: RESEARCH_PROMPT_VERSION } },
    async (ai, reservation) => {
      const notes = await researchNotes(ai, { funderName: facts.name, filingsFacts: renderPackage(items), applicantLine, userId: ctx.userId });
      const structured = await structureNotes(ai, notes.text, { funderName: facts.name, items }, ctx.userId);
      const usage = addUsage(notes.usage, structured.usage);
      const dossier: ResearchOutput = {
        ...structured.dossier,
        schemaVersion: RESEARCH_SCHEMA_VERSION,
        orgId: input.orgId,
        promptVersion: RESEARCH_PROMPT_VERSION,
        model: usage.model || model,
        generatedAt: now.toISOString(),
        mock: ai.mode === "mock",
      };
      const analysisId = await wu(ctx.userId, (sql) =>
        insertAnalysis(sql, {
          workspaceId: ctx.workspaceId,
          savedFunderId: input.savedFunderId ?? null,
          orgId: input.orgId,
          kind: "research",
          model: dossier.model,
          promptVersion: RESEARCH_PROMPT_VERSION,
          inputFingerprint: fingerprint,
          evidence: { items, notes: clip(notes.text, 20_000) },
          output: dossier,
          score: null,
          rating: null,
          isMock: ai.mode === "mock",
          usageLedgerId: reservation.ledgerId,
          createdBy: ctx.userId,
        }),
      );
      return { result: { analysisId, reused: false, dossier, isMock: ai.mode === "mock" } satisfies RunResearchResult, usage };
    },
    deps,
  );
}

export type LatestResearch = { row: AnalysisRow; dossier: ResearchOutput };

/** The latest dossier for one funder in the caller's workspace (mock or real namespace, matching the AI mode). */
export async function getLatestResearch(ctx: ResearchContext, orgId: string, deps: Pick<ResearchDeps, "withUser" | "env"> = {}): Promise<LatestResearch | null> {
  const id = z.uuid().parse(orgId);
  const { isMock } = modelTag(deps.env ?? process.env);
  const wu = deps.withUser ?? withUser;
  const row = await wu(ctx.userId, (sql) => latestAnalysis(sql, { workspaceId: ctx.workspaceId, orgId: id, kind: "research", isMock }));
  if (!row) return null;
  const dossier = readResearchOutput(row.output);
  return dossier ? { row, dossier } : null;
}
