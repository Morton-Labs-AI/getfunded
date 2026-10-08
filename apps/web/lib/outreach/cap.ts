/**
 * The per-sender daily cap, pure. `sender_identities.daily_cap` (0..2000,
 * default 50) bounds how many messages one connected mailbox sends in one UTC
 * calendar day. Reconciled sends count too: Gmail accepted them.
 */

export const DEFAULT_DAILY_CAP = 50;
export const MAX_DAILY_CAP = 2000;

/** Clamp a stored or typed cap into the range the schema accepts. */
export function clampDailyCap(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return DEFAULT_DAILY_CAP;
  return Math.max(0, Math.min(MAX_DAILY_CAP, Math.floor(n)));
}

/** Start of the current UTC day: the window `sent_at` is counted in. */
export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function remainingToday(dailyCap: number, sentToday: number): number {
  return Math.max(0, clampDailyCap(dailyCap) - Math.max(0, Math.floor(sentToday)));
}

export function capAllows(dailyCap: number, sentToday: number): boolean {
  return remainingToday(dailyCap, sentToday) > 0;
}

export function describeCap(dailyCap: number, sentToday: number): string {
  const cap = clampDailyCap(dailyCap);
  if (cap === 0) return "Sending is paused for this mailbox (daily limit is 0).";
  const left = remainingToday(cap, sentToday);
  if (left === 0) return `Today's limit of ${cap} for this mailbox is used up. Sending resumes tomorrow (UTC).`;
  return `${left} of ${cap} sends left today for this mailbox.`;
}
