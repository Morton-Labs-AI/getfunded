import "server-only";
/**
 * The workspace's own contact rows (`getfunded.contacts`). A corpus public
 * channel (a role-based inbox or phone a funder listed in Form 990-PF Part
 * XV) is copied here with source 'filing_part_xv' only when a person clicks
 * "Use this contact"; nothing is copied in bulk and nothing personal is ever
 * copied, because the public view already nulls everything that is not
 * publishability = 'public'.
 */
import { iso, num, str, withUser, type Ctx } from "./db";
import { extractAddress, isValidEmail, normalizeEmail } from "./suppress";
import type { Contact, ContactInput, ContactSource } from "./types";

const CONTACT_COLUMNS = `id, workspace_id, saved_funder_id, full_name, title, email, phone, source, source_url, publishability,
  created_by, created_at, updated_at, version`;

function toContact(r: Record<string, unknown>): Contact {
  return {
    id: String(r.id),
    workspaceId: String(r.workspace_id),
    savedFunderId: str(r.saved_funder_id),
    fullName: String(r.full_name ?? ""),
    title: str(r.title),
    email: str(r.email),
    phone: str(r.phone),
    source: (str(r.source) as ContactSource) ?? "manual",
    sourceUrl: str(r.source_url),
    publishability: str(r.publishability),
    createdBy: str(r.created_by),
    createdAt: iso(r.created_at) ?? "",
    updatedAt: iso(r.updated_at) ?? "",
    version: num(r.version, 1),
  };
}

export async function listContacts(ctx: Ctx, savedFunderId?: string | null): Promise<Contact[]> {
  return withUser(ctx.userId, async (sql) => {
    const rows = savedFunderId
      ? await sql.unsafe(
          `select ${CONTACT_COLUMNS} from getfunded.contacts
           where workspace_id = $1 and saved_funder_id = $2 order by created_at asc`,
          [ctx.workspaceId, savedFunderId],
        )
      : await sql.unsafe(
          `select ${CONTACT_COLUMNS} from getfunded.contacts
           where workspace_id = $1 order by created_at desc limit 500`,
          [ctx.workspaceId],
        );
    return rows.map((r) => toContact(r as Record<string, unknown>));
  });
}

export async function getContact(ctx: Ctx, id: string): Promise<Contact | null> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(`select ${CONTACT_COLUMNS} from getfunded.contacts where id = $1 and workspace_id = $2`, [
      id,
      ctx.workspaceId,
    ]);
    return rows[0] ? toContact(rows[0] as Record<string, unknown>) : null;
  });
}

export type ContactResult = { ok: true; contact: Contact } | { ok: false; error: string };

function validateAddress(email: string): string | null {
  const v = normalizeEmail(extractAddress(email));
  if (v && !isValidEmail(v)) return "That email address does not look right. Check it and try again.";
  return null;
}

export async function createContact(ctx: Ctx, input: ContactInput): Promise<ContactResult> {
  const email = normalizeEmail(extractAddress(input.email));
  const problem = validateAddress(email);
  if (problem) return { ok: false, error: problem };
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `insert into getfunded.contacts (workspace_id, saved_funder_id, full_name, title, email, phone, source, created_by)
       values ($1, $2, $3, $4, $5, $6, 'manual', $7)
       returning ${CONTACT_COLUMNS}`,
      [ctx.workspaceId, input.savedFunderId, input.fullName, input.title || null, email || null, input.phone || null, ctx.userId],
    );
    return { ok: true, contact: toContact(rows[0] as Record<string, unknown>) };
  });
}

export async function updateContact(
  ctx: Ctx,
  input: { id: string; version: number; fullName: string; title: string; email: string; phone: string },
): Promise<ContactResult> {
  const email = normalizeEmail(extractAddress(input.email));
  const problem = validateAddress(email);
  if (problem) return { ok: false, error: problem };
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `update getfunded.contacts
       set full_name = $3, title = $4, email = $5, phone = $6
       where id = $1 and workspace_id = $2 and version = $7
       returning ${CONTACT_COLUMNS}`,
      [input.id, ctx.workspaceId, input.fullName, input.title || null, email || null, input.phone || null, input.version],
    );
    if (!rows[0]) return { ok: false, error: "This contact was changed somewhere else. Reload the page and try again." };
    return { ok: true, contact: toContact(rows[0] as Record<string, unknown>) };
  });
}

export async function deleteContact(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.userId, async (sql) => {
    await sql`delete from getfunded.contacts where id = ${id}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
  });
}

/** A public, role-based channel from the funder's filing, as the picker shows it. */
export type FilingChannel = {
  id: string;
  kind: "email" | "phone" | "other";
  value: string;
  label: string;
  sourceUrl: string | null;
  sourceDataset: string | null;
  isRoleBased: boolean;
};

/**
 * Copy one public filing channel into the workspace. The caller has already
 * fetched the channel from the corpus (lib/outreach/deps.ts); this records it
 * with its provenance so the queue can show where the address came from.
 */
export async function copyFilingContact(
  ctx: Ctx,
  input: { savedFunderId: string; channel: FilingChannel; label?: string },
): Promise<ContactResult> {
  const { channel } = input;
  const email = channel.kind === "email" ? normalizeEmail(channel.value) : "";
  const phone = channel.kind === "phone" ? channel.value.trim() : "";
  if (channel.kind === "email" && !isValidEmail(email)) {
    return { ok: false, error: "The filing lists an address that does not look like an email. Add the contact by hand instead." };
  }
  const fullName = (input.label ?? "").trim() || (channel.kind === "phone" ? "Office phone (from filing)" : "Grants contact (from filing)");
  return withUser(ctx.userId, async (sql) => {
    // Re-using the same channel twice makes one row, not two.
    const existing = await sql.unsafe(
      `select ${CONTACT_COLUMNS} from getfunded.contacts
       where workspace_id = $1 and saved_funder_id = $2 and source = 'filing_part_xv'
         and ((email is not null and email = $3) or (phone is not null and phone = $4))
       limit 1`,
      [ctx.workspaceId, input.savedFunderId, email || null, phone || null],
    );
    if (existing[0]) return { ok: true, contact: toContact(existing[0] as Record<string, unknown>) };
    const rows = await sql.unsafe(
      `insert into getfunded.contacts
         (workspace_id, saved_funder_id, full_name, title, email, phone, source, source_url, publishability, created_by)
       values ($1, $2, $3, $4, $5, $6, 'filing_part_xv', $7, 'public', $8)
       returning ${CONTACT_COLUMNS}`,
      [
        ctx.workspaceId,
        input.savedFunderId,
        fullName,
        channel.isRoleBased ? "Role-based contact listed in the funder's filing" : "Listed in the funder's filing",
        email || null,
        phone || null,
        channel.sourceUrl,
        ctx.userId,
      ],
    );
    return { ok: true, contact: toContact(rows[0] as Record<string, unknown>) };
  });
}
