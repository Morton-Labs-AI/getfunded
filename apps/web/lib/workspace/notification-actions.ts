"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DbError } from "@/lib/db/app";
import { requireWorkspace } from "@/lib/workspace/context";

import {
  dismissNotification,
  markNotificationsRead,
  markReadSchema,
  preferencesSchema,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "./notifications";
import type { WorkspaceCtx } from "./types";

/**
 * Server Actions for notifications. Same contract as lib/workspace/actions.ts:
 * zod in, `requireWorkspace()` for the session and membership, `withUser()`
 * (inside the data module) for RLS, revalidate, plain result out.
 */

type Failure = { ok: false; code: string; message: string };

async function context(): Promise<WorkspaceCtx> {
  const { user, workspace } = await requireWorkspace();
  return { userId: user.id, workspaceId: workspace.id };
}

function failure(error: unknown): Failure {
  if (error instanceof DbError) return { ok: false, code: error.code, message: error.message };
  return { ok: false, code: "unknown", message: "Something went wrong. Please try again." };
}

function revalidateNotificationViews(): void {
  revalidatePath("/app", "layout");
  revalidatePath("/app/notifications");
}

export async function markNotificationsReadAction(
  input: z.infer<typeof markReadSchema>,
): Promise<{ ok: true; changed: number } | Failure> {
  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid input." };
  try {
    const ctx = await context();
    const changed = await markNotificationsRead(ctx, parsed.data);
    revalidateNotificationViews();
    return { ok: true, changed };
  } catch (error) {
    return failure(error);
  }
}

export async function dismissNotificationAction(id: number): Promise<{ ok: true } | Failure> {
  const parsed = z.number().int().positive().safeParse(id);
  if (!parsed.success) return { ok: false, code: "invalid", message: "Invalid notification." };
  try {
    const ctx = await context();
    await dismissNotification(ctx, parsed.data);
    revalidateNotificationViews();
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export type PreferencesActionState =
  | { ok: false; message?: string; fieldErrors?: Record<string, string> }
  | { ok: true; message: string; prefs: NotificationPreferences };

/** `useActionState` handler for the Settings → Notifications form. */
export async function savePreferencesAction(
  _prev: PreferencesActionState,
  formData: FormData,
): Promise<PreferencesActionState> {
  const raw = {
    signalAlerts: formData.get("signalAlerts") === "on",
    discoveryAlerts: formData.get("discoveryAlerts") === "on",
    minScore: Number(formData.get("minScore") ?? 50),
    emailDigest: String(formData.get("emailDigest") ?? "off"),
  };
  const parsed = preferencesSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.map(String).join(".")] = issue.message;
    return { ok: false, message: "Check the highlighted fields.", fieldErrors };
  }
  try {
    const ctx = await context();
    const prefs = await saveNotificationPreferences(ctx, parsed.data);
    revalidatePath("/app/settings/notifications");
    return { ok: true, message: "Saved.", prefs };
  } catch (error) {
    return failure(error);
  }
}
