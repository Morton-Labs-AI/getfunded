/**
 * Suppression checks, pure. The list itself lives in `getfunded.suppressions`
 * (kind 'email' | 'domain', value citext). This module answers "may we write
 * to this address?" from a list already loaded, so the same code runs at
 * approve time, at send time and in unit tests.
 */

export type SuppressionKind = "email" | "domain";

export type SuppressionEntry = { kind: SuppressionKind; value: string; reason?: string | null };

export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** `Jane <jane@example.org>` → `jane@example.org`; a bare address passes through. */
export function extractAddress(value: string | null | undefined): string {
  const v = normalizeEmail(value);
  const m = v.match(/<([^<>\s]+@[^<>\s]+)>/);
  return m ? m[1] : v;
}

export function normalizeDomain(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/** The domain part of an address, or "" when there is none. */
export function domainOf(email: string | null | undefined): string {
  const v = extractAddress(email);
  const at = v.lastIndexOf("@");
  return at > 0 ? v.slice(at + 1) : "";
}

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function isValidEmail(value: string | null | undefined): boolean {
  const v = extractAddress(value);
  return v.length > 3 && v.length <= 320 && EMAIL_RE.test(v);
}

export type SuppressionMatch = { kind: SuppressionKind; value: string; reason: string | null };

/**
 * The matching list entry (the address itself, or its domain or a parent
 * domain), or null when the address is clear. A missing address is never
 * "suppressed": it is "no address", a different problem with a different
 * message.
 */
export function findSuppression(
  email: string | null | undefined,
  entries: readonly SuppressionEntry[],
): SuppressionMatch | null {
  const address = extractAddress(email);
  if (!address) return null;
  const domain = domainOf(address);
  for (const entry of entries) {
    const value = entry.kind === "email" ? normalizeEmail(entry.value) : normalizeDomain(entry.value);
    if (!value) continue;
    if (entry.kind === "email" && value === address) {
      return { kind: "email", value, reason: entry.reason ?? null };
    }
    if (entry.kind === "domain" && domain && (domain === value || domain.endsWith(`.${value}`))) {
      return { kind: "domain", value, reason: entry.reason ?? null };
    }
  }
  return null;
}

export function isSuppressed(email: string | null | undefined, entries: readonly SuppressionEntry[]): boolean {
  return findSuppression(email, entries) !== null;
}

/** Plain-language sentence for a match, for toasts and queue rows. */
export function describeSuppression(match: SuppressionMatch): string {
  const what = match.kind === "email" ? `The address ${match.value}` : `Every address at ${match.value}`;
  return `${what} is on your do-not-contact list${match.reason ? ` (${match.reason})` : ""}.`;
}
