import type { Metadata } from "next";
import { Suspense } from "react";

import { DataPanel } from "@/components/settings/data-panel";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { toInt } from "@/lib/billing/pg";
import { withUser } from "@/lib/db/app";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import { canDeleteWorkspace, canExportWorkspace } from "@/lib/settings/roles";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Data" };

export default function DataSettingsPage() {
  return (
    <SettingsSection title={SETTINGS_COPY.data.title} description={SETTINGS_COPY.data.description}>
      <Suspense fallback={<SettingsSkeleton rows={3} />}>
        <DataContent />
      </Suspense>
    </SettingsSection>
  );
}

async function DataContent() {
  const { user, workspace } = await requireWorkspace();
  const counts = await withUser(user.id, async (sql) => {
    const rows = await sql`
      select
        (select count(*) from getfunded.saved_funders where workspace_id = ${workspace.id}::uuid)::int as saved_funders,
        (select count(*) from getfunded.tasks where workspace_id = ${workspace.id}::uuid)::int as tasks,
        (select count(*) from getfunded.activities where workspace_id = ${workspace.id}::uuid)::int as activities`;
    return {
      saved_funders: toInt(rows[0]?.saved_funders, 0),
      tasks: toInt(rows[0]?.tasks, 0),
      activities: toInt(rows[0]?.activities, 0),
    };
  });

  return (
    <DataPanel
      workspace={{ id: workspace.id, name: workspace.name, version: workspace.version }}
      canExport={canExportWorkspace(workspace.role)}
      canDelete={canDeleteWorkspace(workspace.role)}
      counts={counts}
    />
  );
}
