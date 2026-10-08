import "server-only";
/**
 * Bind a send run or a reply sync to the caller: which mailboxes they may use
 * (their own; every connected one when they are an owner or admin), the plan
 * gate, and the store and transport under their identity. Routes stay thin.
 */
import { GmailError, type Env, type FetchLike } from "@/lib/email/gmail";
import { SecretsKeyError } from "@/lib/email/crypto";

import type { Ctx } from "./db";
import { outreachAbilities } from "./gate";
import { runSendQueue, SendRunError, type SendReport } from "./runner";
import { makeGmailTransport, markIdentityError, sendableIdentities, toRunnerIdentity } from "./senders";
import { makeSendStore } from "./store";
import { runReplySync, type SyncReport } from "./sync";
import type { SendRequest, SenderIdentity, SyncRequest } from "./types";

export type Caller = Ctx & { role: string; plan: string | null | undefined };

export class OutreachRunError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "OutreachRunError";
    this.code = code;
    this.status = status;
  }
}

async function identitiesFor(caller: Caller, requested: string | undefined): Promise<SenderIdentity[]> {
  const abilities = outreachAbilities({ plan: caller.plan });
  if (!abilities.sendGmail) throw new OutreachRunError("plan_forbidden", abilities.sendGmailReason ?? "Sending needs the Pro plan.", 403);
  const sendable = await sendableIdentities(caller, caller.role);
  if (requested) {
    const one = sendable.find((i) => i.id === requested);
    if (!one) throw new OutreachRunError("sender_forbidden", "You cannot send from that mailbox.", 403);
    return [one];
  }
  // Own mailbox first, then (admins) the rest.
  return [...sendable].sort((a, b) => Number(b.userId === caller.userId) - Number(a.userId === caller.userId));
}

function translate(error: unknown): never {
  if (error instanceof OutreachRunError || error instanceof SendRunError || error instanceof GmailError || error instanceof SecretsKeyError) {
    throw new OutreachRunError(error.code, error.message, error.status);
  }
  throw error;
}

export type SendRunResult = { reports: SendReport[]; identities: number };

export async function runSendForCaller(
  caller: Caller,
  request: SendRequest,
  deps: { env?: Env; fetchImpl?: FetchLike; delayMs?: number } = {},
): Promise<SendRunResult> {
  const identities = await identitiesFor(caller, request.senderIdentityId);
  if (identities.length === 0) {
    throw new OutreachRunError("not_connected", "Connect your Gmail in Outreach settings before sending.", 409);
  }
  const store = makeSendStore(caller);
  const transport = makeGmailTransport(caller, deps.env, deps.fetchImpl);
  const reports: SendReport[] = [];
  for (const identity of identities) {
    try {
      reports.push(
        await runSendQueue({
          identity: toRunnerIdentity(identity),
          store,
          transport,
          messageIds: request.messageIds ?? null,
          limit: request.limit,
          delayMs: deps.delayMs,
          log: (message, extra) => console.warn(`[outreach/send] ${message}`, extra ?? {}),
        }),
      );
    } catch (error) {
      if (error instanceof GmailError && (error.code === "reconnect" || error.code === "scope")) {
        await markIdentityError(caller, identity.id);
      }
      if (reports.length === 0) translate(error);
      console.warn("[outreach/send] mailbox skipped", { identity: identity.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reports, identities: identities.length };
}

export type SyncRunResult = { reports: SyncReport[]; identities: number };

export async function runSyncForCaller(
  caller: Caller,
  request: SyncRequest,
  deps: { env?: Env; fetchImpl?: FetchLike } = {},
): Promise<SyncRunResult> {
  const identities = await identitiesFor(caller, request.senderIdentityId);
  if (identities.length === 0) {
    throw new OutreachRunError("not_connected", "Connect your Gmail in Outreach settings before checking for replies.", 409);
  }
  const store = makeSendStore(caller);
  const transport = makeGmailTransport(caller, deps.env, deps.fetchImpl);
  const reports: SyncReport[] = [];
  for (const identity of identities) {
    try {
      reports.push(await runReplySync({ identity: toRunnerIdentity(identity), store, transport, limit: request.limit }));
    } catch (error) {
      if (error instanceof GmailError && (error.code === "reconnect" || error.code === "scope")) {
        await markIdentityError(caller, identity.id);
      }
      if (reports.length === 0) translate(error);
      console.warn("[outreach/sync] mailbox skipped", { identity: identity.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { reports, identities: identities.length };
}
