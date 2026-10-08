import { AlertTriangle, CheckCircle2, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type { UsageSummary } from "@/lib/billing/meter";
import { PLANS, formatPlanPrice, type PlanId } from "@/lib/plans";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import type { SubscriptionRow } from "@/lib/settings/service";

import { DailyCapForm, PortalButton } from "./billing-actions";
import { PlanComparison } from "./plan-comparison";
import { Notice } from "./settings-section";
import { UsageDetail } from "./usage-detail";

const STATUS_LABELS: Record<SubscriptionRow["status"], { label: string; variant: "success" | "warning" | "danger" | "secondary" }> = {
  trialing: { label: "Trial", variant: "secondary" },
  active: { label: "Active", variant: "success" },
  past_due: { label: "Payment past due", variant: "warning" },
  canceled: { label: "Canceled", variant: "danger" },
  unpaid: { label: "Unpaid", variant: "danger" },
};

export function BillingPanel({
  workspace,
  plan,
  usage,
  subscription,
  hasBillingAccount,
  selfHosted,
  canManage,
  checkoutResult,
}: {
  workspace: { id: string; version: number; dailyCapEnabled: boolean };
  plan: { id: PlanId; name: string; canDisableDailyCap: boolean };
  usage: UsageSummary;
  subscription: SubscriptionRow | null;
  hasBillingAccount: boolean;
  selfHosted: boolean;
  canManage: boolean;
  checkoutResult?: "success" | "canceled" | null;
}) {
  const def = PLANS[plan.id];
  const status = subscription ? STATUS_LABELS[subscription.status] : null;
  const pastDue = subscription?.status === "past_due";

  return (
    <div className="flex flex-col gap-5">
      {checkoutResult === "success" ? (
        <Notice tone="success" icon={<CheckCircle2 />} title="Thank you.">
          Your payment went through. If the plan below has not updated yet, give it a few seconds and reload: Stripe tells
          us about the change in the background.
        </Notice>
      ) : null}
      {checkoutResult === "canceled" ? (
        <Notice tone="info" icon={<Info />}>Checkout was canceled. Nothing was charged and your plan did not change.</Notice>
      ) : null}
      {pastDue ? (
        <Notice tone="warning" icon={<AlertTriangle />} title="Payment past due">
          {SETTINGS_COPY.billing.pastDue}
          {canManage && !selfHosted ? (
            <div className="mt-2">
              <PortalButton size="sm">Update payment method</PortalButton>
            </div>
          ) : null}
        </Notice>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Current plan: {plan.name}
            {selfHosted ? <Badge variant="secondary">Self-hosted</Badge> : status ? <Badge variant={status.variant}>{status.label}</Badge> : null}
          </CardTitle>
          <CardDescription>
            {selfHosted
              ? SETTINGS_COPY.billing.selfHosted
              : def.price_cents_monthly === 0
                ? "Free. Upgrade any time; nothing changes until you do."
                : `${formatPlanPrice(def)} per month.`}
          </CardDescription>
        </CardHeader>
        {!selfHosted ? (
          <CardContent className="flex flex-col gap-4">
            {subscription ? (
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="text-ink-3">Next billing date</dt>
                  <dd className="tnum font-medium text-foreground">
                    {subscription.cancel_at_period_end ? "Ends " : ""}
                    {formatDate(subscription.current_period_end, "long")}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 sm:block">
                  <dt className="text-ink-3">Credits reset</dt>
                  <dd className="tnum font-medium text-foreground">{formatDate(usage.periodEnd, "long")}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-3">
                Credits reset on <span className="tnum font-medium text-foreground">{formatDate(usage.periodEnd, "long")}</span>.
              </p>
            )}
            {subscription?.cancel_at_period_end ? (
              <Notice tone="info" icon={<Info />}>
                This subscription is set to end at the end of the period. You keep the plan until then.
              </Notice>
            ) : null}
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {hasBillingAccount ? <PortalButton /> : null}
              </div>
            ) : (
              <p className="text-xs text-ink-3">{SETTINGS_COPY.billing.memberOnly}</p>
            )}
            {canManage ? (
              <DailyCapForm
                workspaceId={workspace.id}
                version={workspace.version}
                enabled={workspace.dailyCapEnabled}
                canDisable={plan.canDisableDailyCap}
              />
            ) : null}
          </CardContent>
        ) : null}
      </Card>

      <UsageDetail usage={usage} selfHosted={selfHosted} />

      {!selfHosted ? (
        <PlanComparison
          currentPlan={plan.id}
          canBuy={canManage}
          hasSubscription={Boolean(subscription && ["trialing", "active", "past_due"].includes(subscription.status))}
        />
      ) : null}
    </div>
  );
}
