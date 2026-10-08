import "server-only";

import { z } from "zod";

import { DbError } from "@/lib/db/app";

import { int, iso, obj, run, text, type Deps, type Sql } from "./sql";
import { isStage } from "./stages";
import { ACTIVITY_KINDS, HUMAN_ACTIVITY_KINDS, type Activity, type StageHistoryRow, type WorkspaceCtx } from "./types";

/**
 * The timeline: notes, calls, emails, meetings, letters and events a person
 * logs, plus the system rows the app writes (saves, stage moves, task
 * completions, imports). Append-only in the database; nothing here updates
 * or deletes.
 */

export const logActivitySchema = z.object({
  savedFunderId: z.uuid(),
  kind: z.enum(HUMAN_ACTIVITY_KINDS),
  body: z.string().trim().min(1, "Write a line about what happened.").max(5000),
  /** YYYY-MM-DD; defaults to today. */
  occurredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type LogActivityInput = z.infer<typeof logActivitySchema>;

type ActivityRow = {
  id: string;
  saved_funder_id: string | null;
  funder_name: string | null;
  kind: string;
  body: string;
  occurred_at: unknown;
  created_by: string | null;
  created_by_name: string | null;
  meta: unknown;
};

function toActivity(r: ActivityRow): Activity {
  return {
    id: r.id,
    savedFunderId: r.saved_funder_id,
    funderName: text(r.funder_name),
    kind: (ACTIVITY_KINDS as readonly string[]).includes(r.kind) ? (r.kind as Activity["kind"]) : "system",
    body: r.body ?? "",
    occurredAt: iso(r.occurred_at) ?? new Date(0).toISOString(),
    createdBy: r.created_by,
    createdByName: r.created_by_name?.trim() || null,
    meta: obj(r.meta),
  };
}

function selectActivities(sql: Sql) {
  return sql`
    select a.id, a.saved_funder_id, f.snapshot->>'name' as funder_name, a.kind, a.body, a.occurred_at,
           a.created_by, coalesce(nullif(u.display_name, ''), u.email) as created_by_name, a.meta
    from getfunded.activities a
    left join getfunded.saved_funders f on f.id = a.saved_funder_id
    left join getfunded.users u on u.id = a.created_by`;
}

export async function listActivities(ctx: WorkspaceCtx, savedFunderId: string, deps?: Deps): Promise<Activity[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<ActivityRow[]>`
      ${selectActivities(sql)}
      where a.workspace_id = ${ctx.workspaceId}::uuid and a.saved_funder_id = ${savedFunderId}::uuid
      order by a.occurred_at desc, a.created_at desc
      limit 200`;
    return rows.map(toActivity);
  });
}

export async function recentActivities(ctx: WorkspaceCtx, limit = 12, deps?: Deps): Promise<Activity[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<ActivityRow[]>`
      ${selectActivities(sql)}
      where a.workspace_id = ${ctx.workspaceId}::uuid
      order by a.occurred_at desc, a.created_at desc
      limit ${Math.min(Math.max(limit, 1), 100)}`;
    return rows.map(toActivity);
  });
}

export type LogResult = { ok: true; id: string } | { ok: false; code: "invalid" | "forbidden" | "not_found"; message: string };

export async function logActivity(ctx: WorkspaceCtx, input: LogActivityInput, deps?: Deps): Promise<LogResult> {
  const parsed = logActivitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Check the entry and try again." };
  const a = parsed.data;
  try {
    return await run(ctx, deps, async (sql) => {
      const owned = await sql<{ id: string }[]>`
        select id from getfunded.saved_funders where id = ${a.savedFunderId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
      if (!owned[0]) return { ok: false, code: "not_found", message: "That funder is not on this workspace's list." };
      const rows = await sql<{ id: string }[]>`
        insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, occurred_at, created_by)
        values (${ctx.workspaceId}::uuid, ${a.savedFunderId}::uuid, ${a.kind}, ${a.body},
                ${a.occurredOn ? sql`${a.occurredOn}::date + (now() - date_trunc('day', now()))` : sql`now()`},
                ${ctx.userId}::uuid)
        returning id`;
      return { ok: true, id: rows[0].id };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to log activity here." };
    throw error;
  }
}

type HistoryRow = {
  id: number | string;
  from_stage: string | null;
  to_stage: string;
  changed_by: string | null;
  changed_by_name: string | null;
  note: string | null;
  created_at: unknown;
};

export async function listStageHistory(ctx: WorkspaceCtx, savedFunderId: string, deps?: Deps): Promise<StageHistoryRow[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<HistoryRow[]>`
      select h.id, h.from_stage, h.to_stage, h.changed_by,
             coalesce(nullif(u.display_name, ''), u.email) as changed_by_name, h.note, h.created_at
      from getfunded.stage_history h
      left join getfunded.users u on u.id = h.changed_by
      where h.workspace_id = ${ctx.workspaceId}::uuid and h.saved_funder_id = ${savedFunderId}::uuid
      order by h.created_at desc, h.id desc
      limit 200`;
    return rows.map((r) => ({
      id: int(r.id),
      fromStage: isStage(r.from_stage) ? r.from_stage : null,
      toStage: isStage(r.to_stage) ? r.to_stage : "identified",
      changedBy: r.changed_by,
      changedByName: r.changed_by_name?.trim() || null,
      note: text(r.note),
      createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    }));
  });
}
