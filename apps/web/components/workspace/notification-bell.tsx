"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";
import { markNotificationsReadAction } from "@/lib/workspace/notification-actions";
import type { Notification } from "@/lib/workspace/notifications";
import { cn } from "@/lib/utils";

/**
 * The bell: unread count and the eight most recent notifications, server
 * rendered by the layout and passed in. No polling: a navigation or a server
 * action's revalidate re-renders the layout, which is how it stays current.
 * Clicking a row opens its page; "Mark all read" is one action.
 */
export function NotificationBell({ count, recent }: { count: number; recent: Notification[] }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  function markAll() {
    startTransition(async () => {
      await markNotificationsReadAction({ all: true });
      router.refresh();
    });
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={count > 0 ? `${count} unread notifications` : "Notifications"}>
          <Bell className="size-4" aria-hidden />
          {count > 0 ? (
            <span className="tnum absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
              {count > 99 ? "99+" : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {count > 0 ? (
            <Button variant="ghost" size="sm" onClick={markAll} disabled={pending}>
              <Check aria-hidden />
              Mark all read
            </Button>
          ) : null}
        </div>
        {recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-ink-3">Nothing yet. Funder announcements that concern your list will land here.</p>
        ) : (
          <ul className="max-h-[420px] overflow-y-auto">
            {recent.map((n) => (
              <li key={n.id} className={cn("border-b last:border-b-0", n.readAt ? "" : "bg-primary-tint/40")}>
                <Link href={n.href} className="flex flex-col gap-1 px-3 py-2.5 hover:bg-accent">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("text-sm leading-snug", n.readAt ? "text-ink-2" : "font-medium text-foreground")}>{n.title}</span>
                    <span className="tnum shrink-0 text-xs text-ink-3">{formatDate(n.createdAt)}</span>
                  </div>
                  {n.body ? <p className="line-clamp-2 text-xs text-ink-3">{n.body}</p> : null}
                  {n.reasons.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {n.kind === "signal_discovery" ? <Badge variant="ai">Discovery</Badge> : null}
                      {n.reasons.slice(0, 3).map((r) => (
                        <Badge key={r.code} variant="outline">
                          {r.label}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="border-t px-3 py-2 text-right">
          <Button asChild variant="link" size="sm">
            <Link href="/app/notifications">All notifications</Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
