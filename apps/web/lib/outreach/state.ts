/**
 * The message state machine. Mirrors `ck_messages_status` in
 * migrations/getfunded_0006_outreach.sql so a bad move fails here, in plain
 * words, rather than as a constraint violation.
 *
 *   draft ──approve──▶ approved ──runner──▶ sending ──▶ sent
 *     │                   │                    │          (terminal; replies
 *     │                   │                    └──▶ failed   are outcome rows)
 *     │                   └──edit──▶ draft
 *     ├──cancel──▶ canceled ──reopen──▶ draft
 *     └──record by hand──▶ recorded (terminal)
 *
 * Every arrow out of `draft` and `approved` is a human click. The runner only
 * ever moves approved → sending → sent | failed, sending → approved when it
 * reconciles an interrupted send that Gmail never received, and failed → sent
 * when the mailbox proves a send the daily cron had marked stale did go out.
 */

export const MESSAGE_STATUSES = ["draft", "approved", "sending", "sent", "failed", "canceled", "recorded"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const TRANSITIONS: Record<MessageStatus, readonly MessageStatus[]> = {
  draft: ["approved", "canceled", "recorded"],
  approved: ["draft", "sending", "canceled", "recorded"],
  sending: ["sent", "failed", "approved"],
  // failed → sent is the runner's reconcile only: the daily cron marks a send
  // that never finished as failed, and the next run finds it in the mailbox.
  failed: ["approved", "canceled", "draft", "sent"],
  sent: [],
  canceled: ["draft"],
  recorded: [],
};

/** Statuses the review queue still considers "pending": nothing has left the building. */
export const PENDING_STATUSES: readonly MessageStatus[] = ["draft", "approved", "failed"];

/** Terminal states: no arrow leaves them. */
export const TERMINAL_STATUSES: readonly MessageStatus[] = ["sent", "recorded"];

export function isMessageStatus(value: unknown): value is MessageStatus {
  return typeof value === "string" && (MESSAGE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: MessageStatus, to: MessageStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  readonly code = "invalid_transition" as const;
  readonly status = 409;
  constructor(
    readonly from: MessageStatus,
    readonly to: MessageStatus,
  ) {
    super(describeTransitionError(from, to));
    this.name = "InvalidTransitionError";
  }
}

/** Throws `InvalidTransitionError` with a plain-language reason. */
export function assertTransition(from: MessageStatus, to: MessageStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

const STATUS_LABELS: Record<MessageStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  canceled: "Canceled",
  recorded: "Recorded",
};

export function statusLabel(status: MessageStatus): string {
  return STATUS_LABELS[status];
}

function describeTransitionError(from: MessageStatus, to: MessageStatus): string {
  if (from === "sent") return "This message was already sent. It cannot be changed.";
  if (from === "recorded") return "This message was recorded as sent by hand. It cannot be changed.";
  if (from === "sending") return "This message is being sent right now. Wait for the send run to finish.";
  return `A ${STATUS_LABELS[from].toLowerCase()} message cannot become ${STATUS_LABELS[to].toLowerCase()}.`;
}
