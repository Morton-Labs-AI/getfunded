import "server-only";
/**
 * Sender identities (a member's connected Gmail) and the sealed refresh token
 * behind each one. Tokens live in `getfunded.secrets`, encrypted with
 * SECRETS_KEY; the app role can read the ciphertext only through the
 * `getfunded.read_secret()` door, which admits the owner or a workspace admin.
 * Nothing in this module ever returns a token to a caller outside the server,
 * and nothing logs one.
 */
import { decryptSecret, encryptSecret, secretsKey } from "@/lib/email/crypto";
import {
  gmailProfile,
  hasRequiredScopes,
  refreshAccessToken,
  revokeToken,
  type Env,
  type FetchLike,
  type MetadataMessage,
  type SentRef,
  GmailError,
  gmailSend,
  gmailThreadMeta,
  findSentByMessageId,
} from "@/lib/email/gmail";

import { clampDailyCap } from "./cap";
import { iso, num, str, withUser, type Ctx, type Tx } from "./db";
import type { RunnerIdentity, Transport } from "./runner";
import type { SenderIdentity } from "./types";

function toIdentity(r: Record<string, unknown>): SenderIdentity {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    userId: String(r.user_id),
    email: String(r.email),
    displayName: str(r.display_name),
    provider: "gmail",
    status: (str(r.status) as SenderIdentity["status"]) ?? "disconnected",
    dailyCap: clampDailyCap(r.daily_cap),
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
    version: num(r.version, 1),
  };
}

const IDENTITY_COLUMNS = `id, workspace_id, user_id, email, display_name, provider, status, daily_cap, created_at, updated_at, version`;

export async function listSenderIdentities(ctx: Ctx): Promise<SenderIdentity[]> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `select ${IDENTITY_COLUMNS} from getfunded.sender_identities where workspace_id = $1 order by created_at asc`,
      [ctx.workspaceId],
    );
    return rows.map((r) => toIdentity(r as Record<string, unknown>));
  });
}

export async function getSenderIdentity(ctx: Ctx, id: string): Promise<SenderIdentity | null> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `select ${IDENTITY_COLUMNS} from getfunded.sender_identities where id = $1 and workspace_id = $2`,
      [id, ctx.workspaceId],
    );
    return rows[0] ? toIdentity(rows[0] as Record<string, unknown>) : null;
  });
}

/** The caller's own connected mailbox in this workspace, if any. */
export async function mySenderIdentity(ctx: Ctx): Promise<SenderIdentity | null> {
  const all = await listSenderIdentities(ctx);
  return all.find((i) => i.userId === ctx.userId && i.status === "connected") ?? all.find((i) => i.userId === ctx.userId) ?? null;
}

/**
 * The mailboxes this caller may send from: their own, plus every connected
 * one in the workspace when they are an owner or admin (read_secret admits
 * admins to the token).
 */
export async function sendableIdentities(ctx: Ctx, role: string): Promise<SenderIdentity[]> {
  const all = await listSenderIdentities(ctx);
  const admin = role === "owner" || role === "admin";
  return all.filter((i) => i.status === "connected" && (admin || i.userId === ctx.userId));
}

export type ConnectInput = {
  email: string;
  displayName: string | null;
  refreshToken: string;
};

/** Store the sealed refresh token and mark the identity connected. Replaces any older token for this user. */
export async function connectGmail(ctx: Ctx, input: ConnectInput, env: Env = process.env): Promise<SenderIdentity> {
  const key = secretsKey(env);
  const sealed = encryptSecret(input.refreshToken, key);
  const email = input.email.trim().toLowerCase();
  return withUser(ctx.userId, async (sql) => {
    await sql`
      delete from getfunded.secrets
      where workspace_id = ${ctx.workspaceId}::uuid and owner_user_id = ${ctx.userId}::uuid and kind = 'gmail_refresh_token'`;
    await sql`
      insert into getfunded.secrets (workspace_id, owner_user_id, kind, ciphertext, iv, tag, key_version)
      values (${ctx.workspaceId}::uuid, ${ctx.userId}::uuid, 'gmail_refresh_token',
              ${sealed.ciphertext}, ${sealed.iv}, ${sealed.tag}, ${sealed.keyVersion})`;
    // One identity per (workspace, user, email). A different address replaces the old row's status.
    await sql`
      update getfunded.sender_identities
      set status = 'disconnected'
      where workspace_id = ${ctx.workspaceId}::uuid and user_id = ${ctx.userId}::uuid and email <> ${email}`;
    const rows = await sql.unsafe(
      `insert into getfunded.sender_identities (workspace_id, user_id, email, display_name, provider, status)
       values ($1, $2, $3, $4, 'gmail', 'connected')
       on conflict on constraint uq_sender_identity
       do update set status = 'connected', display_name = coalesce(excluded.display_name, getfunded.sender_identities.display_name)
       returning ${IDENTITY_COLUMNS}`,
      [ctx.workspaceId, ctx.userId, email, input.displayName],
    );
    return toIdentity(rows[0] as Record<string, unknown>);
  });
}

/** Read and decrypt the identity owner's refresh token through the door. */
export async function refreshTokenFor(ctx: Ctx, identity: Pick<SenderIdentity, "userId" | "workspaceId">, env: Env = process.env): Promise<string> {
  const key = secretsKey(env);
  return withUser(ctx.userId, async (sql) => {
    const ids = await sql`
      select id from getfunded.secrets
      where workspace_id = ${identity.workspaceId}::uuid and owner_user_id = ${identity.userId}::uuid and kind = 'gmail_refresh_token'
      order by created_at desc
      limit 1`;
    const secretId = str(ids[0]?.id);
    if (!secretId) throw new GmailError("not_connected", "This mailbox has no saved connection. Connect Gmail in Outreach settings.");
    const rows = await sql`select ciphertext, iv, tag, key_version from getfunded.read_secret(${secretId}::uuid)`;
    const r = rows[0];
    if (!r) throw new GmailError("not_connected", "The saved connection could not be read.");
    return decryptSecret(
      {
        ciphertext: r.ciphertext as Buffer,
        iv: r.iv as Buffer,
        tag: r.tag as Buffer,
        keyVersion: num(r.key_version, 1),
      },
      key,
    );
  });
}

/** Revoke at Google (best effort), delete the token, mark the identity disconnected. */
export async function disconnectGmail(ctx: Ctx, identityId: string, env: Env = process.env, fetchImpl: FetchLike = fetch): Promise<void> {
  const identity = await getSenderIdentity(ctx, identityId);
  if (!identity) return;
  let token: string | null = null;
  try {
    token = await refreshTokenFor(ctx, identity, env);
  } catch {
    // A missing or unreadable token still ends in the right state: disconnected.
  }
  if (token) await revokeToken(token, fetchImpl);
  await withUser(ctx.userId, async (sql) => {
    await sql`
      delete from getfunded.secrets
      where workspace_id = ${identity.workspaceId}::uuid and owner_user_id = ${identity.userId}::uuid and kind = 'gmail_refresh_token'`;
    await sql`
      update getfunded.sender_identities set status = 'disconnected'
      where id = ${identity.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
  });
}

export async function markIdentityError(ctx: Ctx, identityId: string): Promise<void> {
  await withUser(ctx.userId, async (sql: Tx) => {
    await sql`
      update getfunded.sender_identities set status = 'error'
      where id = ${identityId}::uuid and workspace_id = ${ctx.workspaceId}::uuid and status = 'connected'`;
  });
}

export async function updateDailyCap(ctx: Ctx, input: { id: string; version: number; dailyCap: number }): Promise<SenderIdentity | null> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `update getfunded.sender_identities
       set daily_cap = $3
       where id = $1 and workspace_id = $2 and version = $4
       returning ${IDENTITY_COLUMNS}`,
      [input.id, ctx.workspaceId, clampDailyCap(input.dailyCap), input.version],
    );
    return rows[0] ? toIdentity(rows[0] as Record<string, unknown>) : null;
  });
}

/** Verify a fresh grant: the mailbox address and that both scopes were allowed. */
export async function verifiedProfile(accessToken: string, scope: string, fetchImpl: FetchLike = fetch): Promise<{ emailAddress: string }> {
  if (!hasRequiredScopes(scope)) {
    throw new GmailError("scope", "Google did not grant both permissions. Try again and allow send and metadata access.");
  }
  return gmailProfile(accessToken, fetchImpl);
}

export function toRunnerIdentity(identity: SenderIdentity): RunnerIdentity {
  return {
    id: identity.id,
    workspaceId: identity.workspaceId,
    userId: identity.userId,
    email: identity.email,
    displayName: identity.displayName,
    dailyCap: identity.dailyCap,
    status: identity.status,
  };
}

/** Gmail transport for the runner, bound to this caller's right to read the token. */
export function makeGmailTransport(ctx: Ctx, env: Env = process.env, fetchImpl: FetchLike = fetch): Transport {
  return {
    async accessToken(identity) {
      const refresh = await refreshTokenFor(ctx, identity, env);
      const token = await refreshAccessToken(refresh, env, fetchImpl);
      return token.accessToken;
    },
    send(token, raw, threadId): Promise<SentRef> {
      return gmailSend(token, raw, threadId, fetchImpl);
    },
    findSent(token, messageId) {
      return findSentByMessageId(token, messageId, fetchImpl);
    },
    async threadMessages(token, threadId): Promise<MetadataMessage[]> {
      const thread = await gmailThreadMeta(token, threadId, fetchImpl);
      return thread.messages ?? [];
    },
  };
}
