import type { Metadata } from "next";
import { Suspense } from "react";

import { NotificationsForm } from "@/components/settings/notifications-form";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { can, isSelfHosted, planFor } from "@/lib/plans";
import { requireWorkspace } from "@/lib/workspace/context";
import { getNotificationPreferences } from "@/lib/workspace/notifications";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationSettingsPage() {
  return (
    <SettingsSection title="Notifications" description="What reaches you when a funder announces something, and how.">
      <Suspense fallback={<SettingsSkeleton rows={5} />}>
        <NotificationSettingsContent />
      </Suspense>
    </SettingsSection>
  );
}

async function NotificationSettingsContent() {
  const { user, workspace } = await requireWorkspace();
  const prefs = await getNotificationPreferences({ userId: user.id, workspaceId: workspace.id });
  const discoveryAllowed = isSelfHosted() || can(planFor(workspace), "signal_discovery");
  return <NotificationsForm prefs={prefs} discoveryAllowed={discoveryAllowed} />;
}
