"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { aiMode } from "@/lib/ai/client";
import { AiDisabledError, QuotaExceededError } from "@/lib/billing/meter";
import { DbError } from "@/lib/db/app";
import { copyFilingContact, createContact, deleteContact, updateContact } from "@/lib/outreach/contacts";
import { deleteWorkspaceTemplate, saveWorkspaceTemplate } from "@/lib/outreach/boilerplate";
import { getFilingChannels, getFunder, polishDraft } from "@/lib/outreach/deps";
import { getSavedFunderOption } from "@/lib/outreach/funders";
import { outreachAbilities } from "@/lib/outreach/gate";
import {
  approveMessage,
  cancelMessage,
  createFollowUp,
  latestDossier,
  recordByHand,
  recordReplyByHand,
  reopenMessage,
  retryMessage,
  saveDraft,
  type MoveResult,
} from "@/lib/outreach/messages";
import { sendableIdentities, updateDailyCap } from "@/lib/outreach/senders";
import { addSuppression, removeSuppression } from "@/lib/outreach/suppressions";
import {
  boilerplateInputSchema,
  contactInputSchema,
  contactUpdateSchema,
  dailyCapSchema,
  draftInputSchema,
  messageRefSchema,
  recordByHandSchema,
  recordReplySchema,
  suppressionInputSchema,
  uuid,
} from "@/lib/outreach/types";
import { requireWorkspace } from "@/lib/workspace/context";

/**
 * Every outreach mutation, as a Server Action. Each one: requires the signed-in
 * user and their active workspace, parses its input with zod, runs under RLS
 * through withUser(), and returns a small plain result the UI can show.
 * Next.js checks the Origin header on every action; nothing here trusts a
 * workspace id from the client.
 */

export type ActionResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

const OUTREACH = "/app/outreach";

function friendly(error: unknown): string {
  if (error instanceof DbError) {
    if (error.code === "forbidden") return "You do not have permission to do that in this workspace.";
    if (error.code === "conflict") return "That already exists.";
    if (error.code === "timeout") return "The database took too long. Try again.";
  }
  if (error instanceof QuotaExceededError) {
    return `This workspace has used its AI credits for the ${error.scope === "daily" ? "day" : "month"}. Polishing is paused; plain drafts still work.`;
  }
  if (error instanceof AiDisabledError) return "AI features are turned off right now. Plain drafts still work.";
  console.error("[outreach/action]", error instanceof Error ? `${error.name}: ${error.message}` : error);
  return "Something went wrong. Try again in a moment.";
}

function parse<T>(schema: z.ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
}

async function caller() {
  const { user, workspace } = await requireWorkspace();
  return { user, workspace, ctx: { userId: user.id, workspaceId: workspace.id } };
}

function moveToResult(r: MoveResult): ActionResult<{ id: string; version: number; status: string }> {
  return r.ok ? { ok: true, id: r.id, version: r.version, status: r.status } : r;
}

/* ----------------------------------------------------------------------------
   Drafts and messages
---------------------------------------------------------------------------- */

export async function saveDraftAction(input: unknown): Promise<ActionResult<{ id: string; version: number; status: string }>> {
  const parsed = parse(draftInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const result = await saveDraft(ctx, parsed.data);
    if (result.ok) {
      revalidatePath(OUTREACH);
      revalidatePath(`${OUTREACH}/${result.id}`);
    }
    return moveToResult(result);
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export type PolishActionResult = ActionResult<{
  subject: string;
  body: string;
  claims: Array<{ text: string; evidenceId: string }>;
  mock: boolean;
}>;

const polishSchema = z.object({
  savedFunderId: uuid,
  subject: z.string().trim().max(300),
  body: z.string().max(20_000).min(1, "Write or generate a draft first."),
});

/** "Polish with AI": metered as 'draft' (2 credits) inside polishDraft(). */
export async function polishDraftAction(input: unknown): Promise<PolishActionResult> {
  const parsed = parse(polishSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx, workspace } = await caller();
    const saved = await getSavedFunderOption(ctx, parsed.data.savedFunderId);
    if (!saved) return { ok: false, error: "That funder is not on your saved list." };
    const funder = await getFunder(saved.orgId);
    if (!funder) return { ok: false, error: "This funder could not be loaded from the database. Try again later." };
    const mock = aiMode() === "mock";
    const dossier = await latestDossier(ctx, saved.orgId, mock);
    const template = `Subject: ${parsed.data.subject}\n\n${parsed.data.body}`;
    const result = await polishDraft(ctx, {
      template,
      funder,
      dossier: dossier ?? undefined,
      orgProfile: { name: workspace.name, ...workspace.profile },
    });
    return { ok: true, subject: result.subject, body: result.body, claims: result.claims, mock };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

const approveSchema = messageRefSchema.extend({ senderIdentityId: uuid.optional() });

/** One person, one message, one click. There is no bulk form of this action. */
export async function approveMessageAction(input: unknown): Promise<ActionResult<{ id: string; version: number; status: string }>> {
  const parsed = parse(approveSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx, workspace } = await caller();
    const abilities = outreachAbilities({ plan: workspace.plan });
    const sendable = abilities.sendGmail ? await sendableIdentities(ctx, workspace.role) : [];
    const result = await approveMessage(ctx, parsed.data, { canSendGmail: abilities.sendGmail, sendable });
    if (result.ok) {
      revalidatePath(OUTREACH);
      revalidatePath(`${OUTREACH}/${result.id}`);
    }
    return moveToResult(result);
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

async function simple(input: unknown, fn: (ctx: { userId: string; workspaceId: string }, id: string, version: number) => Promise<MoveResult>) {
  const parsed = parse(messageRefSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const result = await fn(ctx, parsed.data.id, parsed.data.version);
    if (result.ok) {
      revalidatePath(OUTREACH);
      revalidatePath(`${OUTREACH}/${result.id}`);
    }
    return moveToResult(result);
  } catch (error) {
    return { ok: false, error: friendly(error) } as const;
  }
}

export async function cancelMessageAction(input: unknown) {
  return simple(input, cancelMessage);
}

export async function reopenMessageAction(input: unknown) {
  return simple(input, reopenMessage);
}

export async function retryMessageAction(input: unknown) {
  return simple(input, retryMessage);
}

export async function recordByHandAction(input: unknown): Promise<ActionResult<{ id: string; version: number; status: string }>> {
  const parsed = parse(recordByHandSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const result = await recordByHand(ctx, parsed.data);
    if (result.ok) {
      revalidatePath(OUTREACH);
      revalidatePath(`${OUTREACH}/${result.id}`);
    }
    return moveToResult(result);
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function recordReplyAction(input: unknown): Promise<ActionResult<{ canceled: number }>> {
  const parsed = parse(recordReplySchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const result = await recordReplyByHand(ctx, parsed.data);
    if (result.ok) {
      revalidatePath(OUTREACH);
      revalidatePath(`${OUTREACH}/${parsed.data.id}`);
    }
    return result;
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function createFollowUpAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(z.object({ parentId: uuid }), input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx, user, workspace } = await caller();
    const result = await createFollowUp(ctx, parsed.data.parentId, {
      orgName: workspace.name,
      senderName: user.displayName ?? user.email,
    });
    if (result.ok) revalidatePath(OUTREACH);
    return result.ok ? { ok: true, id: result.id } : result;
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

/* ----------------------------------------------------------------------------
   Contacts
---------------------------------------------------------------------------- */

export async function createContactAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(contactInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const owned = await getSavedFunderOption(ctx, parsed.data.savedFunderId);
    if (!owned) return { ok: false, error: "That funder is not on your saved list." };
    const result = await createContact(ctx, parsed.data);
    if (result.ok) revalidatePath(`${OUTREACH}/new`);
    return result.ok ? { ok: true, id: result.contact.id } : result;
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function updateContactAction(input: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  const parsed = parse(contactUpdateSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const result = await updateContact(ctx, parsed.data);
    if (result.ok) revalidatePath(`${OUTREACH}/new`);
    return result.ok ? { ok: true, id: result.contact.id, version: result.contact.version } : result;
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function deleteContactAction(input: unknown): Promise<ActionResult> {
  const parsed = parse(z.object({ id: uuid }), input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    await deleteContact(ctx, parsed.data.id);
    revalidatePath(`${OUTREACH}/new`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

const useFilingSchema = z.object({
  savedFunderId: uuid,
  channelId: z.string().trim().min(1).max(200),
  label: z.string().trim().max(200).optional(),
});

/** Copy one public, role-based channel from the funder's filing into the workspace. */
export async function useFilingContactAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = parse(useFilingSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const saved = await getSavedFunderOption(ctx, parsed.data.savedFunderId);
    if (!saved) return { ok: false, error: "That funder is not on your saved list." };
    const channels = await getFilingChannels(saved.orgId);
    const channel = channels.find((c) => c.id === parsed.data.channelId);
    if (!channel) return { ok: false, error: "That contact is no longer listed in the funder's public filing." };
    const result = await copyFilingContact(ctx, { savedFunderId: saved.id, channel, label: parsed.data.label });
    if (result.ok) revalidatePath(`${OUTREACH}/new`);
    return result.ok ? { ok: true, id: result.contact.id } : result;
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

/* ----------------------------------------------------------------------------
   Settings: suppressions, daily cap, workspace templates
---------------------------------------------------------------------------- */

export async function addSuppressionAction(input: unknown): Promise<ActionResult<{ value: string }>> {
  const parsed = parse(suppressionInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const result = await addSuppression(ctx, parsed.data);
    if (result.ok) revalidatePath(`${OUTREACH}/settings`);
    return result;
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function removeSuppressionAction(input: unknown): Promise<ActionResult> {
  const parsed = parse(z.object({ kind: z.enum(["email", "domain"]), value: z.string().trim().min(1).max(320) }), input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    await removeSuppression(ctx, parsed.data);
    revalidatePath(`${OUTREACH}/settings`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function updateDailyCapAction(input: unknown): Promise<ActionResult<{ dailyCap: number; version: number }>> {
  const parsed = parse(dailyCapSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const updated = await updateDailyCap(ctx, { id: parsed.data.senderIdentityId, version: parsed.data.version, dailyCap: parsed.data.dailyCap });
    if (!updated) return { ok: false, error: "This mailbox was changed somewhere else. Reload the page and try again." };
    revalidatePath(`${OUTREACH}/settings`);
    return { ok: true, dailyCap: updated.dailyCap, version: updated.version };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function saveTemplateAction(input: unknown): Promise<ActionResult<{ id: string; version: number }>> {
  const parsed = parse(boilerplateInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    const result = await saveWorkspaceTemplate(ctx, parsed.data);
    if (result.ok) {
      revalidatePath(`${OUTREACH}/settings`);
      revalidatePath(`${OUTREACH}/new`);
    }
    return result.ok ? { ok: true, id: result.template.id, version: result.template.version } : result;
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}

export async function deleteTemplateAction(input: unknown): Promise<ActionResult> {
  const parsed = parse(z.object({ id: uuid }), input);
  if (!parsed.ok) return parsed;
  try {
    const { ctx } = await caller();
    await deleteWorkspaceTemplate(ctx, parsed.data.id);
    revalidatePath(`${OUTREACH}/settings`);
    revalidatePath(`${OUTREACH}/new`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: friendly(error) };
  }
}
