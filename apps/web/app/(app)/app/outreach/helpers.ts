/**
 * Pure helpers for the outreach pages: reading the URL, deciding what the
 * page may offer, and turning stored rows into plain sentences. No server
 * imports, so tests/unit/outreach/pages.test.ts can import this file as is.
 */
import type { ComposerContact, ComposerFunder, ComposerTemplate } from "@/components/outreach/message-composer";
import type { PanelContact } from "@/components/outreach/contacts-panel";
import type { PanelIdentity } from "@/components/outreach/sender-panel";
import type { QueueTab } from "@/lib/outreach/messages";
import type { Template } from "@/lib/outreach/templates";
import { CHANNELS, type Channel, type Contact, type SendOutcomeRow, type SenderIdentity } from "@/lib/outreach/types";

/* ----------------------------------------------------------------------------
   URL state
---------------------------------------------------------------------------- */

/** Mirrors QUEUE_TABS in lib/outreach/messages.ts, which is server-only. */
const TABS: readonly QueueTab[] = ["drafts", "approved", "sent", "replied"];

/** `?tab=` → a queue tab; anything else is the first tab. */
export function parseQueueTab(value: string | null | undefined): QueueTab {
  return typeof value === "string" && (TABS as readonly string[]).includes(value) ? (value as QueueTab) : "drafts";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A uuid from the URL, or null when it is not one. */
export function uuidParam(value: string | null | undefined): string | null {
  return typeof value === "string" && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

export type ComposerInitial = { contactId: string | null; templateKey: string | null; channel: Channel | null };

/** What the composer starts with, from `?contact=`, `?template=` and `?channel=`. Unknown values are dropped, never guessed. */
export function composerInitial(params: { contact?: string | null; template?: string | null; channel?: string | null }): ComposerInitial {
  const channel = typeof params.channel === "string" && (CHANNELS as readonly string[]).includes(params.channel) ? (params.channel as Channel) : null;
  const templateKey = typeof params.template === "string" && params.template.trim().length > 0 && params.template.length <= 120 ? params.template.trim() : null;
  return { contactId: uuidParam(params.contact), templateKey, channel };
}

/* ----------------------------------------------------------------------------
   Gates
---------------------------------------------------------------------------- */

/** The send and sync buttons appear only when the plan allows Gmail AND this person has a connected mailbox to send from. */
export function canRunSend(sendGmail: boolean, sendable: ReadonlyArray<Pick<SenderIdentity, "status">>): boolean {
  return sendGmail && sendable.some((s) => s.status === "connected");
}

/** The mailbox approval will name: the caller's own first, else the first one they may use. */
export function pickSender<T extends Pick<SenderIdentity, "userId" | "status">>(sendable: readonly T[], userId: string): T | null {
  const connected = sendable.filter((s) => s.status === "connected");
  return connected.find((s) => s.userId === userId) ?? connected[0] ?? null;
}

/* ----------------------------------------------------------------------------
   Gmail connect result (?gmail=connected | error&reason=code)
---------------------------------------------------------------------------- */

export type GmailNotice = { tone: "success" | "error"; text: string };

const GMAIL_REASONS: Record<string, string> = {
  plan: "Sending through Gmail is part of the Pro plan and above. Your plan does not include it yet.",
  unconfigured: "Gmail is not set up on this server. The operator needs to add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
  secrets_key: "This server has no SECRETS_KEY, so a mailbox connection cannot be stored safely. The operator needs to set it.",
  denied: "You did not allow the permissions at Google, so nothing was connected. Try again when you are ready.",
  google: "Google returned an error before the connection finished. Try again in a minute.",
  missing_code: "Google did not send the code the app needs. Try the connection again.",
  bad_state: "The link back from Google was not valid or had expired. Start the connection again from this page.",
  wrong_user: "The link back from Google was for a different account or workspace. Start the connection again from this page.",
  no_refresh_token: "Google did not give the app a lasting connection. Remove GetFunded from your Google account's connected apps, then connect again.",
  scope: "Google did not grant both permissions. Try again and allow send and metadata access.",
  reconnect: "Google no longer accepts this connection. Connect Gmail again.",
  upstream: "Google did not answer as expected. Try again in a minute.",
  rate: "Google is rate-limiting this mailbox. Wait a minute and try again.",
  not_connected: "There is no saved connection for this mailbox. Connect Gmail to continue.",
  unknown: "The connection did not finish. Try again, and tell the operator if it keeps failing.",
};

/** Plain words for the result the Gmail routes send back in the URL. Null when there is nothing to say. */
export function gmailNotice(status: string | null | undefined, reason: string | null | undefined): GmailNotice | null {
  if (status === "connected") return { tone: "success", text: "Gmail is connected. Approved email can now be sent from this mailbox." };
  if (status === "error") {
    const code = typeof reason === "string" ? reason.trim().toLowerCase() : "";
    return { tone: "error", text: GMAIL_REASONS[code] ?? GMAIL_REASONS.unknown };
  }
  return null;
}

/* ----------------------------------------------------------------------------
   Outcome history
---------------------------------------------------------------------------- */

export type OutcomeLine = { title: string; detail: string | null; tone: "neutral" | "success" | "danger" };

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** One sentence per `send_outcomes` row. Never shows a token or a raw payload. */
export function describeOutcome(row: Pick<SendOutcomeRow, "outcome" | "providerPayload">): OutcomeLine {
  const p = row.providerPayload ?? {};
  switch (row.outcome) {
    case "accepted":
      return {
        title: p.reconciled === true ? "Gmail accepted the email (confirmed after an interrupted run)" : "Gmail accepted the email",
        detail: null,
        tone: "success",
      };
    case "replied": {
      const manual = p.manual === true;
      const via = payloadString(p, "via");
      const note = payloadString(p, "note");
      const from = manual ? null : payloadString(p, "from");
      const parts = [manual ? `Reply recorded by hand${via ? ` (${via})` : ""}` : "The contact replied"];
      return {
        title: parts[0],
        detail: [from ? `From ${from}` : null, note].filter(Boolean).join(". ") || null,
        tone: "success",
      };
    }
    case "bounced":
      return { title: "The email bounced", detail: "Delivery failed. Check the address before writing again.", tone: "danger" };
    case "failed":
      return { title: "Sending failed", detail: payloadString(p, "error"), tone: "danger" };
    default:
      return { title: String(row.outcome), detail: null, tone: "neutral" };
  }
}

/* ----------------------------------------------------------------------------
   Row shaping for the client panels
---------------------------------------------------------------------------- */

export function toComposerFunder(f: { id: string; orgId: string; name: string; snapshot: { city?: string | null; state?: string | null } }): ComposerFunder {
  return { id: f.id, orgId: f.orgId, name: f.name, city: f.snapshot.city ?? null, state: f.snapshot.state ?? null };
}

export function toComposerContact(c: Contact): ComposerContact {
  return { id: c.id, fullName: c.fullName, title: c.title, email: c.email, phone: c.phone, source: c.source };
}

export function toPanelContact(c: Contact): PanelContact {
  return { id: c.id, fullName: c.fullName, title: c.title, email: c.email, phone: c.phone, source: c.source, sourceUrl: c.sourceUrl, version: c.version };
}

export function toComposerTemplate(t: Template): ComposerTemplate {
  return { key: t.key, name: t.name, when: t.when, subject: t.subject, body: t.body, builtIn: t.builtIn };
}

export function toPanelIdentity(i: SenderIdentity, userId: string): PanelIdentity {
  return {
    id: i.id,
    userId: i.userId,
    email: i.email,
    displayName: i.displayName,
    status: i.status,
    dailyCap: i.dailyCap,
    version: i.version,
    createdAt: i.createdAt,
    isMine: i.userId === userId,
  };
}

/** The page title for one message: the funder, else the subject, else the channel. */
export function messageTitle(row: { funderName: string | null; subject: string | null; channel: string }, channelLabel: string): string {
  if (row.funderName?.trim()) return row.funderName.trim();
  if (row.subject?.trim()) return row.subject.trim();
  return channelLabel;
}
