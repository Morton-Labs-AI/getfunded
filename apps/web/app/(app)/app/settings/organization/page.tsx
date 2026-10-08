import type { Metadata } from "next";
import { Suspense } from "react";

import { OrganizationForm } from "@/components/settings/organization-form";
import { Notice, SettingsSection } from "@/components/settings/settings-section";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import { canEditOrganization } from "@/lib/settings/roles";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Organization" };

export default function OrganizationSettingsPage() {
  return (
    <SettingsSection title={SETTINGS_COPY.organization.title} description={SETTINGS_COPY.organization.description}>
      <Suspense fallback={<SettingsSkeleton rows={8} />}>
        <OrganizationContent />
      </Suspense>
    </SettingsSection>
  );
}

async function OrganizationContent() {
  const { workspace } = await requireWorkspace();
  const canEdit = canEditOrganization(workspace.role);
  return (
    <>
      {!canEdit ? <Notice tone="info">{SETTINGS_COPY.organization.readOnly}</Notice> : null}
      <OrganizationForm
        workspace={{ id: workspace.id, version: workspace.version, name: workspace.name, profile: workspace.profile }}
        canEdit={canEdit}
      />
    </>
  );
}
