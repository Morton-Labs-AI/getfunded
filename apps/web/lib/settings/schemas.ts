/**
 * zod schemas for every settings input: forms (FormData → strings), JSON
 * bodies for /api/invites and /api/keys, and the organization profile form,
 * which is the same shape as /welcome.
 */
import { z } from "zod";

import { US_STATES } from "@/components/auth/us-states";
import { INVITE_ROLES } from "./invites";

/** Mirrors `API_SCOPES` in lib/api/keys.ts without importing that server-only module. */
export const API_SCOPES = ["read", "write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const uuid = z.uuid();

/** "a, b\nc" → ["a", "b", "c"]; empty → []. */
export const listField = z
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

export const einField = z
  .string()
  .trim()
  .transform((value) => value.replace(/\D/g, ""))
  .refine((digits) => digits.length === 0 || digits.length === 9, {
    message: "An EIN has 9 digits, like 12-3456789.",
  });

export const websiteField = z
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

export const stateField = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => (value === "NONE" ? "" : value))
  .refine((value) => value === "" || (US_STATES as readonly string[]).includes(value), {
    message: "Choose a state from the list.",
  });

export const budgetField = z
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

export const PROFILE_KEYS = [
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
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export const organizationFormSchema = z.object({
  workspace_id: uuid,
  version: z.coerce.number().int().positive(),
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
export type OrganizationForm = z.infer<typeof organizationFormSchema>;

export const inviteCreateSchema = z.object({
  email: z.email("Enter a valid email address.").max(254).transform((v) => v.toLowerCase()),
  role: z.enum(INVITE_ROLES).default("member"),
});
export type InviteCreate = z.infer<typeof inviteCreateSchema>;

export const inviteRevokeSchema = z.object({ invite_id: uuid });

export const memberRemoveSchema = z.object({ user_id: uuid });

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1, "Give the key a name so you know where it is used.").max(80, "Keep the name under 80 characters."),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(2).default(["read"]),
});
export type ApiKeyCreate = z.infer<typeof apiKeyCreateSchema>;

export const apiKeyRevokeSchema = z.object({ key_id: uuid });

export const dailyCapSchema = z.object({
  workspace_id: uuid,
  version: z.coerce.number().int().positive(),
  daily_cap_enabled: z
    .string()
    .optional()
    .transform((v) => v === "on" || v === "true" || v === "1"),
});

export const deleteWorkspaceSchema = z.object({
  workspace_id: uuid,
  version: z.coerce.number().int().positive(),
  confirm: z.string().trim().max(200),
});

export const acceptInviteSchema = z.object({ token: z.string().min(1).max(200) });

/** FormData → plain string record, ignoring React's internal `$ACTION_*` fields. */
export function formToRecord(formData: FormData): Record<string, string> {
  const raw: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    raw[key] = typeof value === "string" ? value : "";
  }
  return raw;
}

/** First message per field, keyed by the first path segment. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}
