import * as React from "react";

import { Missing } from "@/components/data/missing";
import { MINUS } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Small server-rendered charts for the steward pages. No client JS, no chart
 * library. Rules they all follow:
 *  - every value is also available as text (a chart is never the only channel)
 *  - role="img" + aria-label carries the summary for screen readers
 *  - colours are the --chart-N tokens, which flip in dark mode
 *  - zero draws as a visible baseline stub, never an invisible bar
 *  - a missing value is <Missing />, never 0
 */

export const CHART_PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

export function chartColor(i: number): string {
  return CHART_PALETTE[i % CHART_PALETTE.length];
}

const defaultFormat = (n: number) => String(n);

/* ------------------------------------------------------------------ bars */

export type BarDatum = { label: string; value: number; caption?: string };

/** Vertical bars for a short time series (days, weeks). */
export function BarChart({
  data,
  height = 132,
  color = "var(--chart-1)",
  format = defaultFormat,
  ariaLabel,
  showValues = true,
  labelEvery = 1,
  className,
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
  ariaLabel: string;
  /** Print the value above each bar (turn off for dense series). */
  showValues?: boolean;
  /** Print every Nth caption to keep dense axes readable. */
  labelEvery?: number;
  className?: string;
}) {
  if (data.length === 0) return <Missing kind="no-public-data" />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const summary = data.map((d) => `${d.label}: ${format(d.value)}`).join(", ");
  return (
    <div
      role="img"
      aria-label={`${ariaLabel}. ${summary}`}
      data-slot="bar-chart"
      className={cn("flex items-end gap-1", className)}
      style={{ height }}
    >
      {data.map((d, i) => {
        const pct = d.value / max;
        const showCaption = i % labelEvery === 0 || i === data.length - 1;
        return (
          <div key={`${d.label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${d.label}: ${format(d.value)}`}>
            {showValues ? (
              <span className="tnum text-[10px] font-medium text-ink-3">{d.value > 0 ? format(d.value) : ""}</span>
            ) : null}
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-[4px]"
                style={{
                  height: `${Math.max(d.value > 0 ? 6 : 2, pct * 100)}%`,
                  background: d.value > 0 ? color : "var(--border)",
                }}
              />
            </div>
            <span className={cn("w-full truncate text-center text-[10px] text-ink-4", !showCaption && "invisible")}>
              {d.caption ?? d.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------- stacked bars */

export type StackedSeries = { key: string; label: string; values: number[]; color?: string };

/** One column per day, one colour per series; legend with totals. */
export function StackedBars({
  labels,
  series,
  height = 160,
  format = defaultFormat,
  ariaLabel,
  labelEvery = 1,
  className,
}: {
  labels: string[];
  series: StackedSeries[];
  height?: number;
  format?: (n: number) => string;
  ariaLabel: string;
  labelEvery?: number;
  className?: string;
}) {
  if (labels.length === 0 || series.length === 0) return <Missing kind="no-public-data" />;
  const totals = labels.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const summary = labels.map((l, i) => `${l}: ${format(totals[i])}`).join(", ");
  return (
    <div data-slot="stacked-bars" className={className}>
      <div role="img" aria-label={`${ariaLabel}. ${summary}`} className="flex items-end gap-1" style={{ height }}>
        {labels.map((label, i) => {
          const total = totals[i];
          const pct = total / max;
          const showCaption = i % labelEvery === 0 || i === labels.length - 1;
          return (
            <div key={`${label}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${label}: ${format(total)}`}>
              <div className="flex w-full flex-1 items-end">
                <div
                  className="flex w-full flex-col-reverse overflow-hidden rounded-t-[4px]"
                  style={{ height: `${Math.max(total > 0 ? 6 : 2, pct * 100)}%`, background: total > 0 ? undefined : "var(--border)" }}
                >
                  {total > 0
                    ? series.map((s, si) => {
                        const v = s.values[i] ?? 0;
                        if (v <= 0) return null;
                        return <div key={s.key} style={{ height: `${(v / total) * 100}%`, background: s.color ?? chartColor(si) }} />;
                      })
                    : null}
                </div>
              </div>
              <span className={cn("w-full truncate text-center text-[10px] text-ink-4", !showCaption && "invisible")}>{label}</span>
            </div>
          );
        })}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Legend">
        {series.map((s, si) => (
          <li key={s.key} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color ?? chartColor(si) }} aria-hidden />
            <span className="text-ink-2">{s.label}</span>
            <span className="tnum font-medium text-foreground">{format(s.values.reduce((a, b) => a + b, 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------- funnel */

export type RankDatum = BarDatum & { note?: string; href?: string };

/** Horizontal ranking bars with the value inside the bar. */
export function FunnelBars({
  data,
  format = defaultFormat,
  labelWidth = "9rem",
  colorFor,
  className,
}: {
  data: RankDatum[];
  format?: (n: number) => string;
  labelWidth?: string;
  colorFor?: (d: RankDatum, i: number) => string;
  className?: string;
}) {
  if (data.length === 0) return <Missing kind="no-public-data" />;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ol data-slot="funnel-bars" className={cn("space-y-1.5", className)}>
      {data.map((d, i) => (
        <li key={`${d.label}-${i}`} className="flex items-center gap-3">
          <span className="shrink-0 truncate text-[12.5px] text-ink-2" style={{ width: labelWidth }} title={d.label}>
            {d.href ? (
              <a href={d.href} className="hover:text-foreground hover:underline">
                {d.label}
              </a>
            ) : (
              d.label
            )}
          </span>
          <div className="h-6 flex-1 overflow-hidden rounded-sm bg-inset">
            <div
              className="flex h-full items-center rounded-sm px-2"
              style={{
                width: `${Math.max(d.value > 0 ? 8 : 2, (d.value / max) * 100)}%`,
                background: colorFor?.(d, i) ?? chartColor(i),
              }}
            >
              {d.value > 0 ? <span className="tnum text-[11.5px] font-semibold text-white">{format(d.value)}</span> : null}
            </div>
          </div>
          <span className="tnum w-16 shrink-0 text-right text-[12px] text-ink-3">{d.note ?? (d.value === 0 ? format(0) : "")}</span>
        </li>
      ))}
    </ol>
  );
}

/* ----------------------------------------------------------- sparkline */

/** Tiny inline trend line for stat tiles. */
export function Sparkline({
  values,
  width = 96,
  height = 28,
  color = "var(--chart-1)",
  ariaLabel,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  ariaLabel: string;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => [i * step, height - ((v - min) / span) * (height - 4) - 2] as const);
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];
  return (
    <svg role="img" aria-label={ariaLabel} width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={area} fill={color} opacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

/* --------------------------------------------------------------- donut */

export function Donut({
  segments,
  size = 116,
  thickness = 14,
  centerValue,
  centerLabel,
  format = defaultFormat,
  ariaLabel,
}: {
  segments: { label: string; value: number; color?: string }[];
  size?: number;
  thickness?: number;
  centerValue?: string;
  centerLabel?: string;
  format?: (n: number) => string;
  ariaLabel: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div data-slot="donut" className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${ariaLabel}. ${segments.map((s) => `${s.label}: ${format(s.value)}`).join(", ")}`} className="shrink-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--inset)" strokeWidth={thickness} />
        {total > 0
          ? segments.map((s, i) => {
              const frac = s.value / total;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.color ?? chartColor(i)}
                  strokeWidth={thickness}
                  strokeDasharray={`${frac * c} ${c}`}
                  strokeDashoffset={-offset * c}
                  strokeLinecap="butt"
                />
              );
              offset += frac;
              return el;
            })
          : null}
        {centerValue ? (
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            transform={`rotate(90 ${size / 2} ${size / 2})`}
            fill="currentColor"
            className="tnum text-[17px] font-bold text-foreground"
          >
            {centerValue}
          </text>
        ) : null}
      </svg>
      <ul className="min-w-0 space-y-1">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2 text-[12.5px]">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color ?? chartColor(i) }} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
            <span className="tnum shrink-0 font-medium text-foreground">{format(s.value)}</span>
          </li>
        ))}
        {centerLabel ? <li className="pt-0.5 text-[11.5px] text-ink-4">{centerLabel}</li> : null}
      </ul>
    </div>
  );
}

/* ---------------------------------------------------------- delta chip */

/** Change versus the previous period. Arrow + word, never colour alone. */
export function Delta({
  value,
  suffix = "",
  goodDirection = "up",
  className,
}: {
  value: number;
  suffix?: string;
  goodDirection?: "up" | "down";
  className?: string;
}) {
  if (!Number.isFinite(value) || value === 0) {
    return <span className={cn("text-[11.5px] text-ink-4", className)}>No change</span>;
  }
  const up = value > 0;
  const good = goodDirection === "up" ? up : !up;
  return (
    <span className={cn("tnum inline-flex items-center gap-0.5 text-[11.5px] font-semibold", good ? "text-success" : "text-danger", className)}>
      <span aria-hidden>{up ? "▲" : "▼"}</span>
      {up ? "" : MINUS}
      {Math.abs(value)}
      {suffix}
      <span className="sr-only">{up ? "up" : "down"}</span>
    </span>
  );
}
