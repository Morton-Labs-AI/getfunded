/**
 * Pure helpers over Supabase Auth user metadata. No server-only import so the
 * callback route, the session module and unit tests can all use them.
 */

/** Anything shaped like process.env; tests pass a plain object. */
export type Env = Record<string, string | undefined>;

const NAME_KEYS = ["display_name", "full_name", "name"] as const;

/** The display name a user gave at sign-up, trimmed and capped, or null. */
export function displayNameFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  for (const key of NAME_KEYS) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim().slice(0, 120);
    }
  }
  return null;
}

/** Comma-separated steward logins (`ADMIN_EMAILS`), lower-cased. */
export function adminEmails(env: Env = process.env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

export function isAdminEmail(email: string, env: Env = process.env): boolean {
  return adminEmails(env).includes(email.trim().toLowerCase());
}
