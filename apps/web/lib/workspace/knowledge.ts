import "server-only";

import { z } from "zod";

import { DbError } from "@/lib/db/app";

import { int, iso, run, type Deps, type Sql } from "./sql";
import { KNOWLEDGE_KINDS, type KnowledgeItem, type WorkspaceCtx } from "./types";

/**
 * Knowledge: facts, programs, outcomes and boilerplate about the applicant.
 * The single rule that matters is enforced at the read: ONLY approved rows
 * ever reach a prompt (`listApprovedKnowledge`). Approval is an admin act and
 * is recorded with who and when.
 */

export const createKnowledgeSchema = z.object({
  kind: z.enum(KNOWLEDGE_KINDS),
  title: z.string().trim().min(1, "Give it a short title.").max(200),
  body: z.string().trim().min(1, "Write the fact itself.").max(8000),
});
export type CreateKnowledgeInput = z.infer<typeof createKnowledgeSchema>;

type KnowledgeRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  approved: boolean;
  approved_by: string | null;
  approved_by_name: string | null;
  approved_at: unknown;
  created_by: string | null;
  created_by_name: string | null;
  created_at: unknown;
  updated_at: unknown;
  version: number | string;
};

function toItem(r: KnowledgeRow): KnowledgeItem {
  const createdAt = iso(r.created_at) ?? new Date(0).toISOString();
  return {
    id: r.id,
    kind: (KNOWLEDGE_KINDS as readonly string[]).includes(r.kind) ? (r.kind as KnowledgeItem["kind"]) : "fact",
    title: r.title,
    body: r.body,
    approved: Boolean(r.approved),
    approvedBy: r.approved_by,
    approvedByName: r.approved_by_name?.trim() || null,
    approvedAt: iso(r.approved_at),
    createdBy: r.created_by,
    createdByName: r.created_by_name?.trim() || null,
    createdAt,
    updatedAt: iso(r.updated_at) ?? createdAt,
    version: int(r.version, 1),
  };
}

function selectKnowledge(sql: Sql) {
  return sql`
    select k.id, k.kind, k.title, k.body, k.approved, k.approved_by,
           coalesce(nullif(a.display_name, ''), a.email) as approved_by_name, k.approved_at,
           k.created_by, coalesce(nullif(c.display_name, ''), c.email) as created_by_name,
           k.created_at, k.updated_at, k.version
    from getfunded.knowledge k
    left join getfunded.users a on a.id = k.approved_by
    left join getfunded.users c on c.id = k.created_by`;
}

export async function listKnowledge(ctx: WorkspaceCtx, deps?: Deps): Promise<KnowledgeItem[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<KnowledgeRow[]>`
      ${selectKnowledge(sql)}
      where k.workspace_id = ${ctx.workspaceId}::uuid
      order by k.approved desc, k.kind, lower(k.title)
      limit 500`;
    return rows.map(toItem);
  });
}

/** THE prompt-side read. Anything a model sees about the applicant comes from here. */
export async function listApprovedKnowledge(ctx: WorkspaceCtx, deps?: Deps): Promise<KnowledgeItem[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<KnowledgeRow[]>`
      ${selectKnowledge(sql)}
      where k.workspace_id = ${ctx.workspaceId}::uuid and k.approved = true
      order by k.kind, lower(k.title)
      limit 200`;
    return rows.map(toItem);
  });
}

export type KnowledgeResult =
  | { ok: true; id: string }
  | { ok: false; code: "invalid" | "forbidden" | "not_found" | "stale"; message: string };

export async function createKnowledge(ctx: WorkspaceCtx, input: CreateKnowledgeInput, deps?: Deps): Promise<KnowledgeResult> {
  const parsed = createKnowledgeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Check the entry and try again." };
  const k = parsed.data;
  try {
    return await run(ctx, deps, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        insert into getfunded.knowledge (workspace_id, kind, title, body, approved, created_by)
        values (${ctx.workspaceId}::uuid, ${k.kind}, ${k.title}, ${k.body}, false, ${ctx.userId}::uuid)
        returning id`;
      return { ok: true, id: rows[0].id };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to add knowledge here." };
    throw error;
  }
}

/**
 * Approve or un-approve. The caller (the server action) has already checked
 * the member's role is owner or admin; this records who did it.
 */
export async function setKnowledgeApproved(
  ctx: WorkspaceCtx,
  input: { id: string; version: number; approved: boolean },
  deps?: Deps,
): Promise<KnowledgeResult> {
  try {
    return await run(ctx, deps, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        update getfunded.knowledge
        set approved = ${input.approved},
            approved_by = ${input.approved ? sql`${ctx.userId}::uuid` : sql`null`},
            approved_at = ${input.approved ? sql`now()` : sql`null`}
        where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid and version = ${input.version}
        returning id`;
      if (rows[0]) return { ok: true, id: rows[0].id };
      const exists = await sql<{ id: string }[]>`
        select id from getfunded.knowledge where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
      return exists[0]
        ? { ok: false, code: "stale", message: "This item was changed somewhere else. The page will reload." }
        : { ok: false, code: "not_found", message: "That item no longer exists." };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "Only a workspace admin can approve knowledge." };
    throw error;
  }
}

export async function deleteKnowledge(ctx: WorkspaceCtx, input: { id: string }, deps?: Deps): Promise<KnowledgeResult> {
  try {
    return await run(ctx, deps, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        delete from getfunded.knowledge where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid returning id`;
      return rows[0] ? { ok: true, id: rows[0].id } : { ok: false, code: "not_found", message: "That item was already removed." };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "Only a workspace admin can remove knowledge." };
    throw error;
  }
}
