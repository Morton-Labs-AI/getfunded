import Link from "next/link";
import { Check, Minus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { CREDIT_COSTS, FEATURES, PLANS, formatPlanPrice, type Plan, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { FEATURE_COPY, PLAN_COPY, PLAN_ORDER } from "./copy";

/**
 * Plan cards and tables rendered straight from lib/plans.ts, the code twin
 * of docs/PLANS.md. No price or limit is typed here.
 */

type PublicPlanId = Exclude<PlanId, "unlimited">;

function limit(v: number | null, unit?: string): string {
  if (v === null) return "Unlimited";
  return unit ? `${formatNumber(v)} ${unit}` : formatNumber(v);
}

function exportText(plan: Plan): string {
  if (plan.export === "none") return "No export";
  if (plan.export === "limited100") return `${formatNumber(plan.export_rows)} rows CSV`;
  const parts = ["Full CSV"];
  if (plan.features.reports) parts.push("reports");
  if (plan.features.api) parts.push("API");
  return parts.join(" + ");
}

function outreachText(plan: Plan): string {
  if (plan.features.dedicated_outreach) return "Dedicated outreach: managed campaigns, sender domains, deliverability, onboarding, SLA";
  if (plan.features.sequences) return "Send through your own Gmail, each message approved by you, plus sequences and a shared knowledge base";
  if (plan.features.send_gmail) return "Send through your own Gmail, each message approved by you";
  return "Drafts only (uses credits)";
}

function creditsText(plan: Plan): string {
  if (plan.monthly_credits === null) return "Unlimited";
  const pooled = plan.members === null || plan.members > 3 ? " pooled" : "";
  return `${formatNumber(plan.monthly_credits)} / month${pooled}`;
}

export function PlanCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {PLAN_ORDER.map((id) => {
        const plan = PLANS[id];
        const copy = PLAN_COPY[id];
        const isEnterprise = id === "enterprise";
        const isFree = id === "free";
        const rows: Array<{ label: string; value: string }> = [
          { label: "Members", value: limit(plan.members) },
          { label: "AI credits", value: creditsText(plan) },
          { label: "Saved funders", value: limit(plan.saved_funders_limit) },
          { label: "Pipelines", value: limit(plan.pipelines_limit) },
          { label: "Export", value: exportText(plan) },
          { label: "Outreach", value: outreachText(plan) },
        ];
        return (
          <div
            key={id}
            data-plan={id}
            className={cn(
              "flex flex-col rounded-lg border bg-card p-5 shadow-card",
              isFree && "border-primary-border ring-1 ring-primary-border",
            )}
          >
            <div>
              <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
              <p className="mt-1 text-sm text-ink-3">{copy.audience}</p>
              <p className="tnum mt-4 flex items-baseline gap-1 font-mono">
                <span className="text-3xl font-semibold tracking-tight text-foreground">{formatPlanPrice(plan)}</span>
                <span className="text-sm text-ink-3">/ month</span>
              </p>
              <p className="mt-2 text-sm font-medium text-ink-2">{copy.tagline}</p>
            </div>
            <dl className="mt-5 flex flex-1 flex-col gap-2.5 border-t pt-4 text-sm">
              {rows.map((row) => (
                <div key={row.label} className="flex flex-col gap-0.5">
                  <dt className="eyebrow text-ink-4">{row.label}</dt>
                  <dd className="text-ink-2">{row.value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-5">
              {isEnterprise ? (
                <Button variant="outline" className="w-full" asChild>
                  <Link href="/contact">Contact us</Link>
                </Button>
              ) : (
                <Button variant={isFree ? "default" : "outline"} className="w-full" asChild>
                  <Link href="/signin">Start free</Link>
                </Button>
              )}
              {!isFree && !isEnterprise ? (
                <p className="mt-2 text-center text-xs text-ink-3">Upgrade from Settings once you are in.</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** What each metered feature costs, from CREDIT_COSTS. */
export function CreditTable() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Feature</TableHead>
          <TableHead className="hidden sm:table-cell">What happens</TableHead>
          <TableHead className="text-right">Credits</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {FEATURES.map((feature) => (
          <TableRow key={feature}>
            <TableCell className="whitespace-normal font-medium text-foreground">
              {FEATURE_COPY[feature].name}
              <span className="mt-0.5 block text-xs font-normal text-ink-3 sm:hidden">{FEATURE_COPY[feature].body}</span>
            </TableCell>
            <TableCell className="hidden whitespace-normal text-ink-2 sm:table-cell">{FEATURE_COPY[feature].body}</TableCell>
            <TableCell className="text-right font-mono">{CREDIT_COSTS[feature]}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Yes({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-success">
      <Check className="size-4" aria-hidden />
      <span className={label ? undefined : "sr-only"}>{label ?? "Included"}</span>
    </span>
  );
}

function No() {
  return (
    <span className="inline-flex items-center text-ink-4">
      <Minus className="size-4" aria-hidden />
      <span className="sr-only">Not included</span>
    </span>
  );
}

/** Row-by-row comparison across the five public plans. */
export function PlanCompareTable() {
  const plans = PLAN_ORDER.map((id) => PLANS[id]);
  const rows: Array<{ label: string; cell: (p: Plan, id: PublicPlanId) => React.ReactNode }> = [
    { label: "Price per month", cell: (p) => <span className="font-mono">{formatPlanPrice(p)}</span> },
    { label: "Members", cell: (p) => limit(p.members) },
    { label: "AI credits per month", cell: (p) => (p.monthly_credits === null ? "Unlimited" : formatNumber(p.monthly_credits)) },
    { label: "Daily soft cap", cell: (p) => (p.daily_credits === null ? "None" : formatNumber(p.daily_credits)) },
    { label: "Daily cap can be turned off", cell: (p) => (p.can_disable_daily_cap ? <Yes /> : <No />) },
    { label: "Saved funders", cell: (p) => limit(p.saved_funders_limit) },
    { label: "Pipelines", cell: (p) => limit(p.pipelines_limit) },
    { label: "Export", cell: (p) => exportText(p) },
    { label: "Funder search and profiles", cell: () => <Yes /> },
    { label: "Fit analysis, research, Ask", cell: (p) => (p.features.fit && p.features.research && p.features.ask ? <Yes /> : <No />) },
    { label: "Outreach drafts", cell: (p) => (p.features.draft ? <Yes /> : <No />) },
    { label: "Send through your own Gmail", cell: (p) => (p.features.send_gmail ? <Yes /> : <No />) },
    { label: "Reports", cell: (p) => (p.features.reports ? <Yes /> : <No />) },
    { label: "API", cell: (p) => (p.features.api ? <Yes /> : <No />) },
    { label: "Sequences", cell: (p) => (p.features.sequences ? <Yes /> : <No />) },
    { label: "Shared knowledge base", cell: (p) => (p.features.shared_knowledge ? <Yes /> : <No />) },
    { label: "Dedicated outreach and SLA", cell: (p) => (p.features.dedicated_outreach ? <Yes /> : <No />) },
  ];

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-44">Plan</TableHead>
          {plans.map((p) => (
            <TableHead key={p.id} className="text-right">
              {p.name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label}>
            <TableCell className="whitespace-normal font-medium text-foreground">{row.label}</TableCell>
            {PLAN_ORDER.map((id) => (
              <TableCell key={id} className="text-right text-ink-2">
                {row.cell(PLANS[id], id)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
