import "server-only";
/**
 * Workspace templates, stored as `getfunded.knowledge` rows of kind
 * 'boilerplate'. The body column holds `Subject: ...` on its first line,
 * a blank line, then the message text, so the row reads naturally in any
 * other surface that lists knowledge. Templates use the same merge fields
 * as the built-ins (lib/outreach/templates.ts).
 */
import { iso, num, str, withUser, type Ctx } from "./db";
import type { Template } from "./templates";

export type WorkspaceTemplate = Template & {
  id: string;
  version: number;
  approved: boolean;
  createdBy: string | null;
  updatedAt: string;
};

export function serializeTemplate(subject: string, body: string): string {
  return `Subject: ${subject.replace(/[\r\n]+/g, " ").trim()}\n\n${body.trim()}`;
}

export function parseTemplateBody(raw: string): { subject: string; body: string } {
  const m = raw.match(/^Subject:\s*(.*)\r?\n\r?\n([\s\S]*)$/);
  if (m) return { subject: m[1].trim(), body: m[2] };
  return { subject: "", body: raw };
}

function toTemplate(r: Record<string, unknown>): WorkspaceTemplate {
  const { subject, body } = parseTemplateBody(String(r.body ?? ""));
  return {
    id: String(r.id),
    key: `ws:${String(r.id)}`,
    name: String(r.title ?? "Untitled template"),
    when: "A template saved by your workspace.",
    subject,
    body,
    builtIn: false,
    version: num(r.version, 1),
    approved: Boolean(r.approved),
    createdBy: str(r.created_by),
    updatedAt: iso(r.updated_at) ?? "",
  };
}

const COLUMNS = `id, title, body, approved, created_by, updated_at, version`;

export async function listWorkspaceTemplates(ctx: Ctx): Promise<WorkspaceTemplate[]> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `select ${COLUMNS} from getfunded.knowledge
       where workspace_id = $1 and kind = 'boilerplate'
       order by lower(title) asc limit 200`,
      [ctx.workspaceId],
    );
    return rows.map((r) => toTemplate(r as Record<string, unknown>));
  });
}

export async function getWorkspaceTemplate(ctx: Ctx, id: string): Promise<WorkspaceTemplate | null> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql.unsafe(
      `select ${COLUMNS} from getfunded.knowledge where id = $1 and workspace_id = $2 and kind = 'boilerplate'`,
      [id, ctx.workspaceId],
    );
    return rows[0] ? toTemplate(rows[0] as Record<string, unknown>) : null;
  });
}

export type SaveTemplateResult = { ok: true; template: WorkspaceTemplate } | { ok: false; error: string };

export async function saveWorkspaceTemplate(
  ctx: Ctx,
  input: { id?: string; version?: number; name: string; subject: string; body: string },
): Promise<SaveTemplateResult> {
  const body = serializeTemplate(input.subject, input.body);
  return withUser(ctx.userId, async (sql) => {
    if (input.id) {
      const rows = await sql.unsafe(
        `update getfunded.knowledge set title = $3, body = $4
         where id = $1 and workspace_id = $2 and kind = 'boilerplate' and version = $5
         returning ${COLUMNS}`,
        [input.id, ctx.workspaceId, input.name, body, input.version ?? 0],
      );
      if (!rows[0]) return { ok: false, error: "This template was changed somewhere else. Reload the page and try again." };
      return { ok: true, template: toTemplate(rows[0] as Record<string, unknown>) };
    }
    const rows = await sql.unsafe(
      `insert into getfunded.knowledge (workspace_id, kind, title, body, approved, created_by)
       values ($1, 'boilerplate', $2, $3, false, $4)
       returning ${COLUMNS}`,
      [ctx.workspaceId, input.name, body, ctx.userId],
    );
    return { ok: true, template: toTemplate(rows[0] as Record<string, unknown>) };
  });
}

/** Admins only (the knowledge delete policy); a member gets a DbError('forbidden'). */
export async function deleteWorkspaceTemplate(ctx: Ctx, id: string): Promise<void> {
  await withUser(ctx.userId, async (sql) => {
    await sql`
      delete from getfunded.knowledge
      where id = ${id}::uuid and workspace_id = ${ctx.workspaceId}::uuid and kind = 'boilerplate'`;
  });
}
