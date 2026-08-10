import { moneyFull, MDASH } from "@/lib/format";

export interface BreakdownRow {
  label: string;
  /** numeric-as-string; null rows are omitted (line absent from the return) */
  value: string | null;
}

/** Labeled proportional bars in the GeoTable idiom (server-rendered, zero
    JS): per-line label + bar + amount + percent-of-total. Used for the
    "where the money came from / where it went" Part I breakdowns. Rows with
    a filed zero render a floor-width bar and $0; NULL rows are dropped —
    the missing-vs-reported-zero rule again. */
export function BreakdownBars({
  rows,
  total,
  fill,
}: {
  rows: BreakdownRow[];
  total: string | null;
  fill: string;
}) {
  const present = rows.filter((r) => r.value !== null);
  if (present.length === 0) return null;
  const max = Math.max(...present.map((r) => Math.abs(Number(r.value))), 1);
  const denom = total !== null ? Number(total) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      {present.map((r) => {
        const n = Number(r.value);
        const pct = denom > 0 ? Math.round((100 * n) / denom) : null;
        return (
          <div key={r.label} className="flex items-center gap-3">
            <span className="mono-label w-[190px] shrink-0 normal-case tracking-[0.04em]">
              {r.label}
            </span>
            <div className="h-[14px] flex-1 overflow-hidden rounded-[3px] bg-inset">
              <div
                className="h-full rounded-[3px]"
                style={{
                  width: `${Math.max((Math.abs(n) / max) * 100, 0.75)}%`,
                  background: n < 0 ? "var(--negative)" : fill,
                }}
              />
            </div>
            <span className="tnum w-[110px] shrink-0 text-right font-mono text-[12.5px] text-ink-1">
              {moneyFull(r.value)}
            </span>
            <span className="tnum w-[44px] shrink-0 text-right font-mono text-[11.5px] text-ink-4">
              {pct !== null ? `${pct}%` : MDASH}
            </span>
          </div>
        );
      })}
    </div>
  );
}
