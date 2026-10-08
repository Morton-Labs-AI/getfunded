"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { DbError, withUser } from "@/lib/db/app";
import { PLANS, isPlanId } from "@/lib/plans";

import { flagsFormSchema, flagsToRows } from "./flags";
import { stewardOrNull } from "./gate";

/**
 * Steward mutations (Server Actions). Each one re-checks the steward gate,
 * validates with zod, writes under the steward's own user id (the steward
 * policies in 0007/0009 admit the write), records an event, and refreshes
 * the admin pages. Next.js already refuses cross-origin action requests.
 */

export type ActionState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

const NOT_ALLOWED: ActionState = { ok: false, message: "You are not allowed to do this." };

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "form";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

function failureMessage(err: unknown): string {
  if (DbError.is(err, "forbidden")) return "The database refused this change. Your steward flag may not be set yet.";
  if (DbError.is(err)) return err.message;
  return "Something went wrong. Try again.";
}

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** "" → null, otherwise a non-negative integer. */
const optionalInt = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/[,\s]/g, ""))
    .refine((v) => v === "" || /^\d{1,9}$/.test(v), { message: `${label} must be a whole number, or empty for the plan default.` })
    .transform((v) => (v === "" ? null : Number(v)));

const overrideSchema = z.object({
  workspace_id: z.uuid(),
  monthly_credits: optionalInt("Monthly credits"),
  members: optionalInt("Members"),
  note: z.string().trim().max(500, "Keep the note under 500 characters."),
});

/** Set (or update) a plan override for a workspace. Empty fields mean "plan default". */
export async function savePlanOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const steward = await stewardOrNull();
  if (!steward) return NOT_ALLOWED;

  const parsed = overrideSchema.safeParse({
    workspace_id: text(formData, "workspace_id"),
    monthly_credits: text(formData, "monthly_credits"),
    members: text(formData, "members"),
    note: text(formData, "note"),
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const { workspace_id, monthly_credits, members, note } = parsed.data;

  if (monthly_credits === null && members === null && note === "") {
    return clearPlanOverride(_prev, formData);
  }

  try {
    await withUser(steward.user.id, async (sql) => {
      await sql`
        insert into getfunded.plan_overrides (workspace_id, monthly_credits, members, note, set_by)
        values (${workspace_id}::uuid, ${monthly_credits}, ${members}, ${note || null}, ${steward.user.id}::uuid)
        on conflict (workspace_id) do update set
          monthly_credits = excluded.monthly_credits,
          members         = excluded.members,
          note            = excluded.note,
          set_by          = excluded.set_by`;
      await sql`
        insert into getfunded.events (user_id, name, props)
        values (${steward.user.id}::uuid, 'steward:plan_override',
                ${sql.json({ workspace_id, monthly_credits, members, has_note: note !== "" } as never)}::jsonb)`;
    });
  } catch (err) {
    return { ok: false, message: failureMessage(err) };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Override saved. It applies to the next AI call." };
}

/** Remove a workspace's override so the plan's own limits apply again. */
export async function clearPlanOverride(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const steward = await stewardOrNull();
  if (!steward) return NOT_ALLOWED;
  const id = z.uuid().safeParse(text(formData, "workspace_id"));
  if (!id.success) return { ok: false, message: "That workspace id is not valid." };
  try {
    await withUser(steward.user.id, async (sql) => {
      await sql`delete from getfunded.plan_overrides where workspace_id = ${id.data}::uuid`;
      await sql`
        insert into getfunded.events (user_id, name, props)
        values (${steward.user.id}::uuid, 'steward:plan_override_cleared', ${sql.json({ workspace_id: id.data } as never)}::jsonb)`;
    });
  } catch (err) {
    return { ok: false, message: failureMessage(err) };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Override removed. The plan's own limits apply." };
}

const stewardSchema = z.object({
  user_id: z.uuid(),
  is_steward: z.enum(["true", "false"]).transform((v) => v === "true"),
});

/** Grant or remove steward access for a user (through the set_steward door). */
export async function setStewardAccess(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const steward = await stewardOrNull();
  if (!steward) return NOT_ALLOWED;
  const parsed = stewardSchema.safeParse({ user_id: text(formData, "user_id"), is_steward: text(formData, "is_steward") });
  if (!parsed.success) return { ok: false, message: "That request is not valid." };
  try {
    await withUser(steward.user.id, async (sql) => {
      await sql`select getfunded.set_steward(${parsed.data.user_id}::uuid, ${parsed.data.is_steward})`;
    });
  } catch (err) {
    if (err instanceof Error && /steward_self_demote/.test(err.message)) {
      return { ok: false, message: "You cannot remove your own steward access. Ask another steward." };
    }
    if (err instanceof Error && /user_not_found/.test(err.message)) {
      return { ok: false, message: "That user no longer exists." };
    }
    return { ok: false, message: failureMessage(err) };
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: parsed.data.is_steward ? "Steward access granted." : "Steward access removed." };
}

/** Save the kill switch, the sign-up mode and the banner. */
export async function saveFlags(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const steward = await stewardOrNull();
  if (!steward) return NOT_ALLOWED;
  const parsed = flagsFormSchema.safeParse({
    ai_enabled: formData.get("ai_enabled") === "on" || formData.get("ai_enabled") === "true",
    signup_mode: text(formData, "signup_mode"),
    banner_text: text(formData, "banner_text"),
    banner_href: text(formData, "banner_href"),
    banner_tone: text(formData, "banner_tone") || "info",
  });
  if (!parsed.success) return { ok: false, message: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };

  const rows = flagsToRows(parsed.data);
  try {
    await withUser(steward.user.id, async (sql) => {
      for (const row of rows) {
        await sql`
          insert into getfunded.flags (key, value, updated_by)
          values (${row.key}, ${sql.json(row.value as never)}::jsonb, ${steward.user.id}::uuid)
          on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`;
      }
      await sql`
        insert into getfunded.events (user_id, name, props)
        values (${steward.user.id}::uuid, 'steward:flags',
                ${sql.json({ ai_enabled: parsed.data.ai_enabled, signup_mode: parsed.data.signup_mode, banner: parsed.data.banner_text !== "" } as never)}::jsonb)`;
    });
  } catch (err) {
    return { ok: false, message: failureMessage(err) };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: "Flags saved. The banner and sign-up mode apply right away; the AI switch applies to the next call." };
}

/** Plan defaults for the override form (so the UI can say what "empty" means). */
export async function planDefaults(plan: string): Promise<{ monthly_credits: number | null; members: number | null }> {
  const def = PLANS[isPlanId(plan) ? plan : "free"];
  return { monthly_credits: def.monthly_credits, members: def.members };
}
