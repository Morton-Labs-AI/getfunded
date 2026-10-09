import Link from "next/link";
import { moneyCompact, moneyFull, MDASH } from "@/lib/format";

export interface FyBarDatum {
  fy: number;
  /** numeric-as-string (postgres.js). null = filing exists but the line is
      absent from the return → stub + MDASH. "0" = filed zero → real bar + $0.
      The missing-vs-reported-zero rule, in chart form. */
  value: string | null;
  /** optional per-bar link (e.g. the filing page for that FY) */
  href?: string;
  title?: string;
}

const WINDOW = 6;

/** Fiscal-year money series, server-rendered, zero JS — the financial-trends
    sibling of YearBars. Differences are deliberate: single value series (no
    count), NO earlier-years rollup (summing is wrong for stocks like assets),
    negative-aware (scaled on |value|, label in the negative color with the
    true minus moneyCompact already emits), and gap years render as border
    stubs with MDASH. */
export function FyBars({
  data,
  fill,
  window = WINDOW,
}: {
  data: FyBarDatum[];
  fill: string;
  window?: number;
}) {
  if (data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a.fy - b.fy);
  const byFy = new Map(sorted.map((d) => [d.fy, d]));
  const maxFy = sorted[sorted.length - 1].fy;
  const firstVisible = Math.max(sorted[0].fy, maxFy - window + 1);
  const years: number[] = [];
  for (let fy = firstVisible; fy <= maxFy; fy++) years.push(fy);

  const max = Math.max(
    ...years.map((fy) => Math.abs(Number(byFy.get(fy)?.value ?? 0))),
    1
  );

  return (
    <div className="flex items-end gap-2 border-b border-border-1 pb-px">
      {years.map((fy) => {
        const d = byFy.get(fy);
        const has = d !== undefined && d.value !== null;
        const n = has ? Number(d.value) : 0;
        const bar = (
          <div className="flex flex-col items-center gap-1">
            <span
              className="tnum font-mono text-[10px]"
              style={{ color: has && n < 0 ? "var(--negative)" : "var(--ink-3)" }}
            >
              {has ? moneyCompact(d.value) : MDASH}
            </span>
            <div
              className="w-7 rounded-t-[2px]"
              style={{
                height: has ? Math.max(6, (Math.abs(n) / max) * 48) : 6,
                background: has ? fill : "var(--border-1)",
              }}
              title={
                d?.title ??
                (has
                  ? `FY${fy}: ${moneyFull(d.value)}`
                  : `FY${fy}: not on file`)
              }
            />
            <span className="tnum font-mono text-[10px] text-ink-4">{fy}</span>
          </div>
        );
        return d?.href ? (
          <Link key={fy} href={d.href} className="hover:opacity-80">
            {bar}
          </Link>
        ) : (
          <span key={fy}>{bar}</span>
        );
      })}
    </div>
  );
}
