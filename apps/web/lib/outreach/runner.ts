import { base64url, buildMime, type MetadataMessage, type SentRef } from "@/lib/email/gmail";

import { capAllows, remainingToday, utcDayStart } from "./cap";
import { idempotencyKeyFor, messageIdFor } from "./idempotency";
import { findSuppression, describeSuppression, extractAddress, isValidEmail, type SuppressionEntry } from "./suppress";

/**
 * The delivery runner. It never composes and never approves: it only moves
 * messages a person approved through approved → sending → sent | failed, with
 *  - consent: only status 'approved' is eligible, and only channel 'email';
 *  - suppression: the do-not-contact list is checked again at send time;
 *  - the sender's daily cap, counted in the UTC day, reconciled sends included;
 *  - durable idempotency: the Message-ID is derived from the message's
 *    idempotency key, and an interrupted send (status 'sending') is reconciled
 *    on the next run by looking that Message-ID up in the mailbox;
 *  - threading: a follow-up carries In-Reply-To / References of the last sent
 *    message in its thread and is posted into the same Gmail thread;
 *  - outcomes: every attempt records 'accepted' or 'failed'.
 *
 * Pure orchestration: the database (`SendStore`) and Gmail (`Transport`) are
 * injected, so the whole policy is unit-tested with fakes.
 */

export type RunnerMessage = {
  id: string;
  workspaceId: string;
  status: string;
  channel: string;
  contactId: string | null;
  contactEmail: string | null;
  contactName: string | null;
  senderIdentityId: string | null;
  subject: string | null;
  body: string;
  idempotencyKey: string | null;
  threadId: string | null;
  sentAt: string | null;
  version: number;
};

export type RunnerIdentity = {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  displayName: string | null;
  dailyCap: number;
  status: string;
};

export type ThreadParent = { idempotencyKey: string | null; providerMessageId: string | null; threadId: string | null };

export interface SendStore {
  /** Messages stuck in 'sending' for this mailbox: a previous run died mid-send. */
  listInterrupted(identityId: string): Promise<RunnerMessage[]>;
  /** Approved email for this mailbox, oldest approval first, optionally narrowed to ids. */
  listApproved(identityId: string, messageIds: string[] | null): Promise<RunnerMessage[]>;
  suppressions(): Promise<SuppressionEntry[]>;
  /** Messages sent from this mailbox since `since` (status 'sent', sent_at >= since). */
  sentSince(identityId: string, since: Date): Promise<number>;
  /** The most recent sent message in a thread, other than `excludeId`. */
  threadParent(threadId: string, excludeId: string): Promise<ThreadParent | null>;
  /** approved → sending with a compare-and-swap on version; sets the key. Null when the CAS lost. */
  markSending(id: string, version: number, idempotencyKey: string): Promise<RunnerMessage | null>;
  /** sending → sent, with provider ids; records an 'accepted' outcome and the activity row. */
  markSent(id: string, result: { providerMessageId: string; threadId: string; sentAt: Date; reconciled: boolean }): Promise<void>;
  /** sending → failed; records a 'failed' outcome. */
  markFailed(id: string, error: string): Promise<void>;
  /** sending → approved: Gmail never got it, so it may go again next run. */
  requeue(id: string): Promise<void>;
}

export interface Transport {
  /** A fresh access token for this mailbox (from the sealed refresh token). */
  accessToken(identity: RunnerIdentity): Promise<string>;
  send(token: string, raw: string, threadId: string | null): Promise<SentRef>;
  findSent(token: string, messageId: string): Promise<SentRef | null>;
  threadMessages(token: string, threadId: string): Promise<MetadataMessage[]>;
}

export type SendSkip = { id: string; reason: string };

export type SendReport = {
  identity: { id: string; email: string };
  sent: number;
  failed: number;
  reconciled: number;
  requeued: number;
  skipped: SendSkip[];
  cap: { used: number; limit: number; remaining: number };
  /** Ids in the order they were sent (tests and the UI toast). */
  sentIds: string[];
};

export type RunSendOptions = {
  identity: RunnerIdentity;
  store: SendStore;
  transport: Transport;
  messageIds?: string[] | null;
  limit?: number;
  now?: () => Date;
  /** Pause between sends so Gmail sees a person, not a burst. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class SendRunError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 409) {
    super(message);
    this.name = "SendRunError";
    this.code = code;
    this.status = status;
  }
}

/** Which approved messages may go, and why the others may not. Pure, exported for tests. */
export function selectSendable(
  messages: readonly RunnerMessage[],
  suppressions: readonly SuppressionEntry[],
  identityId: string,
): { ready: RunnerMessage[]; skipped: SendSkip[] } {
  const ready: RunnerMessage[] = [];
  const skipped: SendSkip[] = [];
  for (const m of messages) {
    if (m.status !== "approved") {
      skipped.push({ id: m.id, reason: `Status is ${m.status}, not approved.` });
      continue;
    }
    if (m.channel !== "email") {
      skipped.push({ id: m.id, reason: "Only email is sent by the app. Record letters and calls by hand." });
      continue;
    }
    if (m.senderIdentityId !== identityId) {
      skipped.push({ id: m.id, reason: "Approved for a different mailbox." });
      continue;
    }
    if (!m.contactId || !isValidEmail(m.contactEmail)) {
      skipped.push({ id: m.id, reason: "The contact has no usable email address." });
      continue;
    }
    const match = findSuppression(m.contactEmail, suppressions);
    if (match) {
      skipped.push({ id: m.id, reason: describeSuppression(match) });
      continue;
    }
    ready.push(m);
  }
  return { ready, skipped };
}

export async function runSendQueue(opts: RunSendOptions): Promise<SendReport> {
  const { identity, store, transport } = opts;
  const now = opts.now ?? (() => new Date());
  const sleep = opts.sleep ?? defaultSleep;
  const delayMs = opts.delayMs ?? 1500;
  const log = opts.log ?? (() => undefined);
  const limit = Math.max(1, Math.min(100, opts.limit ?? 25));

  if (identity.status !== "connected") {
    throw new SendRunError("not_connected", "This mailbox is not connected. Connect Gmail in Outreach settings.");
  }
  const token = await transport.accessToken(identity);

  const report: SendReport = {
    identity: { id: identity.id, email: identity.email },
    sent: 0,
    failed: 0,
    reconciled: 0,
    requeued: 0,
    skipped: [],
    cap: { used: 0, limit: identity.dailyCap, remaining: 0 },
    sentIds: [],
  };

  // 1. Reconcile sends that a previous run started but never finished. A row
  //    still 'sending' goes back to approved when the mailbox has no trace of
  //    it; a row the daily cron already marked 'failed' stays failed for a
  //    person to retry.
  for (const m of await store.listInterrupted(identity.id)) {
    const key = m.idempotencyKey ?? idempotencyKeyFor(m.id);
    const found = await transport.findSent(token, messageIdFor(key, identity.email));
    if (found) {
      await store.markSent(m.id, { providerMessageId: found.id, threadId: found.threadId, sentAt: now(), reconciled: true });
      report.reconciled += 1;
    } else if (m.status === "sending") {
      await store.requeue(m.id);
      report.requeued += 1;
    }
  }

  // 2. What a person approved, minus what the list says we may not send.
  const approved = await store.listApproved(identity.id, opts.messageIds ?? null);
  const { ready, skipped } = selectSendable(approved, await store.suppressions(), identity.id);
  report.skipped.push(...skipped);

  // 3. Send inside the daily cap, one at a time, with the idempotent Message-ID.
  let sentToday = await store.sentSince(identity.id, utcDayStart(now()));
  let count = 0;
  for (const m of ready) {
    if (count >= limit) {
      report.skipped.push({ id: m.id, reason: `Left for the next run (this run sends at most ${limit}).` });
      continue;
    }
    if (!capAllows(identity.dailyCap, sentToday)) {
      report.skipped.push({ id: m.id, reason: `Today's limit of ${identity.dailyCap} for ${identity.email} is used up.` });
      continue;
    }
    const key = m.idempotencyKey ?? idempotencyKeyFor(m.id);
    const live = await store.markSending(m.id, m.version, key);
    if (!live) {
      report.skipped.push({ id: m.id, reason: "The message changed while this run was starting. It was left alone." });
      continue;
    }
    count += 1;
    const messageId = messageIdFor(key, identity.email);

    let inReplyTo: string | null = null;
    let gmailThreadId: string | null = null;
    if (live.threadId) {
      const parent = await store.threadParent(live.threadId, live.id);
      if (parent?.idempotencyKey) inReplyTo = messageIdFor(parent.idempotencyKey, identity.email);
      gmailThreadId = parent?.threadId ?? live.threadId;
    }

    const raw = base64url(
      buildMime({
        from: identity.email,
        fromName: identity.displayName,
        to: extractAddress(live.contactEmail),
        subject: live.subject ?? "",
        text: live.body,
        messageId,
        inReplyTo,
        references: inReplyTo,
      }),
    );

    try {
      const result = await transport.send(token, raw, gmailThreadId);
      await store.markSent(live.id, { providerMessageId: result.id, threadId: result.threadId, sentAt: now(), reconciled: false });
      report.sent += 1;
      report.sentIds.push(live.id);
      sentToday += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Gmail did not accept the message.";
      // Gmail may have accepted the message before the error surfaced. Look it up
      // before recording a failure, so a retry can never send it twice.
      let found: SentRef | null = null;
      try {
        found = await transport.findSent(token, messageId);
      } catch (lookupError) {
        log("reconcile lookup failed after send error", { id: live.id, error: String(lookupError) });
      }
      if (found) {
        await store.markSent(live.id, { providerMessageId: found.id, threadId: found.threadId, sentAt: now(), reconciled: true });
        report.sent += 1;
        report.sentIds.push(live.id);
        sentToday += 1;
      } else {
        await store.markFailed(live.id, reason);
        report.failed += 1;
      }
      const status = (error as { status?: number }).status;
      if (status === 429 || status === 401) {
        log("send run stopped early", { id: live.id, status, reason });
        break;
      }
    }
    if (delayMs > 0) await sleep(delayMs);
  }

  report.cap = {
    used: sentToday,
    limit: identity.dailyCap,
    remaining: remainingToday(identity.dailyCap, sentToday),
  };
  return report;
}
