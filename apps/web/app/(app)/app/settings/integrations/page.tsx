import type { Metadata } from "next";
import { Suspense } from "react";

import { IntegrationsPanel } from "@/components/settings/integrations-panel";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { aiHealth } from "@/lib/billing/health";
import { withUser } from "@/lib/db/app";
import { can, isSelfHosted } from "@/lib/plans";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import { canManageApiKeys } from "@/lib/settings/roles";
import { getIntegrationStatus, listApiKeys, loadWorkspacePlan } from "@/lib/settings/service";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Integrations" };

export default function IntegrationsSettingsPage() {
  return (
    <SettingsSection title={SETTINGS_COPY.integrations.title} description={SETTINGS_COPY.integrations.description}>
      <Suspense fallback={<SettingsSkeleton rows={4} />}>
        <IntegrationsContent />
      </Suspense>
    </SettingsSection>
  );
}

function envSet(name: string): boolean {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

async function IntegrationsContent() {
  const { user, workspace } = await requireWorkspace();
  const selfHosted = isSelfHosted();

  const view = await withUser(user.id, async (sql) => {
    const { plan } = await loadWorkspacePlan(sql, workspace.id, process.env);
    const status = await getIntegrationStatus(sql, workspace.id, user.id);
    const apiAllowed = can(plan, "api");
    const keys = apiAllowed && canManageApiKeys(workspace.role) ? await listApiKeys(sql, workspace.id) : [];
    return {
      ai: aiHealth(),
      aiFlagEnabled: status.aiFlagEnabled,
      semanticSearch: envSet("VOYAGE_API_KEY"),
      gmail: {
        configured: envSet("GOOGLE_CLIENT_ID") && envSet("GOOGLE_CLIENT_SECRET"),
        allowed: can(plan, "send_gmail"),
        connected: status.gmailConnected,
      },
      api: { allowed: apiAllowed, activeKeys: keys.filter((k) => !k.revoked_at).length },
      selfHosted,
    };
  });

  return <IntegrationsPanel view={view} />;
}
