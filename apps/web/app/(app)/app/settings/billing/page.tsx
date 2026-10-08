import type { Metadata } from "next";
import { Suspense } from "react";

import { BillingPanel } from "@/components/settings/billing-panel";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { firstParam } from "@/lib/auth/next-path";
import { getUsage } from "@/lib/billing/meter";
import { withUser } from "@/lib/db/app";
import { isSelfHosted } from "@/lib/plans";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import { canManageBilling } from "@/lib/settings/roles";
import { getSubscription, hasBillingAccount, loadWorkspacePlan } from "@/lib/settings/service";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Billing" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function BillingSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <SettingsSection title={SETTINGS_COPY.billing.title} description={SETTINGS_COPY.billing.description}>
      <Suspense fallback={<SettingsSkeleton rows={6} />}>
        <BillingContent searchParams={searchParams} />
      </Suspense>
    </SettingsSection>
  );
}

async function BillingContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const checkout = firstParam(params.checkout);
  const checkoutResult = checkout === "success" || checkout === "canceled" ? checkout : null;

  const { user, workspace } = await requireWorkspace();
  const selfHosted = isSelfHosted();
  const canManage = canManageBilling(workspace.role) && !selfHosted;

  const usage = await getUsage(workspace.id, user.id);
  const { plan, subscription, billingAccount, dailyCapEnabled } = await withUser(user.id, async (sql) => {
    const { plan, workspace: row } = await loadWorkspacePlan(sql, workspace.id, process.env);
    const subscription = selfHosted ? null : await getSubscription(sql, workspace.id);
    const billingAccount = selfHosted ? false : await hasBillingAccount(sql, workspace.id);
    const settings = (row.settings ?? {}) as { daily_cap_enabled?: unknown };
    return { plan, subscription, billingAccount, dailyCapEnabled: settings.daily_cap_enabled !== false };
  });

  return (
    <BillingPanel
      workspace={{ id: workspace.id, version: workspace.version, dailyCapEnabled }}
      plan={{ id: plan.id, name: plan.name, canDisableDailyCap: plan.can_disable_daily_cap }}
      usage={usage}
      subscription={subscription}
      hasBillingAccount={billingAccount}
      selfHosted={selfHosted}
      canManage={canManage}
      checkoutResult={checkoutResult}
    />
  );
}
