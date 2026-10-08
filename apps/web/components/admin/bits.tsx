import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { PLANS, isPlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

/** Shared small pieces for the steward pages. */

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({
  title,
  description,
  children,
  className,
  aside,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  aside?: React.ReactNode;
}) {
  return (
    <section className={cn("rounded-lg border bg-card p-4 text-card-foreground shadow-card sm:p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {aside ? <div className="shrink-0 text-xs text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function PlanBadge({ plan }: { plan: string }) {
  const name = isPlanId(plan) ? PLANS[plan].name : plan;
  const paid = isPlanId(plan) && PLANS[plan].price_cents_monthly > 0;
  return (
    <Badge variant={plan === "unlimited" ? "outline" : paid ? "default" : "secondary"} className="capitalize">
      {name}
    </Badge>
  );
}

const LEDGER_STATUS: Record<string, { label: string; variant: "success" | "warning" | "secondary" }> = {
  settled: { label: "Settled", variant: "success" },
  reserved: { label: "Reserved", variant: "warning" },
  refunded: { label: "Refunded", variant: "secondary" },
};

export function LedgerStatus({ status }: { status: string }) {
  const s = LEDGER_STATUS[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const SUBSCRIPTION_STATUS: Record<string, { label: string; variant: "success" | "warning" | "danger" | "secondary" }> = {
  trialing: { label: "Trial", variant: "success" },
  active: { label: "Active", variant: "success" },
  past_due: { label: "Payment overdue", variant: "warning" },
  canceled: { label: "Canceled", variant: "secondary" },
  unpaid: { label: "Unpaid", variant: "danger" },
};

export function SubscriptionStatus({ status }: { status: string | null }) {
  if (!status) return <span className="text-xs text-muted-foreground">No subscription</span>;
  const s = SUBSCRIPTION_STATUS[status] ?? { label: status, variant: "secondary" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/** Plain-language feature names for the ledger. */
export const FEATURE_LABELS: Record<string, string> = {
  filter: "Search filter",
  ask: "Ask the analyst",
  draft: "Draft polish",
  fit: "Fit analysis",
  research: "Research dossier",
};

export function featureLabel(feature: string): string {
  return FEATURE_LABELS[feature] ?? feature;
}

/** "Oct 7" axis captions from YYYY-MM-DD. */
export function dayCaption(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
