"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { US_STATES } from "@/components/auth/us-states";
import { safeNextPath } from "@/lib/auth/next-path";
import { DbError, withUser } from "@/lib/db/app";
import { requireWorkspace, type WorkspaceProfile } from "@/lib/workspace/context";

/**
 * Onboarding: write the workspace name and `workspaces.profile` once, with a
 * compare-and-swap on `version`. Every field is optional except the name, and
 * every field can be changed later in Settings.
 */

export type OnboardingState = {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
};

const PROFILE_KEYS = [
  "mission",
  "ein",
  "website",
  "state",
  "counties",
  "program_areas",
  "annual_budget",
  "populations_served",
  "keywords",
] as const;

/** "a, b\nc" → ["a", "b", "c"]; empty → []. */
const listField = z
  .string()
  .trim()
  .max(4000, "That list is too long.")
  .transform((value) =>
    Array.from(
      new Set(
        value
          .split(/[,\n;]/)
          .map((item) => item.trim().slice(0, 120))
          .filter((item) => item.length > 0),
      ),
    ).slice(0, 100),
  );

const einField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((digits) => digits.length === 0 || digits.length === 9, {
    message: "An EIN has 9 digits, like 12-3456789.",
  });

const websiteField = z
  .string()
  .trim()
  .max(500, "That address is too long.")
  .transform((value, ctx) => {
    if (value.length === 0) return "";
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const url = new URL(candidate);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("scheme");
      return url.toString().replace(/\/$/, "");
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter a web address like https://example.org." });
      return z.NEVER;
    }
  });

const stateField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => (value === "NONE" ? "" : value))
  .refine((value) => value === "" || (US_STATES as readonly string[]).includes(value), {
    message: "Choose a state from the list.",
  });

const budgetField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (cleaned.length === 0) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter a whole-dollar amount, like 250000." });
      return z.NEVER;
    }
    return Math.round(n);
  });

const formSchema = z.object({
  workspace_id: z.uuid(),
  version: z.coerce.number().int().positive(),
  next: z.string().max(2048).optional(),
  name: z
    .string()
    .trim()
    .min(2, "Give your organization a name of at least 2 characters.")
    .max(120, "Keep the name under 120 characters."),
  mission: z.string().trim().max(2000, "Keep the mission under 2,000 characters."),
  ein: einField,
  website: websiteField,
  state: stateField,
  counties: listField,
  program_areas: listField,
  annual_budget: budgetField,
  populations_served: listField,
  keywords: listField,
});

type Parsed = z.infer<typeof formSchema>;

/** Merge the form into the stored profile; a cleared field removes its key. */
function mergeProfile(existing: WorkspaceProfile, form: Parsed): WorkspaceProfile {
  const next: Record<string, unknown> = { ...existing };
  const values: Record<(typeof PROFILE_KEYS)[number], unknown> = {
    mission: form.mission,
    ein: form.ein,
    website: form.website,
    state: form.state,
    counties: form.counties,
    program_areas: form.program_areas,
    annual_budget: form.annual_budget,
    populations_served: form.populations_served,
    keywords: form.keywords,
  };
  for (const key of PROFILE_KEYS) {
    const value = values[key];
    const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
    else next[key] = value;
  }
  return next as WorkspaceProfile;
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export async function saveOnboarding(_previous: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    raw[key] = typeof value === "string" ? value : "";
  }

  const parsed = formSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const form = parsed.data;

  const { user, workspace } = await requireWorkspace();
  if (workspace.id !== form.workspace_id) {
    return { ok: false, error: "This form belongs to a different workspace. Reload the page and try again." };
  }
  if (workspace.role === "member") {
    return { ok: false, error: "Only a workspace owner or admin can change the organization profile." };
  }

  const profile = mergeProfile(workspace.profile, form);

  let updated = 0;
  try {
    updated = await withUser(user.id, async (sql) => {
      const rows = await sql<{ version: number }[]>`
        update getfunded.workspaces
        set name = ${form.name}, profile = ${JSON.stringify(profile)}::jsonb, version = version + 1
        where id = ${workspace.id}::uuid and version = ${form.version} and deleted_at is null
        returning version`;
      return rows.length;
    });
  } catch (caught) {
    if (DbError.is(caught, "forbidden")) {
      return { ok: false, error: "You do not have permission to change this workspace." };
    }
    console.error("[welcome] save failed", caught instanceof Error ? caught.message : caught);
    return { ok: false, error: "We could not save your profile. Try again in a moment." };
  }

  if (updated === 0) {
    return { ok: false, error: "This profile was changed somewhere else. Reload the page and try again." };
  }

  redirect(safeNextPath(form.next));
}
