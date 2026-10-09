import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Bell } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkAllReadButton } from "@/components/workspace/mark-all-read";
import { EmptyState, PageBody, PageHeader } from "@/components/workspace/page-header";
import { formatDateTime } from "@/lib/format";
import { requireWorkspace } from "@/lib/workspace/context";
import { firstParam, type RawParams } from "@/lib/workspace/filters";
import { listNotifications, unreadNotificationCount } from "@/lib/workspace/notifications";
import { softFail } from "@/lib/workspace/safe";
import type { WorkspaceCtx } from "@/lib/workspace/types";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

type Props = { searchParams: Promise<RawParams> };

export default function NotificationsPage({ searchParams }: Props) {
  return (
    <PageBody>
      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <NotificationsContent searchParams={searchParams} />
      </Suspense>
    </PageBody>
  );
}

async function NotificationsContent({ searchParams }: Props) {
  const [sp, { user, workspace }] = await Promise.all([searchParams, requireWorkspace()]);
  const ctx: WorkspaceCtx = { userId: user.id, workspaceId: workspace.id };
  const unreadOnly = firstParam(sp.unread) === "1";
  const [rows, unread] = await Promise.all([
    softFail("notifications", [], () => listNotifications(ctx, { unreadOnly, limit: 100 })),
    softFail("unread count", 0, () => unreadNotificationCount(ctx)),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={workspace.name}
        title="Notifications"
        subtitle="Funder announcements that concern your list, and why each one reached you."
        actions={unread > 0 ? <MarkAllReadButton /> : undefined}
      />
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variant={unreadOnly ? "ghost" : "secondary"} size="sm">
          <Link href="/app/notifications">All</Link>
        </Button>
        <Button asChild variant={unreadOnly ? "secondary" : "ghost"} size="sm">
          <Link href="/app/notifications?unread=1">
            Unread{unread > 0 ? ` (${unread})` : ""}
          </Link>
        </Button>
        <Button asChild variant="link" size="sm" className="ml-auto">
          <Link href="/app/settings/notifications">Alert settings</Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title={unreadOnly ? "You are caught up." : "Nothing yet."}
          hint="When a funder on your list announces new money, a program or a deadline, it shows up here with the reasons it matched."
          action={
            <Button asChild size="sm">
              <Link href="/app/saved">
                <Bell aria-hidden />
                Your saved funders
              </Link>
            </Button>
          }
        />
      ) : (
        <ol className="flex flex-col divide-y rounded-lg border bg-card shadow-card">
          {rows.map((n) => (
            <li key={n.id} className={cn("flex flex-col gap-1.5 p-4", n.readAt ? "" : "bg-primary-tint/30")}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link href={n.href} className={cn("text-[15px] leading-snug underline-offset-4 hover:underline", n.readAt ? "text-ink-2" : "font-medium text-foreground")}>
                  {n.title}
                </Link>
                <span className="tnum shrink-0 text-xs text-ink-3">{formatDateTime(n.createdAt)}</span>
              </div>
              {n.body ? <p className="text-sm leading-relaxed text-ink-2">{n.body}</p> : null}
              <div className="flex flex-wrap items-center gap-1.5">
                {n.kind === "signal_discovery" ? <Badge variant="ai">Discovery</Badge> : <Badge variant="yours">Saved funder</Badge>}
                {n.reasons.map((r) => (
                  <Badge key={r.code} variant="outline">
                    {r.label}
                  </Badge>
                ))}
                <span className="tnum ml-auto text-xs text-ink-3">relevance {n.score}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
