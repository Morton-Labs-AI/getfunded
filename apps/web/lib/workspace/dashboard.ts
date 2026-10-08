import "server-only";

import { rankFocus, type FocusFunder, type FocusItem, type FocusTask } from "./focus";
import { int, iso, run, text, ymd, type Deps } from "./sql";
import { BOARD_STAGES, PIPELINE_STAGES, isStage, stageReach, type ReachRow, type Stage } from "./stages";
import type { WorkspaceCtx } from "./types";

/**
 * Dashboard numbers. Every figure derives from rows the workspace wrote
 * (saved_funders, stage_history, activities, tasks). Nothing is estimated:
 * "planned ask" is a working figure, never revenue, and the copy says so.
 */

/* ------------------------------------------------------------------ focus */

type FocusTaskRow = {
  id: string;
  title: string;
  due_date: unknown;
  status: string;
  saved_funder_id: string | null;
  funder_name: string | null;
  org_id: string | null;
  assignee_name: string | null;
};

type FocusFunderRow = {
  id: string;
  org_id: string;
  name: string | null;
  stage: string;
  next_action: string | null;
  next_action_due: unknown;
  last_touch_at: unknown;
  created_at: unknown;
  owner_name: string | null;
  ask_amount: string | number | null;
};

export async function todaysFocus(ctx: WorkspaceCtx, now: Date, limit = 8, deps?: Deps): Promise<FocusItem[]> {
  return run(ctx, deps, async (sql) => {
    const taskRows = await sql<FocusTaskRow[]>`
      select t.id, t.title, t.due_date, t.status, t.saved_funder_id, f.snapshot->>'name' as funder_name, f.org_id,
             coalesce(nullif(u.display_name, ''), u.email) as assignee_name
      from getfunded.tasks t
      left join getfunded.saved_funders f on f.id = t.saved_funder_id
      left join getfunded.users u on u.id = t.assignee_id
      where t.workspace_id = ${ctx.workspaceId}::uuid and t.status = 'open' and t.due_date <= current_date
      order by t.due_date asc
      limit 200`;
    const funderRows = await sql<FocusFunderRow[]>`
      select f.id, f.org_id, f.snapshot->>'name' as name, f.stage, f.next_action, f.next_action_due, f.created_at, f.ask_amount,
             coalesce(nullif(u.display_name, ''), u.email) as owner_name,
             (select max(a.occurred_at) from getfunded.activities a
               where a.saved_funder_id = f.id and a.kind <> 'system') as last_touch_at
      from getfunded.saved_funders f
      left join getfunded.users u on u.id = f.owner_id
      where f.workspace_id = ${ctx.workspaceId}::uuid and f.archived_at is null
      limit 2000`;

    const tasks: FocusTask[] = taskRows.map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: ymd(r.due_date),
      status: r.status === "done" || r.status === "canceled" ? r.status : "open",
      savedFunderId: r.saved_funder_id,
      funderName: text(r.funder_name),
      orgId: r.org_id,
      assigneeName: r.assignee_name?.trim() || null,
    }));
    const funders: FocusFunder[] = funderRows.map((r) => ({
      id: r.id,
      orgId: r.org_id,
      name: r.name?.trim() || "Unnamed organization",
      stage: isStage(r.stage) ? r.stage : "identified",
      nextAction: text(r.next_action),
      nextActionDue: ymd(r.next_action_due),
      lastTouchAt: iso(r.last_touch_at),
      createdAt: iso(r.created_at) ?? now.toISOString(),
      ownerName: r.owner_name?.trim() || null,
      askAmount: r.ask_amount === null ? null : int(r.ask_amount, 0),
    }));
    return rankFocus({ tasks, funders, now, limit });
  });
}

/* ----------------------------------------------------------------- funnel */

export async function pipelineFunnel(ctx: WorkspaceCtx, deps?: Deps): Promise<ReachRow[]> {
  return run(ctx, deps, async (sql) => {
    const funders = await sql<{ id: string; stage: string }[]>`
      select id, stage from getfunded.saved_funders where workspace_id = ${ctx.workspaceId}::uuid and archived_at is null`;
    const history = await sql<{ saved_funder_id: string; to_stage: string }[]>`
      select h.saved_funder_id, h.to_stage from getfunded.stage_history h
      join getfunded.saved_funders f on f.id = h.saved_funder_id and f.archived_at is null
      where h.workspace_id = ${ctx.workspaceId}::uuid`;
    return stageReach(
      funders.map((f) => ({ id: f.id, stage: isStage(f.stage) ? f.stage : "identified" })),
      history.filter((h) => isStage(h.to_stage)).map((h) => ({ savedFunderId: h.saved_funder_id, toStage: h.to_stage as Stage })),
    );
  });
}

/* --------------------------------------------------------------- momentum */

export type Momentum = {
  advances30: number;
  advancesPrev30: number;
  touches30: number;
  touchesPrev30: number;
  added30: number;
  addedPrev30: number;
};

export async function momentum(ctx: WorkspaceCtx, deps?: Deps): Promise<Momentum> {
  return run(ctx, deps, async (sql) => {
    const order = [...BOARD_STAGES];
    const moves = await sql<{ a30: number | string; aprev: number | string }[]>`
      with ord as (
        select * from unnest(${order}::text[]) with ordinality as t(stage, n)
      ),
      m as (
        select h.created_at, fo.n as from_n, t.n as to_n
        from getfunded.stage_history h
        left join ord fo on fo.stage = h.from_stage
        left join ord t on t.stage = h.to_stage
        where h.workspace_id = ${ctx.workspaceId}::uuid and h.from_stage is not null
      )
      select count(*) filter (where created_at >= now() - interval '30 days' and to_n > from_n)::int as a30,
             count(*) filter (where created_at >= now() - interval '60 days' and created_at < now() - interval '30 days'
                                and to_n > from_n)::int as aprev
      from m`;
    const touches = await sql<{ t30: number | string; tprev: number | string }[]>`
      select count(*) filter (where occurred_at >= now() - interval '30 days')::int as t30,
             count(*) filter (where occurred_at >= now() - interval '60 days' and occurred_at < now() - interval '30 days')::int as tprev
      from getfunded.activities
      where workspace_id = ${ctx.workspaceId}::uuid and kind <> 'system'`;
    const added = await sql<{ n30: number | string; nprev: number | string }[]>`
      select count(*) filter (where created_at >= now() - interval '30 days')::int as n30,
             count(*) filter (where created_at >= now() - interval '60 days' and created_at < now() - interval '30 days')::int as nprev
      from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId}::uuid and archived_at is null`;
    return {
      advances30: int(moves[0]?.a30),
      advancesPrev30: int(moves[0]?.aprev),
      touches30: int(touches[0]?.t30),
      touchesPrev30: int(touches[0]?.tprev),
      added30: int(added[0]?.n30),
      addedPrev30: int(added[0]?.nprev),
    };
  });
}

/* ------------------------------------------------------------------- kpis */

export type Kpis = {
  saved: number;
  tier1: number;
  inConversation: number;
  pipelineAsk: number | null;
  followUpsDue7: number;
  neverContacted: number;
  stale: number;
};

export async function kpis(ctx: WorkspaceCtx, deps?: Deps): Promise<Kpis> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<Record<string, unknown>[]>`
      with lt as (
        select saved_funder_id, max(occurred_at) as last_at
        from getfunded.activities
        where workspace_id = ${ctx.workspaceId}::uuid and kind <> 'system'
        group by saved_funder_id
      )
      select count(*)::int as saved,
             count(*) filter (where f.tier = 1)::int as tier1,
             count(*) filter (where f.stage in ('cultivating', 'loi_submitted', 'proposal_submitted'))::int as in_conversation,
             sum(f.ask_amount) filter (where f.stage = any(${[...PIPELINE_STAGES]}::text[]))::text as pipeline_ask,
             count(*) filter (where f.next_action_due is not null
                                and f.next_action_due between current_date and current_date + 7)::int as follow_ups_due_7,
             count(*) filter (where lt.last_at is null and f.stage not in ('declined', 'parked', 'awarded'))::int as never_contacted,
             count(*) filter (where lt.last_at is not null and lt.last_at < now() - interval '30 days'
                                and f.stage in ('researching', 'qualified', 'cultivating', 'loi_submitted', 'proposal_submitted'))::int as stale
      from getfunded.saved_funders f
      left join lt on lt.saved_funder_id = f.id
      where f.workspace_id = ${ctx.workspaceId}::uuid and f.archived_at is null`;
    const r = rows[0] ?? {};
    const ask = r.pipeline_ask;
    return {
      saved: int(r.saved),
      tier1: int(r.tier1),
      inConversation: int(r.in_conversation),
      pipelineAsk: ask === null || ask === undefined ? null : int(ask, 0),
      followUpsDue7: int(r.follow_ups_due_7),
      neverContacted: int(r.never_contacted),
      stale: int(r.stale),
    };
  });
}

/* -------------------------------------------------------- who carries what */

export type OwnerLoad = {
  userId: string | null;
  name: string;
  funders: number;
  askTotal: number | null;
  openTasks: number;
  overdueTasks: number;
};

export async function ownerLoad(ctx: WorkspaceCtx, deps?: Deps): Promise<OwnerLoad[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<Record<string, unknown>[]>`
      select u.id as user_id,
             coalesce(nullif(u.display_name, ''), u.email, 'Unassigned') as name,
             count(f.id)::int as funders,
             sum(f.ask_amount)::text as ask_total,
             (select count(*)::int from getfunded.tasks t
               where t.workspace_id = ${ctx.workspaceId}::uuid and t.assignee_id is not distinct from u.id and t.status = 'open') as open_tasks,
             (select count(*)::int from getfunded.tasks t
               where t.workspace_id = ${ctx.workspaceId}::uuid and t.assignee_id is not distinct from u.id
                 and t.status = 'open' and t.due_date < current_date) as overdue_tasks
      from getfunded.saved_funders f
      left join getfunded.users u on u.id = f.owner_id
      where f.workspace_id = ${ctx.workspaceId}::uuid and f.archived_at is null and f.stage <> 'declined'
      group by u.id, u.display_name, u.email
      order by count(f.id) desc, name asc
      limit 20`;
    return rows.map((r) => ({
      userId: (r.user_id as string | null) ?? null,
      name: String(r.name ?? "Unassigned"),
      funders: int(r.funders),
      askTotal: r.ask_total === null || r.ask_total === undefined ? null : int(r.ask_total, 0),
      openTasks: int(r.open_tasks),
      overdueTasks: int(r.overdue_tasks),
    }));
  });
}
