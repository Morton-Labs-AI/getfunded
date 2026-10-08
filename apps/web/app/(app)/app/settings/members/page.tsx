import type { Metadata } from "next";
import { Suspense } from "react";

import { MembersPanel } from "@/components/settings/members-panel";
import { SettingsSection } from "@/components/settings/settings-section";
import { SettingsSkeleton } from "@/components/settings/settings-skeleton";
import { UpgradeNotice } from "@/components/settings/upgrade-notice";
import { withUser } from "@/lib/db/app";
import { SETTINGS_COPY } from "@/lib/settings/copy";
import { assignableInviteRoles, canInvite } from "@/lib/settings/roles";
import { listInvites, listMembers, seatSummary } from "@/lib/settings/service";
import { requireWorkspace } from "@/lib/workspace/context";

export const metadata: Metadata = { title: "Members" };

export default function MembersSettingsPage() {
  return (
    <SettingsSection title={SETTINGS_COPY.members.title} description={SETTINGS_COPY.members.description}>
      <Suspense fallback={<SettingsSkeleton rows={5} />}>
        <MembersContent />
      </Suspense>
    </SettingsSection>
  );
}

async function MembersContent() {
  const { user, workspace } = await requireWorkspace();
  const canManage = canInvite(workspace.role);

  const { members, invites, seats } = await withUser(user.id, async (sql) => {
    const members = await listMembers(sql, workspace.id);
    const invites = canManage ? await listInvites(sql, workspace.id) : [];
    const seats = await seatSummary(sql, workspace.id);
    return { members, invites, seats };
  });

  return (
    <>
      {canManage && seats.full ? <UpgradeNotice feature="members" seats={seats.used + 1} /> : null}
      <MembersPanel
        workspaceName={workspace.name}
        me={{ id: user.id, role: workspace.role }}
        members={members.map((m) => ({
          user_id: m.user_id,
          role: m.role,
          email: m.email,
          display_name: m.display_name,
          last_seen_at: m.last_seen_at?.toISOString() ?? null,
          joined_at: m.joined_at.toISOString(),
        }))}
        invites={invites.map((i) => ({
          id: i.id,
          email: i.email,
          role: i.role,
          expires_at: i.expires_at.toISOString(),
          created_at: i.created_at.toISOString(),
        }))}
        seats={{ limit: seats.limit, used: seats.used, remaining: seats.remaining, full: seats.full, planName: seats.planName }}
        canManage={canManage}
        assignable={assignableInviteRoles(workspace.role)}
      />
    </>
  );
}
