import "server-only";
/**
 * The database side of the send runner and the reply sync: `SendStore` and
 * `SyncStore` on `getfunded.messages`, `send_outcomes`, `suppressions` and
 * `activities`, every query under `withUser()`.
 *
 * Status moves here are compare-and-swap on the CURRENT status, not only on
 * version, so two concurrent runs can never both move the same row.
 */
import { assertTransition, type MessageStatus } from "./state";
import { iso, num, str, withUser, type Ctx, type Tx } from "./db";
import type { RunnerMessage, SendStore, ThreadParent } from "./runner";
import type { SyncCandidate, SyncStore } from "./sync";
import type { SuppressionEntry } from "./suppress";

const RUNNER_COLUMNS = `
  m.id, m.workspace_id, m.status, m.channel, m.contact_id, m.sender_identity_id,
  m.subject, m.body, m.idempotency_key, m.thread_id, m.sent_at, m.version,
  c.email as contact_email, c.full_name as contact_name`;

function toRunnerMessage(r: Record<string, unknown>): RunnerMessage {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    status: String(r.status),
    channel: String(r.channel),
    contactId: str(r.contact_id),
    contactEmail: str(r.contact_email),
    contactName: str(r.contact_name),
    senderIdentityId: str(r.sender_identity_id),
    subject: str(r.subject),
    body: String(r.body ?? ""),
    idempotencyKey: str(r.idempotency_key),
    threadId: str(r.thread_id),
    sentAt: iso(r.sent_at),
    version: num(r.version, 1),
  };
}

/**
 * Cancel every pending follow-up to a contact. "Pending" = approved (about to
 * go) or a draft that continues an existing thread. A fresh draft with no
 * thread is left alone: the person may still want to write something new.
 */
export async function cancelPendingFollowUps(sql: Tx, workspaceId: string, contactId: string, reason: string): Promise<number> {
  const rows = await sql`
    update getfunded.messages
    set status = 'canceled', error = ${reason}
    where workspace_id = ${workspaceId}::uuid
      and contact_id = ${contactId}::uuid
      and channel = 'email'
      and (status = 'approved' or (status = 'draft' and thread_id is not null))
    returning id`;
  return rows.length;
}

async function insertOutcome(sql: Tx, workspaceId: string, messageId: string, outcome: string, payload: Record<string, unknown>) {
  await sql`
    insert into getfunded.send_outcomes (message_id, workspace_id, outcome, provider_payload)
    values (${messageId}::uuid, ${workspaceId}::uuid, ${outcome}, ${sql.json(payload as never)}::jsonb)`;
}

/** The app's own timeline entry on the saved funder. Never fails the caller. */
async function systemActivity(
  sql: Tx,
  workspaceId: string,
  userId: string,
  messageId: string,
  kind: "email" | "letter" | "note" | "call" | "system",
  body: string,
  meta: Record<string, unknown>,
) {
  const rows = await sql`select saved_funder_id from getfunded.messages where id = ${messageId}::uuid`;
  const savedFunderId = str(rows[0]?.saved_funder_id);
  await sql`
    insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
    values (${workspaceId}::uuid, ${savedFunderId}, ${kind}, ${body}, ${userId}::uuid,
            ${sql.json({ message_id: messageId, ...meta } as never)}::jsonb)`;
}

export function makeSendStore(ctx: Ctx): SendStore & SyncStore {
  const { userId, workspaceId } = ctx;

  async function moveStatus(
    sql: Tx,
    id: string,
    from: readonly MessageStatus[],
    to: MessageStatus,
    extra: (sql: Tx) => Promise<unknown>,
  ): Promise<boolean> {
    for (const f of from) assertTransition(f, to);
    const rows = await sql`
      update getfunded.messages
      set status = ${to}
      where id = ${id}::uuid and workspace_id = ${workspaceId}::uuid and status = any(${[...from]}::text[])
      returning id`;
    if (rows.length === 0) return false;
    await extra(sql);
    return true;
  }

  return {
    async listInterrupted(identityId) {
      // 'sending' rows are a run that died mid-send. 'failed' rows with a key
      // and no provider id in the last week include the ones the daily cron
      // marked stale; the mailbox is the only honest witness for both.
      return withUser(userId, async (sql) => {
        const rows = await sql.unsafe(
          `select ${RUNNER_COLUMNS}
           from getfunded.messages m
           left join getfunded.contacts c on c.id = m.contact_id
           where m.workspace_id = $1 and m.sender_identity_id = $2 and m.channel = 'email'
             and m.idempotency_key is not null and m.provider_message_id is null
             and (m.status = 'sending'
                  or (m.status = 'failed' and m.updated_at >= now() - interval '7 days'))
           order by m.updated_at asc
           limit 100`,
          [workspaceId, identityId],
        );
        return rows.map((r) => toRunnerMessage(r as Record<string, unknown>));
      });
    },

    async listApproved(identityId, messageIds) {
      return withUser(userId, async (sql) => {
        const rows = messageIds
          ? await sql.unsafe(
              `select ${RUNNER_COLUMNS}
               from getfunded.messages m
               left join getfunded.contacts c on c.id = m.contact_id
               where m.workspace_id = $1 and m.id = any($2::uuid[])
               order by m.approved_at asc nulls last, m.created_at asc`,
              [workspaceId, messageIds],
            )
          : await sql.unsafe(
              `select ${RUNNER_COLUMNS}
               from getfunded.messages m
               left join getfunded.contacts c on c.id = m.contact_id
               where m.workspace_id = $1 and m.sender_identity_id = $2 and m.status = 'approved' and m.channel = 'email'
               order by m.approved_at asc nulls last, m.created_at asc
               limit 200`,
              [workspaceId, identityId],
            );
        return rows.map((r) => toRunnerMessage(r as Record<string, unknown>));
      });
    },

    async suppressions() {
      return withUser(userId, async (sql) => {
        const rows = await sql`
          select kind, value, reason from getfunded.suppressions where workspace_id = ${workspaceId}::uuid`;
        return rows.map((r) => ({ kind: r.kind as "email" | "domain", value: String(r.value), reason: str(r.reason) })) as SuppressionEntry[];
      });
    },

    async sentSince(identityId, since) {
      return withUser(userId, async (sql) => {
        const rows = await sql`
          select count(*)::int as n
          from getfunded.messages
          where workspace_id = ${workspaceId}::uuid
            and sender_identity_id = ${identityId}::uuid
            and status = 'sent'
            and sent_at >= ${since}`;
        return num(rows[0]?.n, 0);
      });
    },

    async threadParent(threadId, excludeId): Promise<ThreadParent | null> {
      return withUser(userId, async (sql) => {
        const rows = await sql`
          select idempotency_key, provider_message_id, thread_id
          from getfunded.messages
          where workspace_id = ${workspaceId}::uuid
            and thread_id = ${threadId}
            and status = 'sent'
            and id <> ${excludeId}::uuid
          order by sent_at desc nulls last
          limit 1`;
        const r = rows[0];
        if (!r) return null;
        return {
          idempotencyKey: str(r.idempotency_key),
          providerMessageId: str(r.provider_message_id),
          threadId: str(r.thread_id),
        };
      });
    },

    async markSending(id, version, idempotencyKey) {
      return withUser(userId, async (sql) => {
        const rows = await sql`
          update getfunded.messages m
          set status = 'sending',
              idempotency_key = coalesce(m.idempotency_key, ${idempotencyKey}),
              error = null
          where m.id = ${id}::uuid and m.workspace_id = ${workspaceId}::uuid
            and m.status = 'approved' and m.version = ${version}
          returning m.id`;
        if (rows.length === 0) return null;
        const live = await sql.unsafe(
          `select ${RUNNER_COLUMNS}
           from getfunded.messages m
           left join getfunded.contacts c on c.id = m.contact_id
           where m.id = $1`,
          [id],
        );
        return live[0] ? toRunnerMessage(live[0] as Record<string, unknown>) : null;
      });
    },

    async markSent(id, result) {
      await withUser(userId, async (sql) => {
        const moved = await moveStatus(sql, id, ["sending", "failed"], "sent", async () => {
          await sql`
            update getfunded.messages
            set provider_message_id = ${result.providerMessageId},
                thread_id = ${result.threadId},
                sent_at = ${result.sentAt},
                error = null
            where id = ${id}::uuid`;
          await insertOutcome(sql, workspaceId, id, "accepted", {
            provider: "gmail",
            provider_message_id: result.providerMessageId,
            thread_id: result.threadId,
            reconciled: result.reconciled,
          });
          await systemActivity(sql, workspaceId, userId, id, "email", result.reconciled ? "Email sent (confirmed from the mailbox after an interrupted run)." : "Email sent through Gmail.", {
            provider_message_id: result.providerMessageId,
          });
        });
        if (!moved) throw new Error(`markSent: message ${id} is no longer sending or failed.`);
      });
    },

    async markFailed(id, error) {
      await withUser(userId, async (sql) => {
        await moveStatus(sql, id, ["sending"], "failed", async () => {
          await sql`update getfunded.messages set error = ${error.slice(0, 1000)} where id = ${id}::uuid`;
          await insertOutcome(sql, workspaceId, id, "failed", { provider: "gmail", error: error.slice(0, 1000) });
        });
      });
    },

    async requeue(id) {
      await withUser(userId, async (sql) => {
        await moveStatus(sql, id, ["sending"], "approved", async () => {
          await sql`update getfunded.messages set error = null where id = ${id}::uuid`;
        });
      });
    },

    async listSentForSync(identityId, since, limit): Promise<SyncCandidate[]> {
      return withUser(userId, async (sql) => {
        const rows = await sql`
          select m.id, m.contact_id, m.thread_id, m.sent_at
          from getfunded.messages m
          where m.workspace_id = ${workspaceId}::uuid
            and m.sender_identity_id = ${identityId}::uuid
            and m.status = 'sent' and m.channel = 'email'
            and m.thread_id is not null and m.sent_at >= ${since}
            and not exists (
              select 1 from getfunded.send_outcomes o
              where o.message_id = m.id and o.outcome in ('replied', 'bounced'))
          order by m.sent_at desc
          limit ${limit}`;
        return rows.map((r) => ({
          id: String(r.id),
          contactId: str(r.contact_id),
          threadId: String(r.thread_id),
          sentAt: iso(r.sent_at) ?? new Date(0).toISOString(),
        }));
      });
    },

    async recordReply(messageId, detail) {
      return withUser(userId, async (sql) => {
        const rows = await sql`
          select contact_id from getfunded.messages
          where id = ${messageId}::uuid and workspace_id = ${workspaceId}::uuid`;
        if (rows.length === 0) throw new Error("recordReply: message not found.");
        const contactId = str(rows[0].contact_id);
        await insertOutcome(sql, workspaceId, messageId, "replied", {
          replied_at: detail.at.toISOString(),
          from: detail.manual ? null : detail.from,
          provider_message_id: detail.providerMessageId,
          manual: detail.manual,
          note: detail.note ?? null,
          recorded_by: userId,
        });
        let canceled = 0;
        if (contactId) {
          canceled = await cancelPendingFollowUps(
            sql,
            workspaceId,
            contactId,
            `Canceled automatically: the contact replied on ${detail.at.toISOString().slice(0, 10)}.`,
          );
        }
        await systemActivity(
          sql,
          workspaceId,
          userId,
          messageId,
          detail.manual ? "note" : "email",
          detail.manual
            ? `Reply recorded by hand${detail.note ? `: ${detail.note}` : "."}`
            : "The contact replied (seen in Gmail thread headers).",
          { replied_at: detail.at.toISOString(), canceled_follow_ups: canceled, manual: detail.manual },
        );
        return { canceled };
      });
    },

    async recordBounce(messageId, detail) {
      await withUser(userId, async (sql) => {
        await insertOutcome(sql, workspaceId, messageId, "bounced", {
          bounced_at: detail.at.toISOString(),
          from: detail.from,
          provider_message_id: detail.providerMessageId,
        });
        await sql`
          update getfunded.messages set error = ${"The address bounced (delivery failed)."}
          where id = ${messageId}::uuid and workspace_id = ${workspaceId}::uuid`;
        await systemActivity(sql, workspaceId, userId, messageId, "system", "The email bounced. Check the address before writing again.", {
          bounced_at: detail.at.toISOString(),
        });
      });
    },

    async touchPolled() {
      // messages has no last-polled column; the sync bounds its work by the
      // 90-day window and the per-run limit instead.
    },
  };
}
