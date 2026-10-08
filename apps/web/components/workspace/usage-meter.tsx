import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { UsageSummary } from "@/lib/billing/meter";
import { formatDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The sidebar usage meter, fed by `getUsage()`. Shows AI credits used this
 * period against the plan's monthly limit; "unlimited" on self-hosted
 * installs. When the desktop sidebar is collapsed (`data-collapsed` on the
 * shell root) only the thin vertical bar shows.
 */
export function UsageMeter({ usage, className }: { usage: UsageSummary; className?: string }) {
  const limit = usage.monthlyLimit;
  const pct = limit ? Math.min(100, Math.round((usage.used / limit) * 100)) : 0;
  const nearLimit = limit !== null && pct >= 90;
  const atLimit = limit !== null && usage.used >= limit;
  const label = "AI credits this month";
  const text = limit === null ? `${formatNumber(usage.used)} used · unlimited` : `${formatNumber(usage.used)} of ${formatNumber(limit)}`;

  return (
    <>
      <Link
        href="/app/settings/billing"
        aria-label={`${label}: ${text}. Plan ${usage.planName}`}
        className={cn(
          "hidden size-9 items-center justify-center rounded-md outline-none hover:bg-sidebar-accent/60 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50 [[data-collapsed]_aside_&]:flex",
          className,
        )}
      >
        <span className="relative block h-5 w-1.5 overflow-hidden rounded-full bg-primary/15" aria-hidden>
          <span
            className={cn("absolute inset-x-0 bottom-0 rounded-full", nearLimit ? "bg-warning" : "bg-primary")}
            style={{ height: `${limit === null ? 100 : pct}%` }}
          />
        </span>
      </Link>

      <div
        data-slot="usage-meter"
        className={cn(
          "rounded-md border border-sidebar-border bg-surface/70 p-2.5 text-xs dark:bg-surface/40 [[data-collapsed]_aside_&]:hidden",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow text-muted-foreground">{label}</span>
          <Badge variant="secondary" className="px-1.5 text-[10px]">
            {usage.planName}
          </Badge>
        </div>
        {limit !== null ? (
          <Progress
            value={pct}
            aria-label={`${pct}% of AI credits used`}
            className="mt-2 h-1.5"
            indicatorClassName={nearLimit ? "bg-warning" : undefined}
          />
        ) : null}
        <div className="tnum mt-1.5 flex items-center justify-between text-ink-2">
          <span>{text}</span>
          {limit !== null ? <span className="text-ink-3">{pct}%</span> : null}
        </div>
        {atLimit ? (
          <Link href="/app/settings/billing" className="mt-1.5 block font-medium text-primary hover:underline">
            Limit reached. See plans.
          </Link>
        ) : (
          <p className="mt-1 text-ink-3">Resets {formatDate(usage.periodEnd)}</p>
        )}
      </div>
    </>
  );
}
