/**
 * Invite tokens: pure helpers shared by the server action, the API route and
 * the accept page.
 *
 * A token is 32 random bytes, base64url (43 characters, no padding). It is
 * shown once in a link (`/invite/<token>`) and stored only as its SHA-256 hex,
 * which is byte-for-byte what `getfunded.hash_token(token)` computes, so
 * `getfunded.accept_invite(token)` finds the row the app wrote.
 *
 * No database here: `node:crypto` only, so every rule is unit-testable.
 */
import { createHash, randomBytes } from "node:crypto";

export const INVITE_TTL_DAYS = 7;
export const INVITE_TOKEN_BYTES = 32;
/** base64url of 32 bytes without padding is exactly 43 characters. */
export const INVITE_TOKEN_LENGTH = 43;
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const INVITE_ROLES = ["member", "admin"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

export type GeneratedInviteToken = { token: string; hash: string };

/** Same digest as `getfunded.hash_token`: sha256 of the UTF-8 bytes, lower-case hex. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Mint a token. Store `hash`; put `token` in the link once and never again. */
export function generateInviteToken(): GeneratedInviteToken {
  const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** The token from a URL segment, or null when it cannot be one of ours. */
export function parseInviteToken(input: string | string[] | null | undefined): string | null {
  const raw = Array.isArray(input) ? input[0] : input;
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  return INVITE_TOKEN_PATTERN.test(value) ? value : null;
}

/** `expires_at` for a new invite. */
export function inviteExpiry(now: Date = new Date(), ttlDays: number = INVITE_TTL_DAYS): Date {
  const days = Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : INVITE_TTL_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export type InviteStatus = "pending" | "accepted" | "expired";

export function inviteStatus(
  invite: { accepted_at?: Date | string | null; expires_at: Date | string },
  now: Date = new Date(),
): InviteStatus {
  if (invite.accepted_at) return "accepted";
  const expires = invite.expires_at instanceof Date ? invite.expires_at : new Date(invite.expires_at);
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= now.getTime()) return "expired";
  return "pending";
}

/** The link to share: `<origin>/invite/<token>`. A missing origin yields a relative link. */
export function inviteUrl(appUrl: string | null | undefined, token: string): string {
  const base = (appUrl ?? "").trim().replace(/\/+$/, "");
  return `${base}/invite/${encodeURIComponent(token)}`;
}

export type AcceptInviteFailure = "invalid" | "used" | "expired" | "not_signed_in" | "unknown";

/**
 * Map the error `getfunded.accept_invite()` raises to a reason the page can
 * explain. The door raises plain messages (`invite_invalid`, `invite_used`,
 * `invite_expired`) and SQLSTATE 28000 when `app.user_id` is unset.
 */
export function acceptInviteFailure(error: unknown): AcceptInviteFailure {
  const e = (error ?? {}) as { message?: unknown; code?: unknown; cause?: unknown };
  const nested = (e.cause ?? {}) as { message?: unknown; code?: unknown };
  const code = typeof e.code === "string" ? e.code : typeof nested.code === "string" ? nested.code : "";
  const message = [e.message, nested.message]
    .filter((m): m is string => typeof m === "string")
    .join(" ")
    .toLowerCase();
  if (code === "28000" || message.includes("not signed in")) return "not_signed_in";
  if (message.includes("invite_used")) return "used";
  if (message.includes("invite_expired")) return "expired";
  if (message.includes("invite_invalid")) return "invalid";
  return "unknown";
}

export const ACCEPT_INVITE_COPY: Record<AcceptInviteFailure, string> = {
  invalid: "This invitation link is not valid. Ask the person who invited you for a new one.",
  used: "This invitation was already used. If that was you, the workspace is in your workspace list.",
  expired: "This invitation has expired. Invitations last 7 days. Ask for a new one.",
  not_signed_in: "Sign in first, then open the invitation link again.",
  unknown: "We could not accept this invitation. Try again in a moment.",
};
