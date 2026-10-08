import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Signed OAuth `state` for the Gmail connect flow.
 *
 * The state carries the signed-in user id and the active workspace id across
 * the redirect to Google and back. Unsigned, anyone could craft a callback URL
 * that files THEIR Google mailbox under SOMEONE ELSE'S user or workspace. The
 * HMAC makes the round trip tamper-evident, and the callback additionally
 * requires that the user who comes back is the user who left.
 *
 * Signed with `SECRETS_KEY` (the same key that seals the refresh token) so
 * there is one secret to manage. Ten minutes is generous for a consent screen
 * and short enough that a URL left in browser history is not a standing key.
 *
 * Pure: the key and the clock are arguments.
 */

export const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export type OAuthStatePayload = { userId: string; workspaceId: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function signState(payload: OAuthStatePayload, key: Buffer, now: Date = new Date()): string {
  if (!UUID_RE.test(payload.userId) || !UUID_RE.test(payload.workspaceId)) {
    throw new Error("signState: userId and workspaceId must be UUIDs.");
  }
  // Four fixed segments: userId.workspaceId.issuedAt.nonce. Ids are uuids and
  // the timestamp is digits, so '.' never appears inside a segment.
  const body = `${payload.userId}.${payload.workspaceId}.${now.getTime()}.${randomBytes(8).toString("hex")}`;
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${Buffer.from(body, "utf8").toString("base64url")}.${mac}`;
}

/** The payload when the signature is valid and the state is fresh; null otherwise. */
export function verifyState(
  state: string | null | undefined,
  key: Buffer,
  now: Date = new Date(),
): OAuthStatePayload | null {
  if (!state || state.length > 512) return null;
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = state.slice(0, dot);
  const mac = state.slice(dot + 1);
  if (!encoded || !mac) return null;

  let body: string;
  try {
    body = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const parts = body.split(".");
  if (parts.length !== 4) return null;
  const [userId, workspaceId, issuedAt] = parts;
  if (!UUID_RE.test(userId) || !UUID_RE.test(workspaceId)) return null;
  const issued = Number(issuedAt);
  if (!Number.isFinite(issued)) return null;
  const age = now.getTime() - issued;
  if (age < -60_000 || age > STATE_MAX_AGE_MS) return null;
  return { userId, workspaceId };
}
