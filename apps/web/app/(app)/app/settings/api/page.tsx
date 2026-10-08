import type { Metadata } from "next";
import { Suspense } from "react";

import { ApiKeysPanel } from "@/components/settings/api-keys-panel";
import { Notice, SettingsSection } from "@/components/settings/settings-section";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { UpgradeNotice } from "@/components/settings/upgrade-notice";
import { withUser } from "@/lib/db/app";
import { can } from "@/lib/plans";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import { canManageApiKeys } from "@/lib/settings/roles";
import { listApiKeys, loadWorkspacePlan } from "@/lib/settings/service";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "API keys" };

export default function ApiSettingsPage() {
  return (
    <SettingsSection title={SETTINGS_COPY.api.title} description={SETTINGS_COPY.api.description}>
      <Suspense fallback={<SettingsSkeleton rows={3} />}>
        <ApiContent />
      </Suspense>
    </SettingsSection>
  );
}

async function ApiContent() {
  const { user, workspace } = await requireWorkspace();
  const canManage = canManageApiKeys(workspace.role);

  const { allowed, keys } = await withUser(user.id, async (sql) => {
    const { plan } = await loadWorkspacePlan(sql, workspace.id, process.env);
    const allowed = can(plan, "api");
    const keys = allowed && canManage ? await listApiKeys(sql, workspace.id) : [];
    return { allowed, keys };
  });

  if (!allowed) return <UpgradeNotice feature="api" />;
  if (!canManage) return <Notice tone="info">{SETTINGS_COPY.api.adminOnly}</Notice>;

  return (
    <ApiKeysPanel
      canManage={canManage}
      keys={keys.map((k) => ({
        id: k.id,
        name: k.name,
        key_prefix: k.key_prefix,
        scopes: k.scopes,
        created_at: k.created_at.toISOString(),
        last_used_at: k.last_used_at?.toISOString() ?? null,
        revoked_at: k.revoked_at?.toISOString() ?? null,
      }))}
    />
  );
}
