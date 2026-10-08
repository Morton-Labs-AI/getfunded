/**
 * Safe post-sign-in redirects.
 *
 * `next` arrives from a query string, a cookie or a hidden form field, all of
 * which an attacker can set. An open redirect on the auth callback is a
 * phishing primitive (a link that really signs you in can also land you on an
 * attacker's page), so only a same-origin path is ever accepted.
 */

export const DEFAULT_NEXT = "/app";

/** Paths that would loop a user straight back into the sign-in flow. */
const BLOCKED_PREFIXES = ["/signin", "/signup", "/auth"];

const PROBE_ORIGIN = "http://next-path.invalid";

/** The first value of a (possibly repeated) search param. */
export function firstParam(value: string | string[] | undefined | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Return `input` when it is a relative path on this origin (`/app/saved?x=1`),
 * otherwise `fallback`. Rejects protocol-relative (`//evil`), backslash
 * (`/\evil`), absolute URLs, control characters, whitespace, over-long values
 * and paths back into the auth flow. The fragment is dropped.
 */
export function safeNextPath(input: string | null | undefined, fallback: string = DEFAULT_NEXT): string {
  if (typeof input !== "string") return fallback;
  const value = input.trim();
  if (value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PROBE_ORIGIN) return fallback;

  const path = url.pathname + url.search;
  for (const prefix of BLOCKED_PREFIXES) {
    if (path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`)) return fallback;
  }
  return path;
}

export function isSafeNextPath(input: string | null | undefined): boolean {
  if (typeof input !== "string") return false;
  const sentinel = "/__unsafe__";
  return safeNextPath(input, sentinel) !== sentinel;
}

/** `/signin?next=...` for a path that has already been through `safeNextPath`. */
export function signInPath(next: string | null | undefined): string {
  const target = safeNextPath(next);
  return target === DEFAULT_NEXT ? "/signin" : `/signin?next=${encodeURIComponent(target)}`;
}
