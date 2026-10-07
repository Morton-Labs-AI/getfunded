import { MDASH } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Missing-data vocabulary. Each phrase means something different; pick on
 * purpose. Nothing in GetFunded renders "$0" or "N/A" for a missing value.
 */
export const MISSING_LABELS = {
  "not-available": "Not available",
  "not-verified": "Not verified",
  "no-public-data": "No public data found",
} as const;

export type MissingKind = keyof typeof MISSING_LABELS;

/**
 * The only way missing data renders.
 * `bare` shows an em dash (for dense tables and tiles) while keeping the full
 * label for assistive tech and on hover.
 */
export function Missing({
  kind = "not-available",
  bare = false,
  className,
}: {
  kind?: MissingKind;
  bare?: boolean;
  className?: string;
}) {
  const label = MISSING_LABELS[kind];
  if (bare) {
    return (
      <span data-slot="missing" className={cn("text-ink-4", className)} title={label}>
        <span aria-hidden>{MDASH}</span>
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span data-slot="missing" className={cn("text-sm text-ink-3", className)}>
      {label}
    </span>
  );
}
