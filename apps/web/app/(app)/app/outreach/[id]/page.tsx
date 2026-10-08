import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Building2, Clock, FileCheck, Mail, Phone, UserRound } from "lucide-react";

import { AiBadge } from "@/components/data/ai-badge";
import { Missing } from "@/components/data/missing";
import { SourceChip } from "@/components/data/source-chip";
import { YoursTag } from "@/components/data/yours-tag";
import { MessageActions } from "@/components/outreach/message-actions";
import { MessageBody } from "@/components/outreach/message-body";
import { OutreachPage, OutreachPageHeader } from "@/components/outreach/page-header";
import { BouncedBadge, RepliedBadge, StatusBadge } from "@/components/outreach/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { OUTREACH_COPY } from "@/lib/outreach/copy";
import { outreachAbilities } from "@/lib/outreach/gate";
import { checkApprovable, getMessageDetail } from "@/lib/outreach/messages";
import { sendableIdentities } from "@/lib/outreach/senders";
import { suppressionEntries } from "@/lib/outreach/suppressions";
import { CHANNEL_LABELS } from "@/lib/outreach/types";
import { requireWorkspace } from "@/lib/workspace/context";

import { canRunSend, describeOutcome, messageTitle, pickSender, uuidParam } from "../helpers";
import { CardsSkeleton, HeaderSkeleton } from "../skeletons";

export const metadata: Metadata = { title: "Message" };

type Params = Promise<{ id: string }>;

/**
 * One message: its text (labelled Yours or AI with the model's claims), the
 * human moves on it, who it goes to and from, and everything that happened
 * to it. Approval is one click by one person; the button says why it is
 * off until the checks pass.
 */
export default function MessagePage({ params }: { params: Params }) {
  return (
    <OutreachPage>
      <Suspense
        fallback={
          <>
            <HeaderSkeleton />
            <CardsSkeleton cards={2} rows={3} />
          </>
        }
      >
        <MessageContent params={params} />
      </Suspense>
    </OutreachPage>
  );
}

async function MessageContent({ params }: { params: Params }) {
  const id = uuidParam((await params).id);
  if (!id) notFound();

  const { user, workspace } = await requireWorkspace();
  const ctx = { userId: user.id, workspaceId: workspace.id };
  const detail = await getMessageDetail(ctx, id);
  if (!detail) notFound();

  const { message, contact, outcomes, claims, approvedByName } = detail;
  const abilities = outreachAbilities({ plan: workspace.plan });
  const [sendable, suppressions] = await Promise.all([
    abilities.sendGmail ? sendableIdentities(ctx, workspace.role) : Promise.resolve([]),
    suppressionEntries(ctx),
  ]);
  const sender = pickSender(sendable, user.id);
  const approval = checkApprovable({
    message,
    contactEmail: contact?.email ?? message.contactEmail,
    suppressions,
    sender,
    canSendGmail: abilities.sendGmail,
  });

  const title = messageTitle(message, CHANNEL_LABELS[message.channel]);
  const isAi = message.draftSource === "ai";

  return (
    <>
      <OutreachPageHeader
        title={title}
        back={{ href: "/app/outreach", label: "Back to Outreach" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={message.status} />
            {message.repliedAt ? <RepliedBadge /> : null}
            {message.bouncedAt ? <BouncedBadge /> : null}
            {isAi ? <AiBadge reason={OUTREACH_COPY.ai.labelReason} /> : null}
            <span className="text-ink-3">{CHANNEL_LABELS[message.channel]}</span>
          </span>
        }
      />

      {message.error && (message.status === "failed" || message.status === "canceled") ? (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-tint px-3 py-2 text-sm text-danger">
          {message.error}
        </p>
      ) : null}
      {message.status === "sending" ? <p className="text-sm text-ink-3">This message is being sent right now. Reload in a moment.</p> : null}

      <MessageActions
        message={{
          id: message.id,
          version: message.version,
          status: message.status,
          channel: message.channel,
          subject: message.subject,
          body: message.body,
          savedFunderId: message.savedFunderId,
          contactId: message.contactId,
          draftSource: message.draftSource,
        }}
        context={{
          approval,
          canRunSend: canRunSend(abilities.sendGmail, sendable),
          senders: sendable.filter((s) => s.status === "connected").map((s) => ({ id: s.id, email: s.email })),
        }}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <MessageBody subject={message.subject} body={message.body} channel={message.channel} draftSource={message.draftSource} claims={claims} />
          {message.status === "draft" || message.status === "failed" ? <p className="text-xs leading-5 text-ink-3">{OUTREACH_COPY.approval.checks}</p> : null}
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserRound className="size-4 text-ink-3" aria-hidden />
                To
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              {contact ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{contact.fullName}</span>
                    {contact.source === "filing_part_xv" ? <SourceChip label="From filing" /> : <YoursTag>Added by you</YoursTag>}
                  </div>
                  {contact.title ? <div className="text-ink-3">{contact.title}</div> : null}
                  <div className="flex items-center gap-2 text-ink-2">
                    <Mail className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                    {contact.email ?? <Missing kind="not-available" />}
                  </div>
                  <div className="flex items-center gap-2 text-ink-2">
                    <Phone className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                    {contact.phone ?? <Missing kind="not-available" />}
                  </div>
                  {contact.sourceUrl ? (
                    <a href={contact.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      <FileCheck className="size-3" aria-hidden />
                      View the filing this came from
                    </a>
                  ) : null}
                  {message.channel === "email" && !contact.email ? <p className="text-xs leading-5 text-warning">{OUTREACH_COPY.contacts.noEmail}</p> : null}
                </>
              ) : (
                <p className="text-ink-3">
                  No contact is attached. {message.savedFunderId ? (
                    <Link href={`/app/outreach/new?funder=${message.savedFunderId}`} className="font-medium text-primary hover:underline">
                      Add one for this funder
                    </Link>
                  ) : null}
                  {message.savedFunderId ? ", then edit this message to pick it." : ""}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Building2 className="size-4 text-ink-3" aria-hidden />
                Funder
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <span className="font-medium">{message.funderName ?? <Missing kind="not-available" />}</span>
              {message.orgId ? (
                <Link href={`/funder/${message.orgId}`} className="text-xs text-primary hover:underline">
                  Open the funder profile
                </Link>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4 text-ink-3" aria-hidden />
                History
              </CardTitle>
              <CardDescription>What happened to this message, oldest first.</CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-3 text-sm">
                <li className="flex flex-col gap-0.5">
                  <span className="text-ink-2">Draft created</span>
                  <time className="tnum text-xs text-ink-3">{formatDateTime(message.createdAt)}</time>
                </li>
                {message.approvedAt ? (
                  <li className="flex flex-col gap-0.5">
                    <span className="text-ink-2">
                      {message.status === "recorded" ? "Recorded" : "Approved"}
                      {approvedByName ? ` by ${approvedByName}` : ""}
                      {message.senderEmail && message.status !== "recorded" ? `, to send from ${message.senderEmail}` : ""}
                    </span>
                    <time className="tnum text-xs text-ink-3">{formatDateTime(message.approvedAt)}</time>
                  </li>
                ) : null}
                {message.sentAt ? (
                  <li className="flex flex-col gap-0.5">
                    <span className="text-ink-2">{message.status === "recorded" ? `Sent by hand (${CHANNEL_LABELS[message.channel].toLowerCase()})` : "Sent through Gmail"}</span>
                    <time className="tnum text-xs text-ink-3">{formatDateTime(message.sentAt)}</time>
                  </li>
                ) : null}
                {outcomes.map((o) => {
                  const line = describeOutcome(o);
                  return (
                    <li key={o.id} className="flex flex-col gap-0.5">
                      <span className={line.tone === "danger" ? "text-danger" : line.tone === "success" ? "text-success" : "text-ink-2"}>{line.title}</span>
                      {line.detail ? <span className="text-xs leading-5 text-ink-3">{line.detail}</span> : null}
                      <time className="tnum text-xs text-ink-3">{formatDateTime(o.createdAt)}</time>
                    </li>
                  );
                })}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
