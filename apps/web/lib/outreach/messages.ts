import "server-only";
/**
 * Messages: the review queue, one message's detail, and every human move on
 * it (save, approve, cancel, reopen, retry, record by hand, record a reply,
 * follow up). The runner's moves live in store.ts.
 *
 * Approval is the one gate that matters. It is one row, one click, one
 * person, and it re-checks everything the send run will check again: the
 * contact has a real address, the address is not suppressed, no `[add: …]`
 * marker is left in the text, and a connected mailbox is named.
 */
import { idempotencyKeyFor } from "./idempotency";
import { assertTransition, canTransition, type MessageStatus } from "./state";
import { iso, num, str, withUser, type Ctx, type Tx } from "./db";
import { builtInTemplate, findPlaceholders, firstNameOf, renderTemplate } from "./templates";
import { cancelPendingFollowUps } from "./store";
import { describeSuppression, findSuppression, isValidEmail, type SuppressionEntry } from "./suppress";
import type { Channel, Contact, DraftInput, DraftSource, Message, QueueRow, SendOutcomeRow, SenderIdentity } from "./types";

export type QueueTab = "drafts" | "approved" | "sent" | "replied";
export const QUEUE_TABS: readonly QueueTab[] = ["drafts", "approved", "sent", "replied"];

export function isQueueTab(value: unknown): value is QueueTab {
  return typeof value === "string" && (QUEUE_TABS as readonly string[]).includes(value);
}

const MESSAGE_COLUMNS = `
  m.id, m.workspace_id, m.saved_funder_id, m.contact_id, m.sender_identity_id, m.channel, m.subject, m.body,
  m.draft_source, m.ai_analysis_id, m.status, m.approved_by, m.approved_at, m.idempotency_key,
  m.provider_message_id, m.thread_id, m.sent_at, m.error, m.created_by, m.created_at, m.updated_at, m.version`;

function toMessage(r: Record<string, unknown>): Message {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    savedFunderId: str(r.saved_funder_id),
    contactId: str(r.contact_id),
    senderIdentityId: str(r.sender_identity_id),
    channel: (str(r.channel) as Channel) ?? "email",
    subject: str(r.subject),
    body: String(r.body ?? ""),
    draftSource: (str(r.draft_source) as DraftSource) ?? "template",
    aiAnalysisId: str(r.ai_analysis_id),
    status: (str(r.status) as MessageStatus) ?? "draft",
    approvedBy: str(r.approved_by),
    approvedAt: iso(r.approved_at),
    idempotencyKey: str(r.idempotency_key),
    providerMessageId: str(r.provider_message_id),
    threadId: str(r.thread_id),
    sentAt: iso(r.sent_at),
    error: str(r.error),
    createdBy: str(r.created_by),
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
    version: num(r.version, 1),
  };
}

const QUEUE_SELECT = `
  select ${MESSAGE_COLUMNS},
    c.full_name as contact_name, c.email as contact_email,
    sf.snapshot->>'name' as funder_name, sf.org_id,
    si.email as sender_email,
    (select coalesce(max(o.provider_payload->>'replied_at'), max(o.created_at)::text)
       from getfunded.send_outcomes o where o.message_id = m.id and o.outcome = 'replied') as replied_at,
    (select max(o.created_at)::text
       from getfunded.send_outcomes o where o.message_id = m.id and o.outcome = 'bounced') as bounced_at
  from getfunded.messages m
  left join getfunded.contacts c on c.id = m.contact_id
  left join getfunded.saved_funders sf on sf.id = m.saved_funder_id
  left join getfunded.sender_identities si on si.id = m.sender_identity_id`;

function toQueueRow(r: Record<string, unknown>): QueueRow {
  return {
    ...toMessage(r),
    contactName: str(r.contact_name),
    contactEmail: str(r.contact_email),
    funderName: str(r.funder_name),
    orgId: str(r.org_id),
    senderEmail: str(r.sender_email),
    repliedAt: iso(r.replied_at),
    bouncedAt: iso(r.bounced_at),
  };
}

const TAB_WHERE: Record<QueueTab, string> = {
  drafts: `m.status in ('draft', 'canceled')`,
  approved: `m.status in ('approved', 'sending', 'failed')`,
  sent: `m.status in ('sent', 'recorded')`,
  replied: `exists (select 1 from getfunded.send_outcomes o where o.message_id = m.id and o.outcome = 'replied')`,
};

export async function listQueue(ctx: Ctx, tab: QueueTab): Promise<QueueRow[]> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `${QUEUE_SELECT} where m.workspace_id = $1 and ${TAB_WHERE[tab]} order by m.updated_at desc limit 200`,
      [ctx.workspaceId],
    );
    return rows.map((r) => toQueueRow(r as Record<string, unknown>));
  });
}

export async function queueCounts(ctx: Ctx): Promise<Record<QueueTab, number>> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql`
      select
        count(*) filter (where status in ('draft', 'canceled'))::int as drafts,
        count(*) filter (where status in ('approved', 'sending', 'failed'))::int as approved,
        count(*) filter (where status in ('sent', 'recorded'))::int as sent,
        count(*) filter (where exists (
          select 1 from getfunded.send_outcomes o where o.message_id = m.id and o.outcome = 'replied'))::int as replied
      from getfunded.messages m
      where m.workspace_id = ${ctx.workspaceId}::uuid`;
    const r = rows[0] ?? {};
    return { drafts: num(r.drafts), approved: num(r.approved), sent: num(r.sent), replied: num(r.replied) };
  });
}

/** Messages for one saved funder, newest first (for a funder page slot). */
export async function listMessagesForFunder(ctx: Ctx, savedFunderId: string): Promise<QueueRow[]> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `${QUEUE_SELECT} where m.workspace_id = $1 and m.saved_funder_id = $2 order by m.updated_at desc limit 50`,
      [ctx.workspaceId, savedFunderId],
    );
    return rows.map((r) => toQueueRow(r as Record<string, unknown>));
  });
}

export type MessageClaim = { text: string; evidenceId: string };

export type MessageDetail = {
  message: QueueRow;
  contact: Contact | null;
  outcomes: SendOutcomeRow[];
  /** Model claims recorded when an AI-polished draft was saved. */
  claims: MessageClaim[];
  approvedByName: string | null;
};

export async function getMessageDetail(ctx: Ctx, id: string): Promise<MessageDetail | null> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(`${QUEUE_SELECT} where m.workspace_id = $1 and m.id = $2`, [ctx.workspaceId, id]);
    if (!rows[0]) return null;
    const message = toQueueRow(rows[0] as Record<string, unknown>);

    const contactRows = message.contactId
      ? await sql`
          select id, workspace_id, saved_funder_id, full_name, title, email, phone, source, source_url, publishability,
                 created_by, created_at, updated_at, version
          from getfunded.contacts where id = ${message.contactId}::uuid`
      : [];
    const c = contactRows[0] as Record<string, unknown> | undefined;
    const contact: Contact | null = c
      ? {
          id: String(c.id),
          workspaceId: String(c.workspace_id),
          savedFunderId: str(c.saved_funder_id),
          fullName: String(c.full_name ?? ""),
          title: str(c.title),
          email: str(c.email),
          phone: str(c.phone),
          source: (str(c.source) as Contact["source"]) ?? "manual",
          sourceUrl: str(c.source_url),
          publishability: str(c.publishability),
          createdBy: str(c.created_by),
          createdAt: iso(c.created_at) ?? "",
          updatedAt: iso(c.updated_at) ?? "",
          version: num(c.version, 1),
        }
      : null;

    const outcomeRows = await sql`
      select id, message_id, workspace_id, outcome, provider_payload, created_at
      from getfunded.send_outcomes where message_id = ${id}::uuid order by created_at asc`;
    const outcomes: SendOutcomeRow[] = outcomeRows.map((o) => ({
      id: String(o.id),
      messageId: String(o.message_id),
      workspaceId: String(o.workspace_id),
      outcome: o.outcome as SendOutcomeRow["outcome"],
      providerPayload: (o.provider_payload && typeof o.provider_payload === "object" ? o.provider_payload : {}) as Record<string, unknown>,
      createdAt: iso(o.created_at) ?? "",
    }));

    const claimRows = await sql`
      select meta from getfunded.activities
      where workspace_id = ${ctx.workspaceId}::uuid and kind = 'system'
        and meta->>'message_id' = ${id} and meta ? 'claims'
      order by created_at desc limit 1`;
    const rawClaims = (claimRows[0]?.meta as { claims?: unknown } | undefined)?.claims;
    const claims: MessageClaim[] = Array.isArray(rawClaims)
      ? rawClaims
          .filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
          .map((x) => ({ text: String(x.text ?? ""), evidenceId: String(x.evidenceId ?? x.evidence_id ?? "") }))
      : [];

    const approver = message.approvedBy
      ? await sql`select display_name, email from getfunded.users where id = ${message.approvedBy}::uuid`
      : [];
    const approvedByName = approver[0] ? (str(approver[0].display_name) ?? str(approver[0].email)) : null;

    return { message, contact, outcomes, claims, approvedByName };
  });
}

/* ----------------------------------------------------------------------------
   Human moves
---------------------------------------------------------------------------- */

export type MoveResult = { ok: true; id: string; version: number; status: MessageStatus } | { ok: false; error: string };

async function lockMessage(sql: Tx, workspaceId: string, id: string): Promise<Message | null> {
  const rows = await sql.unsafe(`select ${MESSAGE_COLUMNS} from getfunded.messages m where m.id = $1 and m.workspace_id = $2 for update`, [
    id,
    workspaceId,
  ]);
  return rows[0] ? toMessage(rows[0] as Record<string, unknown>) : null;
}

const STALE = "This message was changed somewhere else. Reload the page and try again.";

export const FOREIGN_FUNDER = "That funder is not on this workspace's list.";
export const FOREIGN_CONTACT = "That contact does not belong to this workspace.";

/**
 * The client names a saved funder and a contact by id. Both must belong to the
 * caller's workspace: RLS would hide a stranger's rows from a SELECT, but an
 * INSERT of a foreign id into our own row is not a read and would succeed, so
 * the check is explicit. Same rule as addContact / createTask in lib/workspace.
 */
async function ownsFunder(sql: Tx, workspaceId: string, savedFunderId: string): Promise<boolean> {
  const rows = await sql`
    select 1 as ok from getfunded.saved_funders where id = ${savedFunderId}::uuid and workspace_id = ${workspaceId}::uuid`;
  return rows.length > 0;
}

async function ownsContact(sql: Tx, workspaceId: string, contactId: string): Promise<boolean> {
  const rows = await sql`
    select 1 as ok from getfunded.contacts where id = ${contactId}::uuid and workspace_id = ${workspaceId}::uuid`;
  return rows.length > 0;
}

/** Insert or update a draft. Editing an approved message returns it to draft: the approved text is gone. */
export async function saveDraft(ctx: Ctx, input: DraftInput): Promise<MoveResult> {
  return withUser(ctx.userId, async (sql) => {
    const subject = input.channel === "email" ? input.subject : input.subject || null;
    if (input.contactId && !(await ownsContact(sql, ctx.workspaceId, input.contactId))) {
      return { ok: false, error: FOREIGN_CONTACT };
    }
    if (input.id) {
      const current = await lockMessage(sql, ctx.workspaceId, input.id);
      if (!current) return { ok: false, error: "That message no longer exists." };
      if (input.version !== undefined && current.version !== input.version) return { ok: false, error: STALE };
      const nextStatus: MessageStatus = current.status === "draft" ? "draft" : "draft";
      if (current.status !== "draft" && !canTransition(current.status, "draft")) {
        return { ok: false, error: `A ${current.status} message cannot be edited. Write a new one instead.` };
      }
      const rows = await sql`
        update getfunded.messages
        set subject = ${subject}, body = ${input.body}, channel = ${input.channel},
            contact_id = ${input.contactId ?? null}, draft_source = ${input.draftSource},
            status = ${nextStatus}, approved_by = null, approved_at = null, error = null
        where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid
        returning id, version, status`;
      const r = rows[0];
      if (!r) return { ok: false, error: STALE };
      if (input.draftSource === "ai" && input.claims?.length) await recordClaims(sql, ctx, String(r.id), input.claims);
      return { ok: true, id: String(r.id), version: num(r.version, 1), status: r.status as MessageStatus };
    }
    if (!(await ownsFunder(sql, ctx.workspaceId, input.savedFunderId))) return { ok: false, error: FOREIGN_FUNDER };
    const rows = await sql`
      insert into getfunded.messages
        (workspace_id, saved_funder_id, contact_id, channel, subject, body, draft_source, thread_id, status, created_by)
      values (${ctx.workspaceId}::uuid, ${input.savedFunderId}::uuid, ${input.contactId ?? null}, ${input.channel},
              ${subject}, ${input.body}, ${input.draftSource}, ${input.threadId ?? null}, 'draft', ${ctx.userId}::uuid)
      returning id, version, status`;
    const r = rows[0];
    if (input.draftSource === "ai" && input.claims?.length) await recordClaims(sql, ctx, String(r.id), input.claims);
    return { ok: true, id: String(r.id), version: num(r.version, 1), status: r.status as MessageStatus };
  });
}

async function recordClaims(sql: Tx, ctx: Ctx, messageId: string, claims: MessageClaim[]) {
  const rows = await sql`select saved_funder_id from getfunded.messages where id = ${messageId}::uuid`;
  await sql`
    insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
    values (${ctx.workspaceId}::uuid, ${str(rows[0]?.saved_funder_id)}, 'system',
            ${"A draft was polished by AI. The claims it kept are listed with their evidence ids."},
            ${ctx.userId}::uuid, ${sql.json({ message_id: messageId, claims } as never)}::jsonb)`;
}

export type ApproveInput = { id: string; version: number; senderIdentityId?: string | null };

export type ApprovalCheck = { ok: true } | { ok: false; error: string };

/** The checks approval runs, pure so the detail page can show them before the click. */
export function checkApprovable(input: {
  message: Pick<Message, "status" | "channel" | "subject" | "body">;
  contactEmail: string | null;
  suppressions: readonly SuppressionEntry[];
  sender: Pick<SenderIdentity, "status"> | null;
  canSendGmail: boolean;
}): ApprovalCheck {
  const { message } = input;
  if (!canTransition(message.status, "approved")) {
    return { ok: false, error: `A ${message.status} message cannot be approved.` };
  }
  if (message.channel !== "email") {
    return { ok: false, error: "Only email is approved for sending. Letters and calls are recorded by hand after you make them." };
  }
  if (!input.canSendGmail) {
    return { ok: false, error: "Sending through Gmail is part of the Pro plan and above. Send this yourself and record it by hand." };
  }
  if (!input.sender || input.sender.status !== "connected") {
    return { ok: false, error: "Connect your Gmail in Outreach settings before approving email." };
  }
  if (!isValidEmail(input.contactEmail)) {
    return { ok: false, error: "This contact has no usable email address. Add one, or record a letter or call instead." };
  }
  const match = findSuppression(input.contactEmail, input.suppressions);
  if (match) return { ok: false, error: describeSuppression(match) };
  const holes = findPlaceholders(`${message.subject ?? ""}\n${message.body}`);
  if (holes.length) return { ok: false, error: `Fill in the marked fields before approving: ${holes.join(", ")}.` };
  if (!message.subject?.trim()) return { ok: false, error: "Give the email a subject line." };
  if (!message.body.trim()) return { ok: false, error: "The message is empty." };
  return { ok: true };
}

export async function approveMessage(
  ctx: Ctx,
  input: ApproveInput,
  opts: { canSendGmail: boolean; sendable: SenderIdentity[] },
): Promise<MoveResult> {
  const sender = input.senderIdentityId
    ? (opts.sendable.find((s) => s.id === input.senderIdentityId) ?? null)
    : (opts.sendable.find((s) => s.userId === ctx.userId) ?? opts.sendable[0] ?? null);
  return withUser(ctx.userId, async (sql) => {
    const current = await lockMessage(sql, ctx.workspaceId, input.id);
    if (!current) return { ok: false, error: "That message no longer exists." };
    if (current.version !== input.version) return { ok: false, error: STALE };
    const contactRows = current.contactId ? await sql`select email from getfunded.contacts where id = ${current.contactId}::uuid` : [];
    const supRows = await sql`select kind, value, reason from getfunded.suppressions where workspace_id = ${ctx.workspaceId}::uuid`;
    const check = checkApprovable({
      message: current,
      contactEmail: str(contactRows[0]?.email),
      suppressions: supRows.map((s) => ({ kind: s.kind as "email" | "domain", value: String(s.value), reason: str(s.reason) })),
      sender,
      canSendGmail: opts.canSendGmail,
    });
    if (!check.ok) return check;
    const rows = await sql`
      update getfunded.messages m
      set status = 'approved', approved_by = ${ctx.userId}::uuid, approved_at = now(),
          sender_identity_id = ${sender!.id}::uuid,
          idempotency_key = coalesce(m.idempotency_key, ${idempotencyKeyFor(current.id)}),
          error = null
      where m.id = ${current.id}::uuid and m.version = ${input.version}
      returning id, version, status`;
    const r = rows[0];
    if (!r) return { ok: false, error: STALE };
    return { ok: true, id: String(r.id), version: num(r.version, 1), status: r.status as MessageStatus };
  });
}

async function simpleMove(ctx: Ctx, id: string, version: number, to: MessageStatus, patch: (sql: Tx) => Promise<void>): Promise<MoveResult> {
  return withUser(ctx.userId, async (sql) => {
    const current = await lockMessage(sql, ctx.workspaceId, id);
    if (!current) return { ok: false, error: "That message no longer exists." };
    if (current.version !== version) return { ok: false, error: STALE };
    try {
      assertTransition(current.status, to);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "That change is not allowed." };
    }
    const rows = await sql`
      update getfunded.messages set status = ${to}
      where id = ${id}::uuid and version = ${version}
      returning id, version, status`;
    const r = rows[0];
    if (!r) return { ok: false, error: STALE };
    await patch(sql);
    return { ok: true, id: String(r.id), version: num(r.version, 1), status: r.status as MessageStatus };
  });
}

export function cancelMessage(ctx: Ctx, id: string, version: number): Promise<MoveResult> {
  return simpleMove(ctx, id, version, "canceled", async (sql) => {
    await sql`update getfunded.messages set error = ${"Canceled by a person."} where id = ${id}::uuid`;
  });
}

export function reopenMessage(ctx: Ctx, id: string, version: number): Promise<MoveResult> {
  return simpleMove(ctx, id, version, "draft", async (sql) => {
    await sql`update getfunded.messages set error = null, approved_by = null, approved_at = null where id = ${id}::uuid`;
  });
}

/** failed → approved. A person clicks this; the send run checks the list and the cap again. */
export function retryMessage(ctx: Ctx, id: string, version: number): Promise<MoveResult> {
  return simpleMove(ctx, id, version, "approved", async (sql) => {
    await sql`update getfunded.messages set error = null where id = ${id}::uuid`;
  });
}

const ACTIVITY_KIND: Record<Channel, "email" | "letter" | "note" | "call"> = {
  email: "email",
  letter: "letter",
  linkedin: "note",
  other: "call",
};

/** The person sent it themselves (their own mail, post, phone). Nothing leaves the app. */
export async function recordByHand(
  ctx: Ctx,
  input: { id: string; version: number; channel: Channel; sentAt?: Date; note: string },
): Promise<MoveResult> {
  const sentAt = input.sentAt ?? new Date();
  return simpleMove(ctx, input.id, input.version, "recorded", async (sql) => {
    await sql`
      update getfunded.messages
      set channel = ${input.channel}, sent_at = ${sentAt}, approved_by = coalesce(approved_by, ${ctx.userId}::uuid),
          approved_at = coalesce(approved_at, now()), error = null
      where id = ${input.id}::uuid`;
    const rows = await sql`select saved_funder_id from getfunded.messages where id = ${input.id}::uuid`;
    await sql`
      insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, occurred_at, created_by, meta)
      values (${ctx.workspaceId}::uuid, ${str(rows[0]?.saved_funder_id)}, ${ACTIVITY_KIND[input.channel]},
              ${`Recorded by hand: ${input.channel === "email" ? "email sent from my own mail" : input.channel}${input.note ? `. ${input.note}` : "."}`},
              ${sentAt}, ${ctx.userId}::uuid, ${sql.json({ message_id: input.id, recorded: true } as never)}::jsonb)`;
  });
}

/** A reply the person saw themselves (a call, a letter, a mail in their own inbox). Cancels pending follow-ups. */
export async function recordReplyByHand(
  ctx: Ctx,
  input: { id: string; repliedAt?: Date; via: string; note: string },
): Promise<{ ok: true; canceled: number } | { ok: false; error: string }> {
  const at = input.repliedAt ?? new Date();
  return withUser(ctx.userId, async (sql) => {
    const current = await lockMessage(sql, ctx.workspaceId, input.id);
    if (!current) return { ok: false, error: "That message no longer exists." };
    if (current.status !== "sent" && current.status !== "recorded") {
      return { ok: false, error: "Record a reply on a message that was sent or recorded." };
    }
    await sql`
      insert into getfunded.send_outcomes (message_id, workspace_id, outcome, provider_payload)
      values (${current.id}::uuid, ${ctx.workspaceId}::uuid, 'replied',
              ${sql.json({ replied_at: at.toISOString(), manual: true, via: input.via, note: input.note || null, recorded_by: ctx.userId } as never)}::jsonb)`;
    let canceled = 0;
    if (current.contactId) {
      canceled = await cancelPendingFollowUps(sql, ctx.workspaceId, current.contactId, `Canceled automatically: the contact replied on ${at.toISOString().slice(0, 10)}.`);
    }
    await sql`
      insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, occurred_at, created_by, meta)
      values (${ctx.workspaceId}::uuid, ${current.savedFunderId}, ${input.via === "call" ? "call" : input.via === "meeting" ? "meeting" : input.via === "letter" ? "letter" : "email"},
              ${`Reply recorded by hand (${input.via})${input.note ? `: ${input.note}` : "."}`}, ${at}, ${ctx.userId}::uuid,
              ${sql.json({ message_id: current.id, replied_at: at.toISOString(), canceled_follow_ups: canceled, manual: true } as never)}::jsonb)`;
    return { ok: true, canceled };
  });
}

/**
 * A follow-up draft in the same thread. Carries the parent's contact, funder
 * and Gmail thread id, so the send run threads it with In-Reply-To. Starts
 * from the "Letter of inquiry follow-up" template with the fields we know.
 */
export async function createFollowUp(
  ctx: Ctx,
  parentId: string,
  values: { orgName: string; senderName: string },
): Promise<MoveResult> {
  return withUser(ctx.userId, async (sql) => {
    const parent = await lockMessage(sql, ctx.workspaceId, parentId);
    if (!parent) return { ok: false, error: "That message no longer exists." };
    if (parent.status !== "sent" && parent.status !== "recorded") return { ok: false, error: "Follow up on a message that was sent." };
    const contactRows = parent.contactId ? await sql`select full_name from getfunded.contacts where id = ${parent.contactId}::uuid` : [];
    const funderRows = parent.savedFunderId
      ? await sql`select snapshot->>'name' as name from getfunded.saved_funders where id = ${parent.savedFunderId}::uuid`
      : [];
    const template = builtInTemplate("loi_follow_up")!;
    const rendered = renderTemplate(template, {
      contact_first_name: firstNameOf(str(contactRows[0]?.full_name)),
      contact_full_name: str(contactRows[0]?.full_name),
      funder_name: str(funderRows[0]?.name),
      org_name: values.orgName,
      sender_name: values.senderName,
    });
    const subject = parent.subject ? `Re: ${parent.subject.replace(/^(re|fw|fwd):\s*/i, "")}` : rendered.subject;
    const rows = await sql`
      insert into getfunded.messages
        (workspace_id, saved_funder_id, contact_id, channel, subject, body, draft_source, thread_id, status, created_by)
      values (${ctx.workspaceId}::uuid, ${parent.savedFunderId}, ${parent.contactId}, ${parent.channel}, ${subject},
              ${rendered.body}, 'template', ${parent.threadId}, 'draft', ${ctx.userId}::uuid)
      returning id, version, status`;
    const r = rows[0];
    return { ok: true, id: String(r.id), version: num(r.version, 1), status: r.status as MessageStatus };
  });
}

/** The latest research dossier for an org, for the AI polish (never mock output for a live request). */
export async function latestDossier(ctx: Ctx, orgId: string, mock: boolean): Promise<unknown | null> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql`
      select output from getfunded.ai_analyses
      where workspace_id = ${ctx.workspaceId}::uuid and org_id = ${orgId}::uuid and kind = 'research'
        and is_latest and is_mock = ${mock}
      limit 1`;
    return rows[0]?.output ?? null;
  });
}
