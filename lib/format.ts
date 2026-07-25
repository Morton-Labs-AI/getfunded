/**
 * Greenbook formatting — the single source of the money/count/hash spec.
 * numeric columns arrive from postgres.js as strings; keep them as strings
 * (no float drift on 18,2 amounts) and format from BigInt/parsed parts.
 *
 * Missing is an em dash (—), never "$0"/"N/A". Negatives use true minus (−).
 */

const MINUS = "−";
export const MDASH = "—";

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Full precision with thousands commas: tables, tooltips, exports. */
export function moneyFull(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  const sign = n < 0 ? MINUS : "";
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
}

/** Compact: KPI cards, heroes, axes, chat answer lines. */
export function moneyCompact(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  const sign = n < 0 ? MINUS : "";
  const a = Math.abs(n);
  if (a >= 1_000_000_000)
    return `${sign}$${trimZeros((a / 1_000_000_000).toFixed(2))}B`;
  if (a >= 1_000_000) return `${sign}$${trimZeros((a / 1_000_000).toFixed(1))}M`;
  if (a >= 100_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a).toLocaleString("en-US")}`;
}

/** Split a compact money string into {symbol, digits, suffix} for the
 *  Money Register treatment (dim $/suffix, full-weight digits). */
export function moneyRegister(v: string | number | null | undefined): {
  symbol: string;
  digits: string;
  suffix: string;
} | null {
  const s = moneyCompact(v);
  if (s === MDASH) return null;
  const m = s.match(/^(−?\$)([\d,.]+)([KMB]?)$/);
  if (!m) return { symbol: "", digits: s, suffix: "" };
  return { symbol: m[1], digits: m[2], suffix: m[3] };
}

export function countFull(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  return Math.round(n).toLocaleString("en-US");
}

export function countCompact(v: string | number | null | undefined): string {
  const n = toNumber(v);
  if (n === null) return MDASH;
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${trimZeros((n / 1_000_000).toFixed(1))}M`;
  if (a >= 100_000) return `${Math.round(n / 1_000)}K`;
  if (a >= 10_000) return `${trimZeros((n / 1_000).toFixed(1))}K`;
  return countFull(n);
}

function trimZeros(s: string): string {
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** sha256 midline ellipsis: first 8 · last 8. */
export function hashShort(sha: string): string {
  const s = sha.trim();
  if (s.length <= 20) return s;
  return `${s.slice(0, 8)}…${s.slice(-8)}`;
}

export function dateShort(v: string | Date | null | undefined): string {
  if (!v) return MDASH;
  const d = typeof v === "string" ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return MDASH;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export const ORG_TYPE_LABELS: Record<string, string> = {
  private_foundation: "Private Foundation",
  public_charity: "Public Charity",
  vc: "Venture Capital",
  pe: "Private Equity",
  family_office: "Family Office",
  angel_group: "Angel Group",
  accelerator: "Accelerator",
  corporate_vc: "Corporate VC",
  investment_adviser: "Investment Adviser",
  fund: "Fund",
  gov_agency: "Federal Agency",
  company: "Company",
  other: "Other",
};

/** The trichotomy: which money-category an org type or event type belongs to. */
export type Category = "equity" | "grant" | "federal" | null;

export function orgCategory(orgType: string): Category {
  if (["vc", "pe", "family_office", "angel_group", "corporate_vc", "investment_adviser", "fund", "accelerator"].includes(orgType))
    return "equity";
  if (["private_foundation", "public_charity"].includes(orgType)) return "grant";
  if (orgType === "gov_agency") return "federal";
  return null;
}

export function eventCategory(eventType: string): Category {
  if (eventType === "reg_d_offering" || eventType === "equity_investment")
    return "equity";
  if (eventType === "grant") return "grant";
  if (["sbir_award", "sttr_award", "federal_grant", "federal_contract"].includes(eventType))
    return "federal";
  return null;
}

export const EVENT_TYPE_LABELS: Record<string, string> = {
  grant: "Grant",
  sbir_award: "SBIR Award",
  sttr_award: "STTR Award",
  federal_grant: "Federal Grant",
  federal_contract: "Federal Contract",
  reg_d_offering: "Reg D Offering",
  equity_investment: "Equity Investment",
  other: "Other",
};
