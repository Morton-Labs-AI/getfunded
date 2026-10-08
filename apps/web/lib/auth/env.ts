/**
 * Auth-related environment, readable from BOTH the server and the browser
 * bundle. Only NEXT_PUBLIC_* values and APP_URL live here; nothing secret.
 */

function decodeJwtRole(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof atob === "function" ? atob(payload) : Buffer.from(payload, "base64").toString("utf8");
    const role = (JSON.parse(json) as { role?: unknown }).role;
    return typeof role === "string" ? role : null;
  } catch {
    return null;
  }
}

/** True when both public Supabase settings are present. */
export function hasSupabaseEnv(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The public Supabase settings, or a clear error. Refuses a secret key: the
 * app never runs as service_role, and the anon key is the only one that may
 * ever reach a browser.
 */
export function supabasePublicEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.example).",
    );
  }
  if (anonKey.startsWith("sb_secret_") || decodeJwtRole(anonKey) === "service_role") {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY must be the anon (publishable) key, never a secret or service_role key.");
  }
  return { url, anonKey };
}

/**
 * The absolute origin of this deployment, without a trailing slash, or the
 * empty string when APP_URL is unset (callers then fall back to the request
 * origin). Server-side only in practice: APP_URL is not a NEXT_PUBLIC_ value.
 */
export function appUrl(): string {
  const raw = process.env.APP_URL?.trim();
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}
