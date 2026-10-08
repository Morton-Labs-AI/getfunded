/**
 * CSV export of the saved-funders list, honouring the plan's export level
 * (docs/PLANS.md): Free is capped at 100 rows, paid plans export everything.
 *
 * Pure: the row limit is a number the caller resolves from `planFor()`, and
 * the output is a string the route or action turns into a download.
 */
import type { Plan } from "@/lib/plans";
import { formatEin } from "@/lib/format";

import { STAGE_LABELS } from "./stages";
import type { SavedFunder } from "./types";

export type ExportResult = {
  csv: string;
  /** Rows written (excluding the header). */
  rows: number;
  /** Rows that were available before the cap. */
  total: number;
  truncated: boolean;
  /** The cap that applied, or null for unlimited. */
  limit: number | null;
};

/** The row cap a plan allows: 0 for none, null for unlimited. */
export function exportLimitFor(plan: Pick<Plan, "export" | "export_rows">): number | null {
  if (plan.export === "none") return 0;
  if (plan.export === "limited100") return plan.export_rows ?? 100;
  return null;
}

/** RFC 4180 quoting; also neutralises spreadsheet formula injection (=, +, -, @). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const EXPORT_COLUMNS = [
  "Funder",
  "EIN",
  "Type",
  "City",
  "State",
  "Website",
  "Stage",
  "Tier",
  "Owner",
  "Planned ask",
  "Next action",
  "Next action due",
  "Why on list",
  "Tags",
  "Last contact",
  "Saved on",
] as const;

export function savedFunderRow(f: SavedFunder): string[] {
  return [
    f.snapshot.name,
    f.snapshot.ein ? formatEin(f.snapshot.ein) : "",
    f.snapshot.orgType ?? "",
    f.snapshot.city ?? "",
    f.snapshot.state ?? "",
    f.snapshot.website ?? "",
    STAGE_LABELS[f.stage],
    f.tier === null ? "" : `Tier ${f.tier}`,
    f.ownerName ?? "",
    f.askAmount === null ? "" : String(f.askAmount),
    f.nextAction ?? "",
    f.nextActionDue ?? "",
    f.sourceDetail ?? "",
    f.tags.join("; "),
    f.lastTouchAt ? f.lastTouchAt.slice(0, 10) : "",
    f.createdAt.slice(0, 10),
  ];
}

/**
 * Build the CSV. A `limit` of null writes every row; 0 writes only the
 * header. Missing values are empty cells, never "$0" or "N/A".
 */
export function buildSavedCsv(rows: ReadonlyArray<SavedFunder>, opts: { limit: number | null }): ExportResult {
  const total = rows.length;
  const take = opts.limit === null ? rows : rows.slice(0, Math.max(0, opts.limit));
  const lines = [EXPORT_COLUMNS.map(csvCell).join(",")];
  for (const f of take) lines.push(savedFunderRow(f).map(csvCell).join(","));
  return {
    csv: `${lines.join("\r\n")}\r\n`,
    rows: take.length,
    total,
    truncated: take.length < total,
    limit: opts.limit,
  };
}

/** `saved-funders-2026-10-07.csv` */
export function exportFilename(now: Date = new Date()): string {
  return `saved-funders-${now.toISOString().slice(0, 10)}.csv`;
}
