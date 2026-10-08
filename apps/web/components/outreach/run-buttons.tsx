"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import type { SendReport } from "@/lib/outreach/runner";
import type { SyncReport } from "@/lib/outreach/sync";

type ApiError = { error?: { code?: string; message?: string }; message?: string };

async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new Error(data.error?.message ?? data.message ?? `Request failed (${res.status}).`);
  return data;
}

function describeSend(reports: SendReport[]): string {
  const sent = reports.reduce((n, r) => n + r.sent, 0);
  const failed = reports.reduce((n, r) => n + r.failed, 0);
  const reconciled = reports.reduce((n, r) => n + r.reconciled, 0);
  const skipped = reports.reduce((n, r) => n + r.skipped.length, 0);
  const parts = [`${sent} sent`];
  if (reconciled) parts.push(`${reconciled} confirmed from an earlier run`);
  if (failed) parts.push(`${failed} failed`);
  if (skipped) parts.push(`${skipped} skipped`);
  return parts.join(", ") + ".";
}

function describeSync(reports: SyncReport[]): string {
  const checked = reports.reduce((n, r) => n + r.checked, 0);
  const replied = reports.reduce((n, r) => n + r.replied, 0);
  const bounced = reports.reduce((n, r) => n + r.bounced, 0);
  const canceled = reports.reduce((n, r) => n + r.canceledFollowUps, 0);
  const parts = [`${checked} checked`, `${replied} replied`];
  if (bounced) parts.push(`${bounced} bounced`);
  if (canceled) parts.push(`${canceled} follow-up${canceled === 1 ? "" : "s"} canceled`);
  return parts.join(", ") + ".";
}

/**
 * "Send approved email now" and "Check Gmail for replies". Both POST to the
 * same-origin routes and refresh the page. Shown only when sending is on the
 * plan and a mailbox is connected; otherwise the page explains what to do.
 */
export function RunButtons({
  messageIds,
  size = "sm",
  showSync = true,
}: {
  /** Narrow the send run to these approved messages (the detail page passes one). */
  messageIds?: string[];
  size?: "sm" | "default";
  showSync?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"send" | "sync" | null>(null);

  async function run(kind: "send" | "sync") {
    setBusy(kind);
    try {
      if (kind === "send") {
        const data = await post<{ reports: SendReport[] }>("/api/outreach/send", messageIds ? { messageIds } : {});
        const firstSkip = data.reports.flatMap((r) => r.skipped)[0];
        toast.success("Send run finished", { description: describeSend(data.reports) + (firstSkip ? ` ${firstSkip.reason}` : "") });
      } else {
        const data = await post<{ reports: SyncReport[] }>("/api/outreach/sync", {});
        toast.success("Checked Gmail", { description: describeSync(data.reports) });
      }
      router.refresh();
    } catch (error) {
      toast.error(kind === "send" ? "Could not send" : "Could not check Gmail", {
        description: error instanceof Error ? error.message : "Try again in a minute.",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size={size} onClick={() => void run("send")} disabled={busy !== null}>
        {busy === "send" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        {messageIds?.length === 1 ? "Send this email now" : OUTREACH_COPY.sending.runNow}
      </Button>
      {showSync ? (
        <Button size={size} variant="outline" onClick={() => void run("sync")} disabled={busy !== null}>
          {busy === "sync" ? <Loader2 className="animate-spin" aria-hidden /> : <MailCheck aria-hidden />}
          {OUTREACH_COPY.sending.checkReplies}
        </Button>
      ) : null}
    </div>
  );
}
