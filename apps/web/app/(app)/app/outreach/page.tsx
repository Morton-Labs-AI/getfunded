import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PenLine, Settings2 } from "lucide-react";

import { OutreachPage, OutreachPageHeader } from "@/components/outreach/page-header";
import { AiRowHint, QueueTable } from "@/components/outreach/queue-table";
import { QueueTabs } from "@/components/outreach/queue-tabs";
import { RunButtons } from "@/components/outreach/run-buttons";
import { Button } from "@/components/ui/button";
import { UpgradeNotice } from "@/components/workspace/upgrade-notice";
import { firstParam } from "@/lib/auth/next-path";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import { outreachAbilities } from "@/lib/outreach/gate";
import { listQueue, queueCounts } from "@/lib/outreach/messages";
import { sendableIdentities } from "@/lib/outreach/senders";
import { requireWorkspace } from "@/lib/workspace/context";

import { canRunSend, parseQueueTab } from "./helpers";
import { HeaderSkeleton, QueueSkeleton } from "./skeletons";

export const metadata: Metadata = { title: "Outreach" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The review queue. Four tabs (the URL is the state), the send and sync
 * buttons when the plan and a connected mailbox allow them, and otherwise a
 * plain explanation of what to do instead. Every row links to the message
 * page, where the human moves live.
 */
export default function OutreachQueuePage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <OutreachPage>
      <Suspense
        fallback={
          <>
            <HeaderSkeleton />
            <QueueSkeleton />
          </>
        }
      >
        <QueueContent searchParams={searchParams} />
      </Suspense>
    </OutreachPage>
  );
}

const BY_HAND =
  "You can write every message here, send it yourself (from your own mail, by post, or by phone), and then press \"Record as sent by hand\" on the message. The record stays on the funder's timeline.";

async function QueueContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = parseQueueTab(firstParam(params.tab));

  const { user, workspace } = await requireWorkspace();
  const ctx = { userId: user.id, workspaceId: workspace.id };
  const abilities = outreachAbilities({ plan: workspace.plan });

  const [rows, counts, sendable] = await Promise.all([
    listQueue(ctx, tab),
    queueCounts(ctx),
    abilities.sendGmail ? sendableIdentities(ctx, workspace.role) : Promise.resolve([]),
  ]);
  const runnable = canRunSend(abilities.sendGmail, sendable);

  return (
    <>
      <OutreachPageHeader
        title={OUTREACH_COPY.title}
        description={OUTREACH_COPY.subtitle}
        actions={
          <>
            <Button size="sm" asChild>
              <Link href="/app/outreach/new">
                <PenLine aria-hidden />
                Write a message
              </Link>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <Link href="/app/outreach/settings">
                <Settings2 aria-hidden />
                Settings
              </Link>
            </Button>
          </>
        }
      />

      <section aria-label="Sending" className="flex flex-col gap-3">
        {runnable ? (
          <div className="flex flex-col gap-2 rounded-lg border bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6 text-ink-2">
              Approved email goes out when you press send, one message at a time, from your connected Gmail. Checking Gmail looks only at message headers to see who wrote back.
            </p>
            <RunButtons />
          </div>
        ) : !abilities.sendGmail ? (
          <>
            <UpgradeNotice message={abilities.sendGmailReason ?? OUTREACH_COPY.sending.needsPro} />
            <p className="text-sm leading-6 text-ink-3">{BY_HAND}</p>
          </>
        ) : (
          <div className="flex flex-col gap-2 rounded-lg border bg-surface p-4 shadow-card">
            <p className="text-sm leading-6 text-ink-2">
              {OUTREACH_COPY.sending.notConnected}{" "}
              <Link href="/app/outreach/settings" className="font-medium text-primary hover:underline">
                Open Outreach settings
              </Link>
            </p>
            <p className="text-sm leading-6 text-ink-3">{BY_HAND}</p>
          </div>
        )}
      </section>

      <section aria-label="Messages" className="flex flex-col gap-3">
        <QueueTabs active={tab} counts={counts} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm leading-6 text-ink-3">{OUTREACH_COPY.tabHelp[tab]}</p>
          {tab === "drafts" && rows.some((r) => r.draftSource === "ai") ? <AiRowHint /> : null}
        </div>
        <QueueTable rows={rows} tab={tab} />
        {rows.length === 0 && tab === "drafts" ? (
          <p className="text-center text-sm text-ink-3">
            <Link href="/app/outreach/new" className="font-medium text-primary hover:underline">
              Write the first message
            </Link>
            . Pick a funder from your saved list, choose a template, and save it as a draft. Nothing is sent until you approve it.
          </p>
        ) : null}
        {tab === "approved" ? <p className="text-xs leading-5 text-ink-3">{OUTREACH_COPY.approval.explain}</p> : null}
      </section>
    </>
  );
}
