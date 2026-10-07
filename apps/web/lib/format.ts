/**
 * GetFunded formatting — one source of truth for money, counts, dates, EINs.
 *
 * Honesty rules baked in:
 *  - Missing is an em dash (—), never "$0" and never "N/A". A real zero is "$0".
 *  - Negatives use a true minus sign (−), not a hyphen.
 *  - Postgres numerics may arrive as strings; we accept them and never let
 *    float drift change a displayed amount.
 */

export const MDASH = "—";
export const MINUS = "−";

export type Numeric = number | string | bigint | null | undefined;

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const groupedCents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function toNumber(v: Numeric): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return Number.isFinite(v) ? v : null;
}

function sign(n: number): string {
  return n < 0 ? MINUS : "";
}

function trimZeros(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** Full precision with thousands separators: tables, tooltips, exports. */
export function formatMoney(v: Numeric, opts: { cents?: boolean } = {}): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  const abs = Math.abs(n);
  const body = opts.cents ? groupedCents.format(abs) : grouped.format(Math.round(abs));
  return `${sign(n)}$${body}`;
}

/** Compact money: KPI tiles, axes, chat answers. $48.2M · $1.5B · $250K. */
export function formatMoneyCompact(v: Numeric): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  const a = Math.abs(n);
  const s = sign(n);
  if (a >= 1_000_000_000) return `${s}$${trimZeros((a / 1_000_000_000).toFixed(2))}B`;
  if (a >= 1_000_000) return `${s}$${trimZeros((a / 1_000_000).toFixed(1))}M`;
  if (a >= 100_000) return `${s}$${Math.round(a / 1_000)}K`;
  if (a >= 10_000) return `${s}$${trimZeros((a / 1_000).toFixed(1))}K`;
  return `${s}$${grouped.format(Math.round(a))}`;
}

/** Counts with thousands separators. */
export function formatNumber(v: Numeric): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  return `${sign(n)}${grouped.format(Math.round(Math.abs(n)))}`;
}

/** Compact counts: 1.2K · 48K · 3.4M. */
export function formatCompact(v: Numeric): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  const a = Math.abs(n);
  const s = sign(n);
  if (a >= 1_000_000_000) return `${s}${trimZeros((a / 1_000_000_000).toFixed(1))}B`;
  if (a >= 1_000_000) return `${s}${trimZeros((a / 1_000_000).toFixed(1))}M`;
  if (a >= 100_000) return `${s}${Math.round(a / 1_000)}K`;
  if (a >= 10_000) return `${s}${trimZeros((a / 1_000).toFixed(1))}K`;
  if (a >= 1_000) return `${s}${trimZeros((a / 1_000).toFixed(1))}K`;
  return `${s}${grouped.format(Math.round(a))}`;
}

/** Ratio (0–1) → percent string. formatPercent(0.1234) → "12%". */
export function formatPercent(ratio: Numeric, digits = 0): string {
  const n = toNumber(ratio);
  if (n === null) return MDASH;
  const pct = Math.abs(n) * 100;
  return `${sign(n)}${pct.toFixed(digits)}%`;
}

export type DateStyle = "short" | "long" | "month" | "year";

/**
 * Dates. Date-only strings (Postgres `date` columns, e.g. "2024-03-01") are
 * parsed as local midnight so they never shift a day west of Greenwich.
 */
export function formatDate(v: string | Date | number | null | undefined, style: DateStyle = "short"): string {
  if (v === null || v === undefined || v === "") return MDASH;
  const d =
    typeof v === "string"
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00` : v)
      : typeof v === "number"
        ? new Date(v)
        : v;
  if (Number.isNaN(d.getTime())) return MDASH;
  switch (style) {
    case "long":
      return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    case "month":
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short" });
    case "year":
      return d.toLocaleDateString("en-US", { year: "numeric" });
    default:
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }
}

/** "Sep 1, 2:32 PM" — timestamps for activity and outreach logs. */
export function formatDateTime(v: string | Date | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return MDASH;
  const d = typeof v === "string" || typeof v === "number" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return MDASH;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** EIN as the IRS prints it: 12-3456789. Non-9-digit input is returned as-is. */
export function formatEin(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return MDASH;
  const raw = String(v).trim();
  if (raw === "") return MDASH;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9) return `${digits.slice(0, 2)}-${digits.slice(2)}`;
  return raw;
}

/** First n hex characters of a content hash, for provenance seals. */
export function shaPrefix(sha: string | null | undefined, n = 8): string {
  if (!sha) return MDASH;
  const s = sha.trim();
  return s.length <= n ? s : s.slice(0, n);
}

/** "FY2023" from a tax year. */
export function formatFiscalYear(y: number | string | null | undefined): string {
  if (y === null || y === undefined || y === "") return MDASH;
  const n = typeof y === "number" ? y : Number(String(y).slice(0, 4));
  return Number.isFinite(n) ? `FY${n}` : MDASH;
}
