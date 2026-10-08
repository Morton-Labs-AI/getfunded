import "server-only";

import { z } from "zod";

import { DbError } from "@/lib/db/app";

import { int, iso, run, text, ymd, type Deps, type Sql } from "./sql";
import type { Task, TaskView, WorkspaceCtx } from "./types";

/**
 * Tasks: what a person owes a funder. Completing a task that is linked to a
 * funder writes a system activity on that funder's timeline, so "Task done:
 * …" shows up next to the notes and calls it belongs with.
 */

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Give the task a title.").max(200),
  details: z.string().trim().max(5000).nullable().optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  savedFunderId: z.uuid().nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

type TaskRow = {
  id: string;
  workspace_id: string;
  saved_funder_id: string | null;
  funder_name: string | null;
  org_id: string | null;
  title: string;
  details: string | null;
  due_date: unknown;
  assignee_id: string | null;
  assignee_name: string | null;
  status: string;
  completed_at: unknown;
  created_by: string | null;
  created_at: unknown;
  version: number | string;
};

function toTask(r: TaskRow): Task {
  const status = r.status === "done" || r.status === "canceled" ? r.status : "open";
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    savedFunderId: r.saved_funder_id,
    funderName: text(r.funder_name),
    orgId: r.org_id,
    title: r.title,
    details: text(r.details),
    dueDate: ymd(r.due_date),
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_name?.trim() || null,
    status,
    completedAt: iso(r.completed_at),
    createdBy: r.created_by,
    createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    version: int(r.version, 1),
  };
}

function selectTasks(sql: Sql) {
  return sql`
    select t.id, t.workspace_id, t.saved_funder_id, f.snapshot->>'name' as funder_name, f.org_id,
           t.title, t.details, t.due_date, t.assignee_id,
           coalesce(nullif(u.display_name, ''), u.email) as assignee_name,
           t.status, t.completed_at, t.created_by, t.created_at, t.version
    from getfunded.tasks t
    left join getfunded.saved_funders f on f.id = t.saved_funder_id
    left join getfunded.users u on u.id = t.assignee_id`;
}

export async function listTasks(ctx: WorkspaceCtx, view: TaskView = "open", deps?: Deps): Promise<Task[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<TaskRow[]>`
      ${selectTasks(sql)}
      where t.workspace_id = ${ctx.workspaceId}::uuid
        ${
          view === "done"
            ? sql`and t.status = 'done'`
            : view === "mine"
              ? sql`and t.status = 'open' and t.assignee_id = ${ctx.userId}::uuid`
              : view === "today"
                ? sql`and t.status = 'open' and t.due_date <= current_date`
                : view === "overdue"
                  ? sql`and t.status = 'open' and t.due_date < current_date`
                  : sql`and t.status = 'open'`
        }
      order by ${view === "done" ? sql`t.completed_at desc nulls last` : sql`t.due_date asc nulls last, t.created_at asc`}
      limit 500`;
    return rows.map(toTask);
  });
}

export async function listTasksForFunder(ctx: WorkspaceCtx, savedFunderId: string, deps?: Deps): Promise<Task[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<TaskRow[]>`
      ${selectTasks(sql)}
      where t.workspace_id = ${ctx.workspaceId}::uuid and t.saved_funder_id = ${savedFunderId}::uuid
      order by (t.status = 'open') desc, t.due_date asc nulls last, t.created_at desc
      limit 100`;
    return rows.map(toTask);
  });
}

export type TaskResult = { ok: true; id: string } | { ok: false; code: "invalid" | "forbidden" | "not_found" | "stale"; message: string };

export async function createTask(ctx: WorkspaceCtx, input: CreateTaskInput, deps?: Deps): Promise<TaskResult> {
  const parsed = createTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", message: parsed.error.issues[0]?.message ?? "Check the task and try again." };
  const t = parsed.data;
  try {
    return await run(ctx, deps, async (sql) => {
      if (t.savedFunderId) {
        const owned = await sql<{ id: string }[]>`
          select id from getfunded.saved_funders where id = ${t.savedFunderId}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
        if (!owned[0]) return { ok: false, code: "not_found", message: "That funder is not on this workspace's list." };
      }
      if (t.assigneeId) {
        const member = await sql<{ ok: boolean }[]>`
          select exists(select 1 from getfunded.members where workspace_id = ${ctx.workspaceId}::uuid and user_id = ${t.assigneeId}::uuid) as ok`;
        if (!member[0]?.ok) return { ok: false, code: "invalid", message: "Pick an assignee from this workspace." };
      }
      const rows = await sql<{ id: string }[]>`
        insert into getfunded.tasks (workspace_id, saved_funder_id, title, details, due_date, assignee_id, created_by)
        values (${ctx.workspaceId}::uuid, ${t.savedFunderId ?? null}, ${t.title}, ${t.details || null},
                ${t.dueDate ?? null}, ${t.assigneeId ?? ctx.userId}::uuid, ${ctx.userId}::uuid)
        returning id`;
      return { ok: true, id: rows[0].id };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to add tasks here." };
    throw error;
  }
}

export async function setTaskStatus(
  ctx: WorkspaceCtx,
  input: { id: string; version: number; status: "open" | "done" | "canceled" },
  deps?: Deps,
): Promise<TaskResult> {
  try {
    return await run(ctx, deps, async (sql) => {
      const rows = await sql<{ id: string; title: string; saved_funder_id: string | null }[]>`
        update getfunded.tasks
        set status = ${input.status},
            completed_at = ${input.status === "done" ? sql`now()` : sql`null`}
        where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid and version = ${input.version}
        returning id, title, saved_funder_id`;
      const row = rows[0];
      if (!row) {
        const exists = await sql<{ id: string }[]>`
          select id from getfunded.tasks where id = ${input.id}::uuid and workspace_id = ${ctx.workspaceId}::uuid`;
        return exists[0]
          ? { ok: false, code: "stale", message: "This task was changed somewhere else. The page will reload." }
          : { ok: false, code: "not_found", message: "That task no longer exists." };
      }
      if (row.saved_funder_id && input.status === "done") {
        await sql`
          insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
          values (${ctx.workspaceId}::uuid, ${row.saved_funder_id}::uuid, 'system', ${`Task done: ${row.title}`},
                  ${ctx.userId}::uuid, ${sql.json({ event: "task_done", task_id: row.id })})`;
      }
      return { ok: true, id: row.id };
    });
  } catch (error) {
    if (DbError.is(error, "forbidden")) return { ok: false, code: "forbidden", message: "You do not have permission to change tasks here." };
    throw error;
  }
}

export type TaskCounts = { open: number; overdue: number; dueToday: number; mine: number };

export async function taskCounts(ctx: WorkspaceCtx, deps?: Deps): Promise<TaskCounts> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ open: number; overdue: number; due_today: number; mine: number }[]>`
      select count(*) filter (where status = 'open')::int as open,
             count(*) filter (where status = 'open' and due_date < current_date)::int as overdue,
             count(*) filter (where status = 'open' and due_date = current_date)::int as due_today,
             count(*) filter (where status = 'open' and assignee_id = ${ctx.userId}::uuid)::int as mine
      from getfunded.tasks where workspace_id = ${ctx.workspaceId}::uuid`;
    const r = rows[0];
    return { open: int(r?.open), overdue: int(r?.overdue), dueToday: int(r?.due_today), mine: int(r?.mine) };
  });
}
