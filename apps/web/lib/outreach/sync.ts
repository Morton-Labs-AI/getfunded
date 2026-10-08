import { detectReply } from "@/lib/email/gmail";

import type { RunnerIdentity, Transport } from "./runner";

/**
 * Reply detection from Gmail thread METADATA only (headers and timestamps;
 * never a body). For every message this mailbox sent in the last 90 days that
 * has no reply or bounce recorded yet, read its thread, and when someone other
 * than the sender wrote after the send:
 *   - record a 'replied' outcome, and
 *   - cancel every pending follow-up to that contact, so nobody is chased
 *     after they answered.
 * Delivery failures become 'bounced' outcomes, never replies.
 *
 * The same `recordReply` path serves the "record a reply by hand" button, so
 * a phone call or a letter cancels follow-ups exactly like an email would.
 */

export type SyncCandidate = {
  id: string;
  contactId: string | null;
  threadId: string;
  sentAt: string;
};

export interface SyncStore {
  /** Sent email from this mailbox since `since`, oldest poll first, with no reply or bounce yet. */
  listSentForSync(identityId: string, since: Date, limit: number): Promise<SyncCandidate[]>;
  /** Writes the 'replied' outcome and cancels pending follow-ups; returns how many were canceled. */
  recordReply(messageId: string, detail: { at: Date; from: string | null; providerMessageId: string | null; manual: boolean; note?: string }): Promise<{ canceled: number }>;
  recordBounce(messageId: string, detail: { at: Date; from: string | null; providerMessageId: string | null }): Promise<void>;
  /** Remember that this thread was checked so the next run rotates to others first. */
  touchPolled(messageId: string, at: Date): Promise<void>;
}

export type SyncReport = {
  identity: { id: string; email: string };
  checked: number;
  replied: number;
  bounced: number;
  canceledFollowUps: number;
  errors: { id: string; reason: string }[];
};

export const SYNC_LOOKBACK_DAYS = 90;

export async function runReplySync(opts: {
  identity: RunnerIdentity;
  store: SyncStore;
  transport: Transport;
  limit?: number;
  now?: () => Date;
}): Promise<SyncReport> {
  const { identity, store, transport } = opts;
  const now = opts.now ?? (() => new Date());
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const token = await transport.accessToken(identity);
  const since = new Date(now().getTime() - SYNC_LOOKBACK_DAYS * 86_400_000);

  const report: SyncReport = {
    identity: { id: identity.id, email: identity.email },
    checked: 0,
    replied: 0,
    bounced: 0,
    canceledFollowUps: 0,
    errors: [],
  };

  for (const candidate of await store.listSentForSync(identity.id, since, limit)) {
    report.checked += 1;
    let messages;
    try {
      messages = await transport.threadMessages(token, candidate.threadId);
    } catch (error) {
      report.errors.push({ id: candidate.id, reason: error instanceof Error ? error.message : String(error) });
      const status = (error as { status?: number }).status;
      if (status === 429 || status === 401) break;
      continue;
    }
    const detection = detectReply(messages, new Date(candidate.sentAt), identity.email);
    if (detection.kind === "replied") {
      const { canceled } = await store.recordReply(candidate.id, {
        at: detection.at,
        from: detection.from,
        providerMessageId: detection.providerMessageId,
        manual: false,
      });
      report.replied += 1;
      report.canceledFollowUps += canceled;
    } else if (detection.kind === "bounced") {
      await store.recordBounce(candidate.id, { at: detection.at, from: detection.from, providerMessageId: detection.providerMessageId });
      report.bounced += 1;
    } else {
      await store.touchPolled(candidate.id, now());
    }
  }
  return report;
}
