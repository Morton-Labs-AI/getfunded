import "server-only";
/**
 * Reads and appends for `getfunded.ai_analyses` and `getfunded.ai_feedback`.
 * Both tables are append-only for the app role (INSERT + SELECT); the latest
 * pointer flips through the `mark_latest_analysis()` door, which keeps one
 * latest row per (workspace, org, kind, is_mock). Mock output lives in its own
 * namespace and is never handed to a real request.
 *
 * Every function takes the transaction handle `withUser()` provides, so the
 * caller decides the transaction boundary and RLS applies.
 */
import type { Db } from "@/lib/billing/db";
import { AnalysisNotFoundError } from "./http";

export type AnalysisKind = "fit" | "research" | "summary";
export type FeedbackVerdict = "accepted" | "edited" | "dismissed";

export type AnalysisRow = {
  id: string;
  workspaceId: string;
  savedFunderId: string | null;
  orgId: string;
  kind: AnalysisKind;
  model: string;
  promptVersion: string;
  weightsVersion: string | null;
  inputFingerprint: string;
  evidence: unknown;
  output: unknown;
  score: number | null;
  rating: string | null;
  isLatest: boolean;
  isMock: boolean;
  usageLedgerId: string | null;
  createdBy: string | null;
  createdAt: string;
};

type RawRow = {
  id: string;
  workspace_id: string;
  saved_funder_id: string | null;
  org_id: string;
  kind: string;
  model: string;
  prompt_version: string;
  weights_version: string | null;
  input_fingerprint: string;
  evidence: unknown;
  output: unknown;
  score: string | number | null;
  rating: string | null;
  is_latest: boolean;
  is_mock: boolean;
  usage_ledger_id: string | number | null;
  created_by: string | null;
  created_at: string | Date;
};

function toRow(r: RawRow): AnalysisRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    savedFunderId: r.saved_funder_id,
    orgId: r.org_id,
    kind: r.kind as AnalysisKind,
    model: r.model,
    promptVersion: r.prompt_version,
    weightsVersion: r.weights_version,
    inputFingerprint: r.input_fingerprint,
    evidence: r.evidence,
    output: r.output,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    rating: r.rating,
    isLatest: Boolean(r.is_latest),
    isMock: Boolean(r.is_mock),
    usageLedgerId: r.usage_ledger_id === null || r.usage_ledger_id === undefined ? null : String(r.usage_ledger_id),
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

export type InsertAnalysisInput = {
  workspaceId: string;
  savedFunderId?: string | null;
  orgId: string;
  kind: AnalysisKind;
  model: string;
  promptVersion: string;
  weightsVersion?: string | null;
  inputFingerprint: string;
  evidence: unknown;
  output: unknown;
  score?: number | null;
  rating?: string | null;
  isMock: boolean;
  usageLedgerId?: string | null;
  createdBy: string;
};

/** Append one analysis and make it the latest of its (workspace, org, kind, is_mock). Returns the id. */
export async function insertAnalysis(sql: Db, input: InsertAnalysisInput): Promise<string> {
  const rows = await sql`
    insert into getfunded.ai_analyses
      (workspace_id, saved_funder_id, org_id, kind, model, prompt_version, weights_version,
       input_fingerprint, evidence, output, score, rating, is_mock, usage_ledger_id, created_by)
    values
      (${input.workspaceId}::uuid, ${input.savedFunderId ?? null}, ${input.orgId}::uuid, ${input.kind},
       ${input.model}, ${input.promptVersion}, ${input.weightsVersion ?? null}, ${input.inputFingerprint},
       ${sql.json(input.evidence as never)}::jsonb, ${sql.json(input.output as never)}::jsonb,
       ${input.score ?? null}, ${input.rating ?? null}, ${input.isMock}, ${input.usageLedgerId ?? null},
       ${input.createdBy}::uuid)
    returning id`;
  const id = String((rows[0] as { id?: unknown } | undefined)?.id ?? "");
  if (!id) throw new Error("ai_analyses insert returned no id");
  await sql`select getfunded.mark_latest_analysis(${id}::uuid)`;
  return id;
}

/** The latest analysis of one kind for one org in one workspace, in the mock or real namespace. */
export async function latestAnalysis(
  sql: Db,
  q: { workspaceId: string; orgId: string; kind: AnalysisKind; isMock: boolean },
): Promise<AnalysisRow | null> {
  const rows = await sql`
    select id, workspace_id, saved_funder_id, org_id, kind, model, prompt_version, weights_version,
           input_fingerprint, evidence, output, score, rating, is_latest, is_mock, usage_ledger_id, created_by, created_at
    from getfunded.ai_analyses
    where workspace_id = ${q.workspaceId}::uuid and org_id = ${q.orgId}::uuid
      and kind = ${q.kind} and is_mock = ${q.isMock} and is_latest
    order by created_at desc
    limit 1`;
  const r = rows[0] as RawRow | undefined;
  return r ? toRow(r) : null;
}

export async function analysisById(sql: Db, id: string): Promise<AnalysisRow | null> {
  const rows = await sql`
    select id, workspace_id, saved_funder_id, org_id, kind, model, prompt_version, weights_version,
           input_fingerprint, evidence, output, score, rating, is_latest, is_mock, usage_ledger_id, created_by, created_at
    from getfunded.ai_analyses
    where id = ${id}::uuid
    limit 1`;
  const r = rows[0] as RawRow | undefined;
  return r ? toRow(r) : null;
}

export type FeedbackRow = { id: string; verdict: FeedbackVerdict; createdBy: string | null; createdAt: string };

/** The most recent verdict a member recorded on an analysis, if any. */
export async function latestFeedback(sql: Db, analysisId: string): Promise<FeedbackRow | null> {
  const rows = await sql`
    select id, verdict, created_by, created_at
    from getfunded.ai_feedback
    where analysis_id = ${analysisId}::uuid
    order by created_at desc, id desc
    limit 1`;
  const r = rows[0] as { id: unknown; verdict: string; created_by: string | null; created_at: string | Date } | undefined;
  if (!r) return null;
  return {
    id: String(r.id),
    verdict: r.verdict as FeedbackVerdict,
    createdBy: r.created_by,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

/**
 * Append a verdict. The analysis must be visible to the caller (RLS) and
 * belong to the workspace named, or the insert is refused.
 */
export async function insertFeedback(
  sql: Db,
  input: { analysisId: string; workspaceId: string; verdict: FeedbackVerdict; editedOutput?: unknown; createdBy: string },
): Promise<string> {
  const analysis = await analysisById(sql, input.analysisId);
  if (!analysis || analysis.workspaceId !== input.workspaceId) throw new AnalysisNotFoundError();
  const rows = await sql`
    insert into getfunded.ai_feedback (analysis_id, workspace_id, verdict, edited_output, created_by)
    values (${input.analysisId}::uuid, ${input.workspaceId}::uuid, ${input.verdict},
            ${input.editedOutput === undefined ? null : sql.json(input.editedOutput as never)}, ${input.createdBy}::uuid)
    returning id`;
  return String((rows[0] as { id?: unknown } | undefined)?.id ?? "");
}
