"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DbError } from "@/lib/db/app";
import { requireWorkspace, type Workspace } from "@/lib/workspace/context";

import { logActivity, logActivitySchema } from "./activities";
import { addContact, addContactSchema, deleteContact } from "./contacts";
import { buildSavedCsv, exportFilename, exportLimitFor } from "./export";
import { runImport, runImportSchema, type RunImportResult } from "./imports";
import { createKnowledge, createKnowledgeSchema, deleteKnowledge, setKnowledgeApproved } from "./knowledge";
import {
  addToCollection,
  archiveSavedFunder,
  bulkMoveStage,
  createCollection,
  getWorkspacePlan,
  listSaved,
  moveStage,
  saveFunder,
  savedPatchSchema,
  snapshotSchema,
  stageSchema,
  tierSchema,
  updateSavedFunder,
  type CreateCollectionResult,
  type EditResult,
  type SaveResult,
} from "./saved";
import { createTask, createTaskSchema, setTaskStatus } from "./tasks";
import type { SavedFilters, WorkspaceCtx } from "./types";

/**
 * Server Actions for the signed-in workspace.
 *
 * Every action:
 *  1. parses its input with zod (nothing from the browser is trusted as-is);
 *  2. calls `requireWorkspace()`, which verifies the session, provisions the
 *     account and re-checks membership with `getfunded.is_member()`;
 *  3. runs the write inside `withUser()` so Row Level Security applies on top;
 *  4. revalidates the workspace routes so the next render is fresh.
 *
 * Next.js enforces same-origin for Server Actions (an action POST from
 * another origin is refused before this code runs), which is the
 * `assertSameOrigin` equivalent for route handlers.
 *
 * Results are plain objects, never thrown, except for the sign-in redirect
 * that `requireWorkspace()` raises when the session is gone.
 */

type Failure = { ok: false; code: string; message: string; upgradeUrl?: string };

const UPGRADE_URL = "/app/settings/billing";

async function context(): Promise<{ ctx: WorkspaceCtx; workspace: Workspace }> {
  const { user, workspace } = await requireWorkspace();
  return { ctx: { userId: user.id, workspaceId: workspace.id }, workspace };
}

function touch() {
  revalidatePath("/app", "layout");
}

function fail(error: unknown, fallback: string): Failure {
  if (error instanceof DbError) {
    if (error.code === "forbidden") return { ok: false, code: "forbidden", message: "You do not have permission to do that here." };
    if (error.code === "timeout") return { ok: false, code: "timeout", message: "That took too long. Try again in a moment." };
  }
  console.error("[workspace action]", error instanceof Error ? error.message : error);
  return { ok: false, code: "unknown", message: fallback };
}

function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}

/* ------------------------------------------------------------------- save */

const saveInput = z.object({
  snapshot: snapshotSchema,
  sourceDetail: z.string().trim().max(2000).nullable().optional(),
});

export async function saveFunderAction(input: z.input<typeof saveInput>): Promise<SaveResult> {
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: "That funder record is incomplete." };
  const { ctx } = await context();
  try {
    const result = await saveFunder(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not save that funder. Try again in a moment.");
    return { ok: false, code: f.code === "forbidden" ? "forbidden" : "unknown", message: f.message };
  }
}

/* ------------------------------------------------------------------ edits */

const updateInput = z.object({ id: z.uuid(), version: z.number().int().positive(), patch: savedPatchSchema });

export async function updateSavedFunderAction(input: z.input<typeof updateInput>): Promise<EditResult> {
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: firstIssue(parsed.error, "Check the value and try again.") };
  const { ctx } = await context();
  try {
    const result = await updateSavedFunder(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not save that change. Try again in a moment.");
    return { ok: false, code: "forbidden", message: f.message };
  }
}

const moveInput = z.object({
  id: z.uuid(),
  stage: stageSchema,
  expectedVersion: z.number().int().positive().nullable(),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function moveStageAction(input: z.input<typeof moveInput>): Promise<EditResult> {
  const parsed = moveInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: firstIssue(parsed.error, "That stage is not one of the pipeline stages.") };
  const { ctx } = await context();
  try {
    const result = await moveStage(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not move that funder. Try again in a moment.");
    return { ok: false, code: "forbidden", message: f.message };
  }
}

const bulkStageInput = z.object({ ids: z.array(z.uuid()).min(1).max(500), stage: stageSchema });

export async function bulkMoveStageAction(
  input: z.input<typeof bulkStageInput>,
): Promise<{ ok: true; moved: number; failed: number } | Failure> {
  const parsed = bulkStageInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: "Pick at least one funder and a stage." };
  const { ctx } = await context();
  try {
    const r = await bulkMoveStage(ctx, parsed.data);
    touch();
    return { ok: true, ...r };
  } catch (error) {
    return fail(error, "We could not move those funders. Try again in a moment.");
  }
}

const bulkPatchInput = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  patch: z.object({ tier: tierSchema.nullable().optional(), ownerId: z.uuid().nullable().optional() }).strict(),
});

/** Bulk tier/owner: one CAS-free update per row (the list page has no per-row version for a bulk apply). */
export async function bulkUpdateSavedAction(
  input: z.input<typeof bulkPatchInput>,
): Promise<{ ok: true; updated: number } | Failure> {
  const parsed = bulkPatchInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: "Pick at least one funder and something to change." };
  const { ctx } = await context();
  let updated = 0;
  try {
    const rows = await listSaved(ctx);
    const wanted = new Set(parsed.data.ids);
    for (const row of rows) {
      if (!wanted.has(row.id)) continue;
      const r = await updateSavedFunder(ctx, { id: row.id, version: row.version, patch: parsed.data.patch });
      if (r.ok) updated += 1;
    }
    touch();
    return { ok: true, updated };
  } catch (error) {
    return fail(error, "We could not update those funders. Try again in a moment.");
  }
}

const archiveInput = z.object({ id: z.uuid(), version: z.number().int().positive() });

export async function archiveSavedFunderAction(input: z.input<typeof archiveInput>): Promise<EditResult> {
  const parsed = archiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: "That funder could not be found." };
  const { ctx } = await context();
  try {
    const result = await archiveSavedFunder(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not archive that funder. Try again in a moment.");
    return { ok: false, code: "forbidden", message: f.message };
  }
}

/* ------------------------------------------------------------ collections */

const createCollectionInput = z.object({
  name: z.string().trim().min(1, "Give the list a name.").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  savedFunderIds: z.array(z.uuid()).max(500).optional(),
});

export async function createCollectionAction(input: z.input<typeof createCollectionInput>): Promise<CreateCollectionResult> {
  const parsed = createCollectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: firstIssue(parsed.error, "Give the list a name.") };
  const { ctx } = await context();
  try {
    const result = await createCollection(ctx, parsed.data);
    if (result.ok && parsed.data.savedFunderIds?.length) {
      await addToCollection(ctx, { collectionId: result.id, savedFunderIds: parsed.data.savedFunderIds });
    }
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not make that list. Try again in a moment.");
    return { ok: false, code: "forbidden", message: f.message };
  }
}

const addToCollectionInput = z.object({ collectionId: z.uuid(), savedFunderIds: z.array(z.uuid()).min(1).max(500) });

export async function addToCollectionAction(
  input: z.input<typeof addToCollectionInput>,
): Promise<{ ok: true; added: number } | Failure> {
  const parsed = addToCollectionInput.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: "Pick a list and at least one funder." };
  const { ctx } = await context();
  try {
    const r = await addToCollection(ctx, parsed.data);
    touch();
    return { ok: true, added: r.added };
  } catch (error) {
    return fail(error, "We could not add those funders to the list. Try again in a moment.");
  }
}

/* ----------------------------------------------------------------- export */

const exportInput = z.object({
  q: z.string().trim().max(200).optional(),
  stage: stageSchema.optional(),
  ownerId: z.uuid().optional(),
  tier: tierSchema.optional(),
  collectionId: z.uuid().optional(),
});

export type ExportActionResult =
  | { ok: true; csv: string; filename: string; rows: number; total: number; truncated: boolean; limit: number | null }
  | Failure;

/** CSV of the current list view, capped at the plan's export rows (Free: 100). */
export async function exportSavedCsvAction(input: z.input<typeof exportInput>): Promise<ExportActionResult> {
  const parsed = exportInput.safeParse(input ?? {});
  if (!parsed.success) return { ok: false, code: "invalid", message: "Those filters are not valid." };
  const { ctx } = await context();
  try {
    const plan = await getWorkspacePlan(ctx);
    const limit = exportLimitFor(plan);
    if (limit === 0) return { ok: false, code: "plan", message: "Your plan does not include CSV export.", upgradeUrl: UPGRADE_URL };
    const filters: SavedFilters = { ...parsed.data, sort: "name" };
    const rows = await listSaved(ctx, filters);
    const result = buildSavedCsv(rows, { limit });
    return { ok: true, filename: exportFilename(), ...result };
  } catch (error) {
    return fail(error, "We could not build the export. Try again in a moment.");
  }
}

/* ------------------------------------------------------------------ tasks */

export async function createTaskAction(input: z.input<typeof createTaskSchema>) {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: firstIssue(parsed.error, "Check the task and try again.") };
  const { ctx } = await context();
  try {
    const result = await createTask(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not add that task. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

const taskStatusInput = z.object({ id: z.uuid(), version: z.number().int().positive(), status: z.enum(["open", "done", "canceled"]) });

export async function setTaskStatusAction(input: z.input<typeof taskStatusInput>) {
  const parsed = taskStatusInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: "That task could not be found." };
  const { ctx } = await context();
  try {
    const result = await setTaskStatus(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not update that task. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

/* ------------------------------------------------------------- activities */

export async function logActivityAction(input: z.input<typeof logActivitySchema>) {
  const parsed = logActivitySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: firstIssue(parsed.error, "Check the entry and try again.") };
  const { ctx } = await context();
  try {
    const result = await logActivity(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not log that. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

/* --------------------------------------------------------------- contacts */

export async function addContactAction(input: z.input<typeof addContactSchema>) {
  const parsed = addContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: firstIssue(parsed.error, "Check the contact and try again.") };
  const { ctx } = await context();
  try {
    const result = await addContact(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not add that contact. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

export async function deleteContactAction(input: { id: string }) {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: "That contact could not be found." };
  const { ctx } = await context();
  try {
    const result = await deleteContact(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not remove that contact. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

/* -------------------------------------------------------------- knowledge */

export async function createKnowledgeAction(input: z.input<typeof createKnowledgeSchema>) {
  const parsed = createKnowledgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: firstIssue(parsed.error, "Check the entry and try again.") };
  const { ctx } = await context();
  try {
    const result = await createKnowledge(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not add that. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

const approveInput = z.object({ id: z.uuid(), version: z.number().int().positive(), approved: z.boolean() });

/** Admin-only: the policy lets any member update, so the role check lives here. */
export async function setKnowledgeApprovedAction(input: z.input<typeof approveInput>) {
  const parsed = approveInput.safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: "That item could not be found." };
  const { ctx, workspace } = await context();
  if (workspace.role === "member") {
    return { ok: false as const, code: "forbidden" as const, message: "Only a workspace owner or admin can approve knowledge." };
  }
  try {
    const result = await setKnowledgeApproved(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not change that. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

export async function deleteKnowledgeAction(input: { id: string }) {
  const parsed = z.object({ id: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false as const, code: "invalid" as const, message: "That item could not be found." };
  const { ctx, workspace } = await context();
  if (workspace.role === "member") {
    return { ok: false as const, code: "forbidden" as const, message: "Only a workspace owner or admin can remove knowledge." };
  }
  try {
    const result = await deleteKnowledge(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "We could not remove that. Try again in a moment.");
    return { ok: false as const, code: "forbidden" as const, message: f.message };
  }
}

/* ----------------------------------------------------------------- import */

export async function runImportAction(input: z.input<typeof runImportSchema>): Promise<RunImportResult> {
  const parsed = runImportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: firstIssue(parsed.error, "Check the file and try again.") };
  const { ctx } = await context();
  try {
    const result = await runImport(ctx, parsed.data);
    if (result.ok) touch();
    return result;
  } catch (error) {
    const f = fail(error, "The import did not finish. Nothing was changed. Try again in a moment.");
    return { ok: false, code: "forbidden", message: f.message };
  }
}
