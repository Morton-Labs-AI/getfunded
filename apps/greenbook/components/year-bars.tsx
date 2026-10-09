import { moneyCompact, moneyFull, countFull, MDASH } from "@/lib/format";

export interface YearBarDatum {
  fy: number;
  n: string;
  total: string | null;
}

const WINDOW = 6;

/** Shared fiscal-year bar strip (server-rendered, zero JS).
    Normalizes input order, zero-fills gap years inside the window, windows
    to the last 6 FYs, and rolls earlier years up into a one-line note.
    `fill` is a Greenbook CSS var, e.g. "var(--cat-grant-fill)". */
export function YearBars({
  data,
  fill,
  unitLabel,
}: {
  data: YearBarDatum[];
  fill: string;
  unitLabel: string;
}) {
  if (data.length === 0) return null;
  const sorted = [...data].sort((a, b) => a.fy - b.fy);
  const byFy = new Map(sorted.map((d) => [d.fy, d]));
  const maxFy = sorted[sorted.length - 1].fy;
  const windowStart = maxFy - WINDOW + 1;
  const firstVisible = Math.max(sorted[0].fy, windowStart);
  const years: number[] = [];
  for (let fy = firstVisible; fy <= maxFy; fy++) years.push(fy);

  const pre = sorted.filter((d) => d.fy < windowStart);
  const preN = pre.reduce((s, d) => s + Number(d.n), 0);
  const preTotal = pre.reduce((s, d) => s + Number(d.total ?? 0), 0);
  const max = Math.max(
    ...years.map((fy) => Number(byFy.get(fy)?.total ?? 0)),
    1
  );

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-end gap-2.5 border-b border-border-1 pb-px">
        {years.map((fy) => {
          const d = byFy.get(fy);
          const total = Number(d?.total ?? 0);
          return (
            <div key={fy} className="flex flex-col items-center gap-1">
              <span className="tnum font-mono text-[10px] text-ink-3">
                {d ? moneyCompact(d.total) : MDASH}
              </span>
              <div
                className="w-8 rounded-t-[2px]"
                style={{
                  height: d ? Math.max(6, (total / max) * 48) : 6,
                  background: d ? fill : "var(--border-1)",
                }}
                title={
                  d
                    ? `FY${fy}: ${countFull(d.n)} ${unitLabel} · ${moneyFull(d.total)}`
                    : `FY${fy}: no ${unitLabel} on file`
                }
              />
              <span className="tnum font-mono text-[10px] text-ink-4">{fy}</span>
            </div>
          );
        })}
      </div>
      {pre.length > 0 && (
        <span className="tnum font-mono text-[10px] text-ink-4">
          earlier: {countFull(String(preN))} {unitLabel} ·{" "}
          {moneyCompact(String(preTotal))}
        </span>
      )}
    </div>
  );
}
