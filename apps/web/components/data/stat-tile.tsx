import * as React from "react";
import Link from "next/link";
import { Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";

import { MINUS } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Missing } from "./missing";

export type StatTrend = {
  /** Signed change. Percent points by default. */
  value: number;
  /** "vs last year", "30d" */
  label?: string;
  /** Which direction is good news; drives colour. Defaults to up. */
  goodDirection?: "up" | "down";
  format?: "percent" | "number";
};

function TrendDelta({ trend }: { trend: StatTrend }) {
  const dir = trend.value > 0 ? "up" : trend.value < 0 ? "down" : "flat";
  const good = trend.goodDirection ?? "up";
  const tone = dir === "flat" ? "text-muted-foreground" : dir === good ? "text-success" : "text-danger";
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const magnitude = Math.abs(trend.value);
  const text = `${dir === "up" ? "+" : dir === "down" ? MINUS : ""}${magnitude}${trend.format === "number" ? "" : "%"}`;
  return (
    <span className={cn("tnum inline-flex items-center gap-1 font-medium", tone)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{dir === "up" ? "Up" : dir === "down" ? "Down" : "Unchanged"}</span>
      {text}
      {trend.label ? <span className="font-normal text-muted-foreground">{trend.label}</span> : null}
    </span>
  );
}

/**
 * A KPI tile: what is it, how big is it, is that good. A number with no
 * context is decoration, so give every tile a hint or a trend.
 * A null value renders the em dash, never 0.
 */
export function StatTile({
  label,
  value,
  hint,
  trend,
  icon: Icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: StatTrend;
  icon?: LucideIcon;
  href?: string;
  className?: string;
}) {
  const body = (
    <div
      data-slot="stat-tile"
      className={cn(
        "flex h-full flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground shadow-card",
        href && "transition-[border-color,box-shadow] duration-150 hover:border-primary-border hover:shadow-lift",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow text-muted-foreground">{label}</span>
        {Icon ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-inset text-ink-3">
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="tnum font-mono text-[26px] leading-none font-semibold tracking-tight text-foreground">
        {value === null || value === undefined || value === "" ? <Missing bare /> : value}
      </div>
      {trend || hint ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {trend ? <TrendDelta trend={trend} /> : null}
          {hint ? <span className="text-muted-foreground">{hint}</span> : null}
        </div>
      ) : null}
    </div>
  );

  return href ? (
    <Link href={href} className="block h-full rounded-lg">
      {body}
    </Link>
  ) : (
    body
  );
}
