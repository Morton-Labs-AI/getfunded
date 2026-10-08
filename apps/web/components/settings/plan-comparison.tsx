import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { PLANS, formatPlanPrice, isPaidPlanId, type Plan, type PlanId } from "@/lib/plans";
import { cn } from "@/lib/utils";

import { CheckoutButton } from "./billing-actions";

const PUBLIC_PLANS: PlanId[] = ["free", "starter", "pro", "team", "enterprise"];
const ORDER: Record<PlanId, number> = { free: 0, starter: 1, pro: 2, team: 3, enterprise: 4, unlimited: 5 };

function limit(value: number | null, unit?: string): string {
  if (value === null) return "Unlimited";
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

function exportLabel(plan: Plan): string {
  if (plan.export === "none") return "None";
  if (plan.export === "limited100") return "100 rows CSV";
  const extras = [plan.features.reports ? "reports" : null, plan.features.api ? "API" : null].filter(Boolean);
  return extras.length > 0 ? `Full CSV + ${extras.join(" + ")}` : "Full CSV";
}

function outreachLabel(plan: Plan): string {
  if (plan.features.dedicated_outreach) return "Dedicated outreach";
  if (plan.features.sequences) return "Send via Gmail, plus follow-ups that stop when a funder replies";
  if (plan.features.send_gmail) return "Send via your own Gmail";
  return "Drafts only";
}

/** The knowledge base is on every plan; what grows with the plan is how many people share it. */
export function knowledgeLabel(plan: Plan): string {
  if (plan.members === null) return "Shared across every seat";
  if (plan.members === 1) return "Included";
  return `Shared across ${formatNumber(plan.members)} seats`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="text-ink-3">{label}</span>
      <span className="text-right text-foreground">{children}</span>
    </div>
  );
}

/**
 * The five public plans from lib/plans.ts, side by side (stacked on phones).
 * The current plan is marked; higher plans get an Upgrade button when the
 * viewer may manage billing and the deployment has billing at all. Enterprise
 * is never self-serve: it links to /contact.
 */
export function PlanComparison({
  currentPlan,
  canBuy,
  hasSubscription,
}: {
  currentPlan: PlanId;
  /** Owner or admin on a hosted deployment. */
  canBuy: boolean;
  /** When true, changes go through the portal instead of a second checkout. */
  hasSubscription: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Plans</CardTitle>
        <CardDescription>
          Every plan includes funder search and full profiles: where every fact came from, and whether the funder says it
          accepts applications. Prices are per month.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {PUBLIC_PLANS.map((id) => {
            const plan = PLANS[id];
            const current = id === currentPlan;
            const higher = ORDER[id] > ORDER[currentPlan];
            const enterprise = id === "enterprise";
            return (
              <div
                key={id}
                data-current={current ? "" : undefined}
                className={cn(
                  "flex flex-col gap-3 rounded-lg border p-4",
                  current ? "border-primary-border bg-primary-tint/40" : "bg-surface",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{plan.name}</p>
                    <p className="tnum font-mono text-xl font-semibold text-foreground">
                      {formatPlanPrice(plan)}
                      <span className="text-xs font-normal text-ink-3"> / mo</span>
                    </p>
                  </div>
                  {current ? <Badge variant="yours">Current</Badge> : null}
                </div>
                <div className="divide-y">
                  <Row label="Members">{limit(plan.members)}</Row>
                  <Row label="AI credits">
                    {limit(plan.monthly_credits)}
                    {plan.monthly_credits !== null && ORDER[id] >= 3 ? " pooled" : ""}
                  </Row>
                  <Row label="Saved funders">{limit(plan.saved_funders_limit)}</Row>
                  <Row label="Pipelines">{limit(plan.pipelines_limit)}</Row>
                  <Row label="Export">{exportLabel(plan)}</Row>
                  <Row label="Outreach">{outreachLabel(plan)}</Row>
                  <Row label="Knowledge base">{knowledgeLabel(plan)}</Row>
                </div>
                {current ? (
                  <p className="mt-auto text-xs text-ink-3">Your plan.</p>
                ) : enterprise && higher ? (
                  <Button asChild size="sm" variant="outline" className="mt-auto">
                    <Link href="/contact">
                      Contact us about Enterprise
                      <ArrowUpRight aria-hidden />
                    </Link>
                  </Button>
                ) : canBuy && higher && isPaidPlanId(id) && !hasSubscription ? (
                  <CheckoutButton plan={id} size="sm" className="mt-auto">
                    Upgrade to {plan.name}
                  </CheckoutButton>
                ) : null}
              </div>
            );
          })}
        </div>
        {canBuy && hasSubscription ? (
          <p className="mt-3 text-xs text-ink-3">You already have a subscription. Change plans from the billing portal above.</p>
        ) : null}
        <p className="mt-3 text-xs text-ink-3">
          Plan changes take effect at once. The new plan&rsquo;s allowance applies from your next request; unused credits do
          not carry over. There is no silent overage: at the limit, the AI stops and tells you.
        </p>
      </CardContent>
    </Card>
  );
}
