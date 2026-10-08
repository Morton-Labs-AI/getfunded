/**
 * Pure billing-period math and the typed quota error. No imports from the
 * server side, so the usage meter UI and tests can use it directly.
 *
 * Periods are computed on UTC calendar dates: the billing anchor day in the
 * current month (or the previous month when today is before it). An anchor
 * day that a month does not have (29, 30, 31) clamps to the month's last day.
 */
import type { Feature } from "@/lib/plans";

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Normalise an anchor day to an integer in 1..31; anything else means the 1st. */
export function clampAnchorDay(anchorDay: number | null | undefined): number {
  if (anchorDay === null || anchorDay === undefined || !Number.isFinite(anchorDay)) return 1;
  const d = Math.floor(anchorDay);
  if (d < 1) return 1;
  if (d > 31) return 31;
  return d;
}

function anchorIn(year: number, monthIndex: number, anchor: number): Date {
  return new Date(Date.UTC(year, monthIndex, Math.min(anchor, daysInMonth(year, monthIndex))));
}

/** Start (inclusive, UTC midnight) of the billing period containing `now`. */
export function periodStart(now: Date, anchorDay: number): Date {
  const anchor = clampAnchorDay(anchorDay);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonthAnchor = anchorIn(y, m, anchor);
  if (now.getUTCDate() >= thisMonthAnchor.getUTCDate()) return thisMonthAnchor;
  const py = m === 0 ? y - 1 : y;
  const pm = m === 0 ? 11 : m - 1;
  return anchorIn(py, pm, anchor);
}

/** End (exclusive, UTC midnight) of the billing period containing `now` = the next period's start. */
export function periodEnd(now: Date, anchorDay: number): Date {
  const anchor = clampAnchorDay(anchorDay);
  const start = periodStart(now, anchorDay);
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const ny = m === 11 ? y + 1 : y;
  const nm = (m + 1) % 12;
  return anchorIn(ny, nm, anchor);
}

/** Fraction of the current period already elapsed, 0..1. Used for prorating credits on upgrade. */
export function periodFractionElapsed(now: Date, anchorDay: number): number {
  const start = periodStart(now, anchorDay).getTime();
  const end = periodEnd(now, anchorDay).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}

type Parts = { y: number; m: number; d: number; h: number; mi: number; s: number };

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsIn(date: Date, tz: string): Parts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Partial<Parts> = {};
  for (const p of dtf.formatToParts(date)) {
    const n = Number(p.value);
    switch (p.type) {
      case "year":
        out.y = n;
        break;
      case "month":
        out.m = n;
        break;
      case "day":
        out.d = n;
        break;
      case "hour":
        out.h = n === 24 ? 0 : n;
        break;
      case "minute":
        out.mi = n;
        break;
      case "second":
        out.s = n;
        break;
    }
  }
  return { y: out.y ?? 1970, m: out.m ?? 1, d: out.d ?? 1, h: out.h ?? 0, mi: out.mi ?? 0, s: out.s ?? 0 };
}

/** Offset of `tz` from UTC at `date`, in ms (positive east of Greenwich). */
function tzOffsetMs(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - (date.getTime() - date.getUTCMilliseconds());
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export type DayWindow = { start: Date; end: Date; date: string; timeZone: string };

/**
 * The calendar day containing `now` in `tz` (default UTC) as [start, end).
 * Invalid or missing time zones fall back to UTC rather than throwing.
 */
export function todayWindow(now: Date, tz?: string | null): DayWindow {
  const zone = isValidTimeZone(tz) ? tz : "UTC";
  const p = partsIn(now, zone);
  const localMidnight = Date.UTC(p.y, p.m - 1, p.d);
  const localNextMidnight = Date.UTC(p.y, p.m - 1, p.d + 1);
  // Two passes: the offset at `now` first, then at the candidate instant, which
  // corrects for a DST change between midnight and now.
  let start = new Date(localMidnight - tzOffsetMs(now, zone));
  start = new Date(localMidnight - tzOffsetMs(start, zone));
  let end = new Date(localNextMidnight - tzOffsetMs(now, zone));
  end = new Date(localNextMidnight - tzOffsetMs(end, zone));
  return { start, end, date: `${p.y}-${pad2(p.m)}-${pad2(p.d)}`, timeZone: zone };
}

export type QuotaScope = "monthly" | "daily";

export type QuotaExceededDetail = {
  used: number;
  limit: number;
  periodEnd: Date | null;
  feature: Feature;
  scope: QuotaScope;
};

/**
 * Thrown by `meter()` when a reservation would cross the monthly or daily
 * limit. Carries what the UI needs for "You have used 25 of 25 credits this
 * period; it resets on <date>" plus an upgrade link. Never a silent overage.
 */
export class QuotaExceededError extends Error {
  readonly code = "quota_exceeded" as const;
  readonly status = 402;
  readonly used: number;
  readonly limit: number;
  readonly periodEnd: Date | null;
  readonly feature: Feature;
  readonly scope: QuotaScope;
  readonly upgradeUrl = "/pricing";

  constructor(detail: QuotaExceededDetail) {
    super(QuotaExceededError.message(detail));
    this.name = "QuotaExceededError";
    this.used = detail.used;
    this.limit = detail.limit;
    this.periodEnd = detail.periodEnd;
    this.feature = detail.feature;
    this.scope = detail.scope;
  }

  static message(d: QuotaExceededDetail): string {
    const when = d.periodEnd ? ` It resets on ${d.periodEnd.toISOString().slice(0, 10)}.` : "";
    const scope = d.scope === "daily" ? "today" : "this period";
    return `AI credit limit reached: ${d.used} of ${d.limit} credits used ${scope}.${when} Upgrade your plan for more.`;
  }

  toJSON() {
    return {
      error: this.code,
      message: this.message,
      used: this.used,
      limit: this.limit,
      periodEnd: this.periodEnd ? this.periodEnd.toISOString() : null,
      feature: this.feature,
      scope: this.scope,
      upgradeUrl: this.upgradeUrl,
    };
  }
}

export type QuotaExceededPayload = {
  used: number;
  limit: number;
  period_end?: string | null;
  scope?: QuotaScope;
  requested?: number;
};

function payloadFromObject(raw: unknown): QuotaExceededPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const used = Number(r.used);
  const limit = Number(r.limit);
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
  const scope = r.scope === "daily" || r.scope === "monthly" ? r.scope : undefined;
  const period_end = typeof r.period_end === "string" ? r.period_end : null;
  const requested = Number.isFinite(Number(r.requested)) ? Number(r.requested) : undefined;
  return { used, limit, period_end, scope, requested };
}

/**
 * Parse the JSON that `getfunded.reserve_credits` raises, from either the
 * error `detail` (`{"scope":"monthly","used":25,"limit":25,"period_end":"2026-11-01"}`)
 * or a message of the form `quota_exceeded: {...}`. Null when there is no JSON.
 */
export function parseQuotaExceeded(text: string | null | undefined): QuotaExceededPayload | null {
  if (!text) return null;
  const m = /(\{[\s\S]*\})/.exec(text);
  if (!m) return null;
  try {
    return payloadFromObject(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

type ErrorLike = { code?: unknown; message?: unknown; detail?: unknown; cause?: unknown };

/**
 * Find the quota payload on a thrown value: a `DbError` from lib/db/app
 * (`code: "quota_exceeded"`, `detail` already parsed), or the underlying
 * Postgres error (`code: "P0001"`, message `quota_exceeded`, JSON in
 * `detail`), looking through the `cause` chain. Null for any other error.
 */
export function quotaDetailFrom(err: unknown): QuotaExceededPayload | null {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur && typeof cur === "object"; depth++) {
    const e = cur as ErrorLike;
    const message = typeof e.message === "string" ? e.message : "";
    const isQuota = e.code === "quota_exceeded" || (e.code === "P0001" && /^quota_exceeded/i.test(message));
    if (isQuota) {
      const fromDetail =
        typeof e.detail === "string" ? parseQuotaExceeded(e.detail) : payloadFromObject(e.detail);
      return fromDetail ?? parseQuotaExceeded(message) ?? { used: 0, limit: 0, period_end: null };
    }
    cur = e.cause;
  }
  return null;
}
