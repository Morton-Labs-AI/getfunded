import { MDASH, formatMoneyCompact } from "@/lib/format";

export type FyBarDatum = { label: string; value: number | null; caption?: string };

const BAR_W = 28;
const GAP = 14;
const TOP = 16;
const BOTTOM = 18;

/**
 * Hand-rolled SVG bars for a short fiscal-year series. Rules:
 *  - every value is also in text (the aria-label and the caption row);
 *  - colours come from the chart tokens, which flip in dark mode;
 *  - a missing year is a dotted stub and reads "not available", never zero;
 *  - a real zero is a thin baseline mark, visible on purpose.
 */
export function FyBars({
  data,
  height = 120,
  color = "var(--chart-1)",
  format = (n: number) => formatMoneyCompact(n),
  ariaLabel,
}: {
  data: FyBarDatum[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  if (data.length === 0) return null;
  const values = data.map((d) => d.value).filter((v): v is number => v !== null && Number.isFinite(v));
  const max = Math.max(...values, 1);
  const width = data.length * (BAR_W + GAP) - GAP;
  const plotH = height - TOP - BOTTOM;
  const summary = data.map((d) => `${d.label}: ${d.value === null ? "not available" : format(d.value)}`).join(", ");

  return (
    <figure className="w-full overflow-x-auto">
      <svg
        role="img"
        aria-label={`${ariaLabel}. ${summary}`}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block max-w-full text-ink-3"
        style={{ minWidth: Math.min(width, 320) }}
      >
        <line x1={0} x2={width} y1={TOP + plotH + 0.5} y2={TOP + plotH + 0.5} stroke="var(--border-strong)" strokeWidth={1} />
        {data.map((d, i) => {
          const x = i * (BAR_W + GAP);
          const baseY = TOP + plotH;
          if (d.value === null) {
            return (
              <g key={d.label + i}>
                <rect x={x} y={baseY - 10} width={BAR_W} height={10} fill="none" stroke="var(--border-strong)" strokeDasharray="2 2" rx={3} />
                <text x={x + BAR_W / 2} y={TOP - 4} textAnchor="middle" fontSize={10} fill="currentColor">
                  {MDASH}
                </text>
                <text x={x + BAR_W / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="currentColor">
                  {d.caption ?? d.label}
                </text>
              </g>
            );
          }
          const h = d.value > 0 ? Math.max(3, (Math.abs(d.value) / max) * plotH) : 2;
          return (
            <g key={d.label + i}>
              <rect x={x} y={baseY - h} width={BAR_W} height={h} fill={color} rx={3} />
              <text x={x + BAR_W / 2} y={TOP - 4} textAnchor="middle" fontSize={10} fill="currentColor" className="tnum">
                {format(d.value)}
              </text>
              <text x={x + BAR_W / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="currentColor">
                {d.caption ?? d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

export type SplitSegment = { label: string; value: number | null; color: string };

/** The legend / aria text for one segment: a share, or "not available" when the return carries no line. */
export function splitSegmentText(s: SplitSegment, total: number): string {
  if (s.value === null) return `${s.label} not available`;
  return `${s.label} ${Math.round((Math.max(0, s.value) / total) * 100)}%`;
}

/**
 * A single horizontal split bar (program / management / fundraising). A null
 * segment is a line the return does not carry: it takes no width, and the
 * legend says "not available" instead of showing it as 0%.
 */
export function SplitBar({
  segments,
  ariaLabel,
}: {
  segments: SplitSegment[];
  ariaLabel: string;
}) {
  const present = segments.filter((s): s is SplitSegment & { value: number } => s.value !== null);
  const total = present.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;
  const summary = segments.map((s) => splitSegmentText(s, total)).join(", ");
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-inset" role="img" aria-label={`${ariaLabel}: ${summary}`}>
        {present.map((s) => (
          <div key={s.label} style={{ width: `${(Math.max(0, s.value) / total) * 100}%`, background: s.color }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.value === null ? "transparent" : s.color, outline: s.value === null ? "1px dashed var(--border-strong)" : undefined }} aria-hidden />
            <span className="text-ink-2">{s.label}</span>
            {s.value === null ? <span className="text-ink-3">not available</span> : <span className="tnum font-medium text-foreground">{Math.round((Math.max(0, s.value) / total) * 100)}%</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
