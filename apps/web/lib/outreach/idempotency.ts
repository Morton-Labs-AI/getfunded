/**
 * Idempotency for sending. Every message gets ONE key at approval time
 * (`messages.idempotency_key`, unique), and that key becomes the RFC 5322
 * Message-ID on the wire. A retry after a crash therefore produces the same
 * Message-ID, which is how the runner reconciles an interrupted send instead
 * of sending twice.
 *
 * Pure: no IO, no randomness. The key is derived from the message's own id,
 * so it is stable across processes and re-runs.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `gf.<message uuid>` — the stored idempotency key for a message. */
export function idempotencyKeyFor(messageId: string): string {
  if (!UUID_RE.test(messageId)) throw new Error("idempotencyKeyFor: messageId must be a UUID.");
  return `gf.${messageId.toLowerCase()}`;
}

/**
 * The Message-ID derived from an idempotency key and the sender's address:
 * `<gf.123e4567-...@example.org>`. Characters outside the safe set collapse to
 * dots so the header can never be broken by a stored key.
 */
export function messageIdFor(idempotencyKey: string, senderEmail: string): string {
  const local = idempotencyKey
    .replace(/[^A-Za-z0-9.\-_]+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/^\.+|\.+$/g, "");
  const at = senderEmail.lastIndexOf("@");
  const domain = (at > 0 ? senderEmail.slice(at + 1) : "").trim().toLowerCase() || "localhost";
  return `<${local || "message"}@${domain}>`;
}

/** The bare id between the angle brackets, for comparing headers. */
export function bareMessageId(messageId: string | null | undefined): string {
  return (messageId ?? "").trim().replace(/^<|>$/g, "").toLowerCase();
}
