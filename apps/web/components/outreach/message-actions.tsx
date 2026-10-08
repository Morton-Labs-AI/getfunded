"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, MessageSquareReply, Pencil, RotateCcw, Reply, Undo2, X } from "lucide-react";
import { toast } from "sonner";

import {
  approveMessageAction,
  cancelMessageAction,
  createFollowUpAction,
  recordByHandAction,
  recordReplyAction,
  reopenMessageAction,
  retryMessageAction,
  saveDraftAction,
} from "@/app/(app)/app/outreach/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import type { MessageStatus } from "@/lib/outreach/state";
import { CHANNELS, CHANNEL_LABELS, type Channel } from "@/lib/outreach/types";

import { RunButtons } from "./run-buttons";

export type ActionsMessage = {
  id: string;
  version: number;
  status: MessageStatus;
  channel: Channel;
  subject: string | null;
  body: string;
  savedFunderId: string | null;
  contactId: string | null;
  draftSource: "template" | "ai";
};

export type ActionsContext = {
  /** Pre-flight result of the approval checks, so the button can say why not. */
  approval: { ok: true } | { ok: false; error: string };
  /** The plan allows Gmail sending AND a connected mailbox exists for this person. */
  canRunSend: boolean;
  senders: { id: string; email: string }[];
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Every human move on one message. Approval is one click by one person; the
 * button is disabled, with the reason, until the checks pass.
 */
export function MessageActions({ message, context }: { message: ActionsMessage; context: ActionsContext }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [editing, setEditing] = React.useState(false);
  const [subject, setSubject] = React.useState(message.subject ?? "");
  const [body, setBody] = React.useState(message.body);
  const [senderId, setSenderId] = React.useState(context.senders[0]?.id ?? "");
  const [byHandOpen, setByHandOpen] = React.useState(false);
  const [byHand, setByHand] = React.useState<{ channel: Channel; date: string; note: string }>({ channel: message.channel, date: today(), note: "" });
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [reply, setReply] = React.useState<{ via: string; date: string; note: string }>({ via: "email", date: today(), note: "" });
  const baseId = React.useId();

  function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        toast.error(label, { description: result.error });
        return;
      }
      after?.();
      router.refresh();
    });
  }

  const ref = { id: message.id, version: message.version };
  const s = message.status;

  if (editing) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border bg-surface p-4 shadow-card">
        {message.channel === "email" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${baseId}-subject`}>Subject</Label>
            <Input id={`${baseId}-subject`} value={subject} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
          </div>
        ) : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${baseId}-body`}>Text</Label>
          <Textarea id={`${baseId}-body`} value={body} rows={14} className="min-h-64 font-sans" onChange={(e) => setBody(e.target.value)} />
        </div>
        {s === "approved" ? <p className="text-sm text-warning">Saving an edit takes the approval back. You will approve the new text again.</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={pending || !message.savedFunderId}
            onClick={() =>
              run(
                "Could not save",
                () =>
                  saveDraftAction({
                    id: message.id,
                    version: message.version,
                    savedFunderId: message.savedFunderId,
                    contactId: message.contactId,
                    channel: message.channel,
                    subject,
                    body,
                    draftSource: message.draftSource,
                  }),
                () => {
                  setEditing(false);
                  toast.success("Saved");
                },
              )
            }
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            Save changes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const canEdit = s === "draft" || s === "approved" || s === "failed";
  const canApprove = (s === "draft" || s === "failed") && message.channel === "email";
  const canRecord = s === "draft" || s === "approved" || s === "failed";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {canApprove ? (
          <>
            {context.senders.length > 1 ? (
              <Select value={senderId} onValueChange={setSenderId}>
                <SelectTrigger size="sm" aria-label="Send from mailbox">
                  <SelectValue placeholder="Send from" />
                </SelectTrigger>
                <SelectContent>
                  {context.senders.map((sender) => (
                    <SelectItem key={sender.id} value={sender.id}>
                      from {sender.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Button
              size="sm"
              disabled={pending || !context.approval.ok}
              title={context.approval.ok ? undefined : context.approval.error}
              onClick={() =>
                run("Could not approve", () => approveMessageAction({ ...ref, senderIdentityId: senderId || undefined }), () =>
                  toast.success("Approved", { description: OUTREACH_COPY.sending.approvedToast }),
                )
              }
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              {s === "failed" ? "Approve again" : "Approve for sending"}
            </Button>
          </>
        ) : null}
        {s === "failed" && message.channel === "email" && context.approval.ok ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run("Could not queue it again", () => retryMessageAction(ref), () => toast.success("Queued again", { description: OUTREACH_COPY.sending.approvedToast }))}
          >
            <RotateCcw aria-hidden />
            {OUTREACH_COPY.sending.retry}
          </Button>
        ) : null}
        {s === "approved" && context.canRunSend ? <RunButtons messageIds={[message.id]} showSync={false} /> : null}
        {canEdit ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} disabled={pending}>
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : null}
        {canRecord ? (
          <Button size="sm" variant="outline" onClick={() => setByHandOpen(true)} disabled={pending}>
            <Check aria-hidden />
            {OUTREACH_COPY.sending.byHand}
          </Button>
        ) : null}
        {(s === "sent" || s === "recorded") ? (
          <>
            <Button size="sm" variant="outline" onClick={() => setReplyOpen(true)} disabled={pending}>
              <MessageSquareReply aria-hidden />
              Record a reply
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await createFollowUpAction({ parentId: message.id });
                  if (!result.ok) return void toast.error("Could not start a follow-up", { description: result.error });
                  router.push(`/app/outreach/${result.id}`);
                })
              }
            >
              <Reply aria-hidden />
              Write a follow-up
            </Button>
          </>
        ) : null}
        {s === "canceled" ? (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run("Could not reopen", () => reopenMessageAction(ref), () => toast.success("Back in drafts"))}>
            <Undo2 aria-hidden />
            Reopen as draft
          </Button>
        ) : null}
        {(s === "draft" || s === "approved" || s === "failed") ? (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run("Could not cancel", () => cancelMessageAction(ref), () => toast.success("Canceled"))}>
            <X aria-hidden />
            Cancel
          </Button>
        ) : null}
      </div>
      {canApprove && !context.approval.ok ? <p className="text-sm text-ink-3">{context.approval.error}</p> : null}
      {s === "approved" && !context.canRunSend ? <p className="text-sm text-ink-3">{OUTREACH_COPY.sending.notConnected}</p> : null}

      <Dialog open={byHandOpen} onOpenChange={setByHandOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{OUTREACH_COPY.sending.byHand}</DialogTitle>
            <DialogDescription>{OUTREACH_COPY.sending.byHandHelp}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-bh-channel`}>How you sent it</Label>
              <Select value={byHand.channel} onValueChange={(v) => setByHand({ ...byHand, channel: v as Channel })}>
                <SelectTrigger id={`${baseId}-bh-channel`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-bh-date`}>When</Label>
              <Input id={`${baseId}-bh-date`} type="date" value={byHand.date} max={today()} onChange={(e) => setByHand({ ...byHand, date: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-bh-note`}>Note (optional)</Label>
              <Textarea id={`${baseId}-bh-note`} value={byHand.note} maxLength={2000} rows={3} onChange={(e) => setByHand({ ...byHand, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setByHandOpen(false)} disabled={pending}>
              Back
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  "Could not record",
                  () => recordByHandAction({ ...ref, channel: byHand.channel, sentAt: byHand.date ? new Date(`${byHand.date}T12:00:00`) : undefined, note: byHand.note }),
                  () => {
                    setByHandOpen(false);
                    toast.success("Recorded", { description: "It now shows under Sent." });
                  },
                )
              }
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Record it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={replyOpen} onOpenChange={setReplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a reply</DialogTitle>
            <DialogDescription>Use this when the funder answered by phone, by post, or in your own inbox. Pending follow-ups to this contact are canceled.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-rp-via`}>How they replied</Label>
              <Select value={reply.via} onValueChange={(v) => setReply({ ...reply, via: v })}>
                <SelectTrigger id={`${baseId}-rp-via`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="call">Phone call</SelectItem>
                  <SelectItem value="letter">Letter</SelectItem>
                  <SelectItem value="meeting">Meeting</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-rp-date`}>When</Label>
              <Input id={`${baseId}-rp-date`} type="date" value={reply.date} max={today()} onChange={(e) => setReply({ ...reply, date: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${baseId}-rp-note`}>What they said (optional)</Label>
              <Textarea id={`${baseId}-rp-note`} value={reply.note} maxLength={2000} rows={3} onChange={(e) => setReply({ ...reply, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReplyOpen(false)} disabled={pending}>
              Back
            </Button>
            <Button
              disabled={pending}
              onClick={() =>
                run(
                  "Could not record the reply",
                  () => recordReplyAction({ id: message.id, via: reply.via, repliedAt: reply.date ? new Date(`${reply.date}T12:00:00`) : undefined, note: reply.note }),
                  () => {
                    setReplyOpen(false);
                    toast.success("Reply recorded");
                  },
                )
              }
            >
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
              Record reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
