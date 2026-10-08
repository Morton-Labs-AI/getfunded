import "server-only";
/**
 * Saved funders as the outreach composer sees them: id, corpus org id and the
 * snapshot the workspace keeps (name, EIN, type, city, state, website). Read
 * straight from `getfunded.saved_funders` under RLS; the snapshot means a
 * corpus re-ingest can never blank a funder's name in the queue.
 */
import { str, withUser, type Ctx } from "./db";
import type { FunderSnapshotLite } from "./types";

export type SavedFunderOption = {
  id: string;
  orgId: string;
  name: string;
  snapshot: FunderSnapshotLite;
  stage: string;
};

function toOption(r: Record<string, unknown>): SavedFunderOption {
  const snapshot = (r.snapshot && typeof r.snapshot === "object" ? r.snapshot : {}) as FunderSnapshotLite;
  return {
    id: String(r.id),
    orgId: String(r.org_id),
    name: (typeof snapshot.name === "string" && snapshot.name.trim()) || "Unnamed funder",
    snapshot,
    stage: str(r.stage) ?? "identified",
  };
}

export async function listSavedFunderOptions(ctx: Ctx): Promise<SavedFunderOption[]> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql`
      select id, org_id, snapshot, stage
      from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId}::uuid and archived_at is null
      order by lower(coalesce(snapshot->>'name', '')) asc
      limit 500`;
    return rows.map((r) => toOption(r as Record<string, unknown>));
  });
}

export async function getSavedFunderOption(ctx: Ctx, savedFunderId: string): Promise<SavedFunderOption | null> {
  return withUser(ctx.userId, async (sql) => {
    const rows = await sql`
      select id, org_id, snapshot, stage
      from getfunded.saved_funders
      where id = ${savedFunderId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
    return rows[0] ? toOption(rows[0] as Record<string, unknown>) : null;
  });
}
