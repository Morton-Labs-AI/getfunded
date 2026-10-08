import { z } from "zod";

import { MESSAGE_STATUSES, type MessageStatus } from "./state";

/**
 * Row shapes and input schemas for the outreach plane (schema `getfunded`,
 * migration 0006). Pure: shared by server modules, server actions, the runner
 * and its tests.
 */

export const CHANNELS = ["email", "letter", "linkedin", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "Email",
  letter: "Letter",
  linkedin: "LinkedIn message",
  other: "Call or other",
};

export const DRAFT_SOURCES = ["template", "ai"] as const;
export type DraftSource = (typeof DRAFT_SOURCES)[number];

export const CONTACT_SOURCES = ["filing_part_xv", "manual", "import", "web"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

export const OUTCOMES = ["accepted", "bounced", "replied", "failed"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export type Contact = {
  id: string;
  workspaceId: string;
  savedFunderId: string | null;
  fullName: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  source: ContactSource;
  sourceUrl: string | null;
  publishability: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SenderIdentity = {
  id: string;
  workspaceId: string;
  userId: string;
  email: string;
  displayName: string | null;
  provider: "gmail";
  status: "connected" | "disconnected" | "error";
  dailyCap: number;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type FunderSnapshotLite = {
  name?: string | null;
  ein?: string | null;
  org_type?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
};

export type Message = {
  id: string;
  workspaceId: string;
  savedFunderId: string | null;
  contactId: string | null;
  senderIdentityId: string | null;
  channel: Channel;
  subject: string | null;
  body: string;
  draftSource: DraftSource;
  aiAnalysisId: string | null;
  status: MessageStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  idempotencyKey: string | null;
  providerMessageId: string | null;
  threadId: string | null;
  sentAt: string | null;
  error: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type SendOutcomeRow = {
  id: string;
  messageId: string;
  workspaceId: string;
  outcome: Outcome;
  providerPayload: Record<string, unknown>;
  createdAt: string;
};

export type Suppression = {
  workspaceId: string;
  kind: "email" | "domain";
  value: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
};

/** A queue row: the message plus what the list needs to say about it. */
export type QueueRow = Message & {
  contactName: string | null;
  contactEmail: string | null;
  funderName: string | null;
  orgId: string | null;
  senderEmail: string | null;
  repliedAt: string | null;
  bouncedAt: string | null;
};

/* ----------------------------------------------------------------------------
   Input schemas (zod 4). Every server action and route parses with these.
---------------------------------------------------------------------------- */

export const uuid = z.uuid();

const trimmed = (max: number) => z.string().trim().max(max);

export const contactInputSchema = z.object({
  savedFunderId: uuid,
  fullName: trimmed(200).min(1, "Give the contact a name, or a role like \"Grants Office\"."),
  title: trimmed(200).optional().default(""),
  email: trimmed(320).optional().default(""),
  phone: trimmed(60).optional().default(""),
});
export type ContactInput = z.infer<typeof contactInputSchema>;

export const contactUpdateSchema = contactInputSchema.omit({ savedFunderId: true }).extend({
  id: uuid,
  version: z.coerce.number().int().positive(),
});

export const draftInputSchema = z.object({
  id: uuid.optional(),
  version: z.coerce.number().int().positive().optional(),
  savedFunderId: uuid,
  contactId: uuid.nullable().optional(),
  channel: z.enum(CHANNELS).default("email"),
  subject: trimmed(300).default(""),
  body: z.string().max(20_000, "Keep the message under 20,000 characters.").default(""),
  draftSource: z.enum(DRAFT_SOURCES).default("template"),
  /** Set when this is a follow-up in an existing thread. */
  threadId: trimmed(200).nullable().optional(),
  /** Model claims kept with the draft so the detail page can show them. */
  claims: z
    .array(z.object({ text: z.string().max(2000), evidenceId: z.string().max(200) }))
    .max(50)
    .optional(),
});
export type DraftInput = z.infer<typeof draftInputSchema>;

export const messageRefSchema = z.object({ id: uuid, version: z.coerce.number().int().positive() });

export const recordByHandSchema = messageRefSchema.extend({
  channel: z.enum(CHANNELS),
  sentAt: z.coerce.date().optional(),
  note: trimmed(2000).optional().default(""),
});

export const recordReplySchema = z.object({
  id: uuid,
  repliedAt: z.coerce.date().optional(),
  via: z.enum(["email", "call", "letter", "meeting", "other"]).default("email"),
  note: trimmed(2000).optional().default(""),
});

export const suppressionInputSchema = z.object({
  kind: z.enum(["email", "domain"]),
  value: trimmed(320).min(1, "Enter an address or a domain."),
  reason: trimmed(300).optional().default(""),
});

export const dailyCapSchema = z.object({
  senderIdentityId: uuid,
  version: z.coerce.number().int().positive(),
  dailyCap: z.coerce.number().int().min(0).max(2000),
});

export const boilerplateInputSchema = z.object({
  id: uuid.optional(),
  version: z.coerce.number().int().positive().optional(),
  name: trimmed(120).min(1, "Give the template a name."),
  subject: trimmed(300).default(""),
  body: z.string().max(20_000).min(1, "Write the template text."),
});

export const sendRequestSchema = z.object({
  /** Limit the run to these approved messages. Empty = every approved email the caller may send. */
  messageIds: z.array(uuid).max(100).optional(),
  /** Send from this connected mailbox. Default: the caller's own. Admins may name another member's. */
  senderIdentityId: uuid.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type SendRequest = z.infer<typeof sendRequestSchema>;

export const syncRequestSchema = z.object({
  senderIdentityId: uuid.optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export function isMessageStatusValue(value: unknown): value is MessageStatus {
  return typeof value === "string" && (MESSAGE_STATUSES as readonly string[]).includes(value);
}
