import type { Metadata } from "next";
import { Suspense } from "react";

import { OutreachPage, OutreachPageHeader } from "@/components/outreach/page-header";
import { SenderPanel } from "@/components/outreach/sender-panel";
import { SuppressionsPanel } from "@/components/outreach/suppressions-panel";
import { TemplatesPanel } from "@/components/outreach/templates-panel";
import { firstParam } from "@/lib/auth/next-path";
import { isSecretsConfigured } from "@/lib/email/crypto";
import { isGmailConfigured } from "@/lib/email/gmail";
import { listWorkspaceTemplates } from "@/lib/outreach/boilerplate";
import { outreachAbilities } from "@/lib/outreach/gate";
import { listSenderIdentities } from "@/lib/outreach/senders";
import { listSuppressions } from "@/lib/outreach/suppressions";
import { requireWorkspace } from "@/lib/workspace/context";

import { gmailNotice, toPanelIdentity } from "../helpers";
import { CardsSkeleton, HeaderSkeleton } from "../skeletons";

export const metadata: Metadata = { title: "Outreach settings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Outreach settings: the connected Gmail (status, daily cap, connect and
 * disconnect), the do-not-contact list, and the workspace's own templates.
 * The Gmail routes land back here with `?gmail=connected` or
 * `?gmail=error&reason=code`; the code becomes one plain sentence.
 */
export default function OutreachSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <OutreachPage>
      <Suspense
        fallback={
          <>
            <HeaderSkeleton />
            <CardsSkeleton cards={3} rows={3} />
          </>
        }
      >
        <SettingsContent searchParams={searchParams} />
      </Suspense>
    </OutreachPage>
  );
}

async function SettingsContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const notice = gmailNotice(firstParam(params.gmail), firstParam(params.reason));

  const { user, workspace } = await requireWorkspace();
  const ctx = { userId: user.id, workspaceId: workspace.id };
  const isAdmin = workspace.role === "owner" || workspace.role === "admin";
  const abilities = outreachAbilities({ plan: workspace.plan });

  const [identities, suppressions, templates] = await Promise.all([listSenderIdentities(ctx), listSuppressions(ctx), listWorkspaceTemplates(ctx)]);

  return (
    <>
      <OutreachPageHeader
        title="Outreach settings"
        description="Your connected mailbox, the addresses this workspace never writes to, and the templates your team saves."
        back={{ href: "/app/outreach", label: "Back to Outreach" }}
      />
      <SenderPanel
        identities={identities.map((i) => toPanelIdentity(i, user.id))}
        isAdmin={isAdmin}
        canSendGmail={abilities.sendGmail}
        sendGmailReason={abilities.sendGmailReason}
        configured={{ gmail: isGmailConfigured(), secrets: isSecretsConfigured() }}
        notice={notice}
      />
      <SuppressionsPanel entries={suppressions.map((s) => ({ kind: s.kind, value: s.value, reason: s.reason, createdAt: s.createdAt }))} />
      <TemplatesPanel templates={templates.map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body, version: t.version }))} isAdmin={isAdmin} />
    </>
  );
}
