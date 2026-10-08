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

/** Paid plans start free: sign in, then land on Billing to upgrade. */
export const UPGRADE_HREF = "/signin?next=/app/settings/billing";

/** The knowledge base is on every plan; what grows with the plan is how many people share it. */
function knowledgeText(plan: Plan): string {
  if (plan.members === null) return "Shared across every seat";
  if (plan.members === 1) return "Included";
  return `Shared across ${formatNumber(plan.members)} seats`;
}

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
  if (plan.features.sequences)
    return "Send through your own Gmail, each message approved by you, plus follow-ups that stop when a funder replies";
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
              ) : isFree ? (
                <Button className="w-full" asChild>
                  <Link href="/signin">Start free</Link>
                </Button>
              ) : (
                <Button variant="outline" className="w-full" asChild>
                  <Link href={UPGRADE_HREF}>Start free, then upgrade to {plan.name}</Link>
                </Button>
              )}
              {!isFree && !isEnterprise ? (
                <p className="mt-2 text-center text-xs text-ink-3">You upgrade from Settings → Billing after you sign in.</p>
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
    { label: "Most AI credits you can use in one day", cell: (p) => (p.daily_credits === null ? "No limit" : formatNumber(p.daily_credits)) },
    { label: "Daily limit can be turned off", cell: (p) => (p.can_disable_daily_cap ? <Yes /> : <No />) },
    { label: "Saved funders", cell: (p) => limit(p.saved_funders_limit) },
    { label: "Pipelines", cell: (p) => limit(p.pipelines_limit) },
    { label: "Export", cell: (p) => exportText(p) },
    { label: "Funder search and profiles", cell: () => <Yes /> },
    { label: "Fit analysis, research and Ask the analyst", cell: (p) => (p.features.fit && p.features.research && p.features.ask ? <Yes /> : <No />) },
    { label: "Outreach drafts", cell: (p) => (p.features.draft ? <Yes /> : <No />) },
    { label: "Send through your own Gmail", cell: (p) => (p.features.send_gmail ? <Yes /> : <No />) },
    { label: "Reports", cell: (p) => (p.features.reports ? <Yes /> : <No />) },
    { label: "API", cell: (p) => (p.features.api ? <Yes /> : <No />) },
    { label: "Follow-ups that stop when a funder replies", cell: (p) => (p.features.sequences ? <Yes /> : <No />) },
    { label: "Knowledge base", cell: (p) => knowledgeText(p) },
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
