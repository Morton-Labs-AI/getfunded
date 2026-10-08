/**
 * Steward flags (`getfunded.flags`): the AI kill switch, the sign-up mode and
 * the site banner. The schema and parsing are pure (tested); the reads that
 * touch the database live in lib/admin/flags-server.ts.
 *
 *   ai_enabled   jsonb boolean. `false` makes meter() refuse every model call
 *                (lib/billing/meter.ts flagDisabled) with a clear notice.
 *   signup_mode  "open" | "invite" | "closed". The sign-in flow reads it.
 *   banner       null, or { text, href?, tone } shown by <SiteBanner /> on the
 *                marketing site and in the app shell. Absent row = no banner.
 */
import { z } from "zod";

export const SIGNUP_MODES = ["open", "invite", "closed"] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];

/** Plain-language labels for the vocabulary (the DB keeps the short values). */
export const SIGNUP_MODE_LABELS: Record<SignupMode, string> = {
  open: "Anyone can sign up",
  invite: "Invite only",
  closed: "Sign-ups paused",
};

export const BANNER_TONES = ["info", "warning"] as const;
export type BannerTone = (typeof BANNER_TONES)[number];

const hrefSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === "" || v.startsWith("/") || /^https?:\/\//i.test(v), {
    message: "A banner link must start with / or https://",
  });

export const bannerSchema = z.object({
  text: z.string().trim().min(1, "Banner text is required.").max(240, "Keep the banner under 240 characters."),
  href: hrefSchema.optional().transform((v) => (v ? v : undefined)),
  tone: z.enum(BANNER_TONES).default("info"),
});
export type Banner = z.infer<typeof bannerSchema>;

export type Flags = {
  aiEnabled: boolean;
  signupMode: SignupMode;
  banner: Banner | null;
};

export const DEFAULT_FLAGS: Flags = { aiEnabled: true, signupMode: "open", banner: null };

/** `true`, `"true"`, `{enabled:true}` → true; `false`, `"false"`, `0`, `{enabled:false}` → false. */
export function parseAiEnabled(value: unknown): boolean {
  if (value === false || value === "false" || value === 0) return false;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (v.enabled === false || v.value === false || v.on === false) return false;
  }
  return true;
}

export function parseSignupMode(value: unknown): SignupMode {
  return typeof value === "string" && (SIGNUP_MODES as readonly string[]).includes(value) ? (value as SignupMode) : "open";
}

/** A banner row, or null for anything that is not a valid banner (never throws). */
export function parseBanner(value: unknown): Banner | null {
  if (value === null || value === undefined || value === "" || value === false) return null;
  if (typeof value === "string") {
    const text = value.trim();
    return text ? { text: text.slice(0, 240), tone: "info", href: undefined } : null;
  }
  const parsed = bannerSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Rows of `select key, value from getfunded.flags` → typed flags with defaults. */
export function flagsFromRows(rows: Array<{ key: string; value: unknown }>): Flags {
  const out: Flags = { ...DEFAULT_FLAGS };
  for (const row of rows) {
    if (row.key === "ai_enabled") out.aiEnabled = parseAiEnabled(row.value);
    else if (row.key === "signup_mode") out.signupMode = parseSignupMode(row.value);
    else if (row.key === "banner") out.banner = parseBanner(row.value);
  }
  return out;
}

/** Form input for the flags page (server action). Checkbox absent = off. */
export const flagsFormSchema = z.object({
  ai_enabled: z.boolean(),
  signup_mode: z.enum(SIGNUP_MODES),
  banner_text: z.string().trim().max(240, "Keep the banner under 240 characters.").default(""),
  banner_href: hrefSchema.default(""),
  banner_tone: z.enum(BANNER_TONES).default("info"),
});
export type FlagsForm = z.infer<typeof flagsFormSchema>;

/** What to write for each key. `banner` is JSON null when the text is empty. */
export function flagsToRows(form: FlagsForm): Array<{ key: string; value: unknown }> {
  const banner: Banner | null = form.banner_text
    ? { text: form.banner_text, href: form.banner_href || undefined, tone: form.banner_tone }
    : null;
  return [
    { key: "ai_enabled", value: form.ai_enabled },
    { key: "signup_mode", value: form.signup_mode },
    { key: "banner", value: banner },
  ];
}
