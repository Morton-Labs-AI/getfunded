import "server-only";

import { withUser } from "@/lib/db/app";

import type { SavedFunderRow, SavedPage } from "./handlers";

/**
 * The workspace's saved funders for GET /api/v1/saved, read as the member
 * who created the key so Row Level Security applies. Columns are the ones
 * docs/DATA-MODEL.md lists for `saved_funders`; `snapshot` is the funder as
 * it was when saved (name, ein, org_type, city, state, website).
 */
export async function listSavedForApi(
  ctx: { userId: string; workspaceId: string },
  page: { limit: number; offset: number; includeArchived: boolean },
): Promise<SavedPage | null> {
  return withUser(ctx.userId, async (sql) => {
    const member = await sql<{ ok: boolean }[]>`select getfunded.is_member(${ctx.workspaceId}::uuid) as ok`;
    if (member[0]?.ok !== true) return null;

    const archivedFilter = page.includeArchived ? sql`` : sql`and archived_at is null`;
    const rows = await sql<SavedFunderRow[]>`
      select id, org_id, snapshot, stage, tier, owner_id, ask_amount, next_action, next_action_due,
             source_detail, tags, archived_at, created_at, updated_at, version
      from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId}::uuid ${archivedFilter}
      order by created_at desc, id
      limit ${page.limit} offset ${page.offset}`;
    const count = await sql<{ n: number | string }[]>`
      select count(*) as n from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId}::uuid ${archivedFilter}`;
    return { rows, total: Number(count[0]?.n ?? 0) };
  });
}
