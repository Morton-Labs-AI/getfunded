import "server-only";

import { z } from "zod";

import { DbError } from "@/lib/db/app";

import { int, iso, run, text, type Deps } from "./sql";
import type { Contact, WorkspaceCtx } from "./types";

/**
 * The workspace's own contact rows (`getfunded.contacts`). These are YOURS:
 * people the team added by hand or imported. Public filing contacts live in
 * the corpus and are copied here only when a person clicks "Use this
 * contact" (source = filing_part_xv); that copy is outreach's job.
 */

export const addContactSchema = z.object({
  savedFunderId: z.uuid(),
  fullName: z.string().trim().min(1, "Enter the person's name.").max(200),
  title: z.string().trim().max(200).nullable().optional(),
  email: z.string().trim().email("Enter a valid email address.").max(254).nullable().optional().or(z.literal("")),
  phone: z.string().trim().max(60).nullable().optional(),
  source: z.enum(["manual", "import", "web", "filing_part_xv"]).default("manual"),
  sourceUrl: z.string().trim().url().max(500).nullable().optional().or(z.literal("")),
});
export type AddContactInput = z.input<typeof addContactSchema>;

type ContactRow = {
  id: string;
  saved_funder_id: string | null;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  source_url: string | null;
  created_at: unknown;
  version: number | string;
};

function toContact(r: ContactRow): Contact {
  const source = r.source === "filing_part_xv" || r.source === "import" || r.source === "web" ? r.source : "manual";
  return {
    id: r.id,
    savedFunderId: r.saved_funder_id,
    fullName: r.full_name,
    title: text(r.title),
    email: text(r.email),
    phone: text(r.phone),
    source,
    sourceUrl: text(r.source_url),
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    version: int(r.version, 1),
  };
}

export async function listContacts(ctx: WorkspaceCtx, savedFunderId: string, deps?: Deps): Promise<Contact[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<ContactRow[]>`
      select id, saved_funder_id, full_name, title, email, phone, source, source_url, created_at, version
      from getfunded.contacts
      where workspace_id = ${ctx.workspaceId}::uuid and saved_funder_id = ${savedFunderId}::uuid
      order by created_at asc
      limit 200`;
    return rows.map(toContact);
  });
}

export type ContactResult = { ok: true; id: string } | { ok: false; code: "invalid" | "forbidden" | "not_found"; message: string };

export async function addContact(ctx: WorkspaceCtx, input: AddContactInput, deps?: Deps): Promise<ContactResult> {
  const parsed = addContactSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Check the contact and try again." };
  const c = parsed.data;
  try {
    return await run(ctx, deps, async (sql) => {
      const owned = await sql<{ id: string }[]>`
        select id from getfunded.saved_funders where id = ${c.savedFunderId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
      if (!owned[0]) return { ok: false, code: "not_found", message: "That funder is not on this workspace's list." };
      const rows = await sql<{ id: string }[]>`
        insert into getfunded.contacts (workspace_id, saved_funder_id, full_name, title, email, phone, source, source_url, created_by)
        values (${ctx.workspaceId}::uuid, ${c.savedFunderId}::uuid, ${c.fullName}, ${c.title || null},
                ${c.email || null}, ${c.phone || null}, ${c.source}, ${c.sourceUrl || null}, ${ctx.userId}::uuid)
        returning id`;
      await sql`
        insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
        values (${ctx.workspaceId}::uuid, ${c.savedFunderId}::uuid, 'system', ${`Contact added: ${c.fullName}`},
                ${ctx.userId}::uuid, ${sql.json({ event: "contact_added", contact_id: rows[0].id })})`;
      return { ok: true, id: rows[0].id };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to add contacts here." };
    throw error;
  }
}

export async function deleteContact(ctx: WorkspaceCtx, input: { id: string }, deps?: Deps): Promise<ContactResult> {
  try {
    return await run(ctx, deps, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        delete from getfunded.contacts where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid returning id`;
      return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, code: "not_found", message: "That contact was already removed." };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to remove contacts here." };
    throw error;
  }
}
