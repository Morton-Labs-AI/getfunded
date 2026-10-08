import Link from "next/link";
import { ChevronRight, Mail, Phone, Sparkles } from "lucide-react";

import { AiBadge } from "@/components/data/ai-badge";
import { Missing } from "@/components/data/missing";
import { formatDateTime } from "@/lib/format";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import type { QueueTab } from "@/lib/outreach/messages";
import { CHANNEL_LABELS, type QueueRow } from "@/lib/outreach/types";

import { BouncedBadge, RepliedBadge, StatusBadge } from "./status-badge";

function when(row: QueueRow, tab: QueueTab): { label: string; value: string | null } {
  if (tab === "replied") return { label: "Replied", value: row.repliedAt };
  if (tab === "sent") return { label: row.status === "recorded" ? "Recorded" : "Sent", value: row.sentAt };
  if (tab === "approved") return { label: "Approved", value: row.approvedAt };
  return { label: "Updated", value: row.updatedAt };
}

/**
 * The queue as a list of rows that read well at any width: funder, contact,
 * subject and status on the first line; the date on the second. Each row is
 * one link to the message's page, where every action lives.
 */
export function QueueTable({ rows, tab }: { rows: QueueRow[]; tab: QueueTab }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed bg-surface px-4 py-10 text-center text-sm text-ink-3">
        {OUTREACH_COPY.empty[tab]}
      </div>
    );
  }
  return (
    <ol className="divide-y rounded-lg border bg-surface shadow-card">
      {rows.map((row) => {
        const stamp = when(row, tab);
        return (
          <li key={row.id}>
            <Link
              href={`/app/outreach/${row.id}`}
              className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:items-center"
            >
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-inset text-ink-3 sm:mt-0" aria-hidden>
                {row.channel === "email" ? <Mail className="size-4" /> : <Phone className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate font-medium text-foreground">{row.funderName ?? <Missing kind="not-available" />}</span>
                  <span className="truncate text-sm text-ink-3">
                    {row.contactName ?? "No contact yet"}
                    {row.contactEmail ? ` · ${row.contactEmail}` : ""}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-ink-2">
                  {row.channel === "email" ? (row.subject?.trim() ? row.subject : "(no subject yet)") : CHANNEL_LABELS[row.channel]}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                  <span>
                    {stamp.label} <time className="tnum">{formatDateTime(stamp.value)}</time>
                  </span>
                  {row.senderEmail && (row.status === "sent" || row.status === "approved") ? <span>from {row.senderEmail}</span> : null}
                  {row.error && (row.status === "failed" || row.status === "canceled") ? <span className="text-danger">{row.error}</span> : null}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center">
                {row.draftSource === "ai" ? <AiBadge reason={OUTREACH_COPY.ai.labelReason} /> : null}
                {row.repliedAt ? <RepliedBadge /> : row.bouncedAt ? <BouncedBadge /> : <StatusBadge status={row.status} />}
                <ChevronRight className="hidden size-4 text-ink-4 sm:block" aria-hidden />
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

export function AiRowHint() {
  return (
    <p className="inline-flex items-center gap-1 text-xs text-ink-3">
      <Sparkles className="size-3 text-ai" aria-hidden /> AI-polished drafts carry the AI badge until you approve them.
    </p>
  );
}
