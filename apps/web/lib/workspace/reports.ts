import "server-only";

import { int, run, type Deps } from "./sql";
import { STAGES, isStage, type Stage } from "./stages";
import { ACTIVITY_KINDS, type ActivityKind, type WorkspaceCtx } from "./types";

/**
 * Report tables: pipeline by stage with asks, activity counts, and the
 * biggest planned asks. The funnel comes from lib/workspace/dashboard.ts
 * (`pipelineFunnel`), which already applies the furthest-stage rule.
 */

export type StageValue = { stage: Stage; funders: number; askTotal: number | null; askCount: number };

export async function pipelineByStage(ctx: WorkspaceCtx, deps?: Deps): Promise<StageValue[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ stage: string; n: number | string; ask_total: string | null; ask_count: number | string }[]>`
      select stage, count(*)::int as n, sum(ask_amount)::text as ask_total, count(ask_amount)::int as ask_count
      from getfunded.saved_funders
      where workspace_id = ${ctx.workspaceId}::uuid and archived_at is null
      group by stage`;
    const by = new Map(rows.filter((r) => isStage(r.stage)).map((r) => [r.stage as Stage, r]));
    return STAGES.map((stage) => {
      const r = by.get(stage);
      return {
        stage,
        funders: int(r?.n),
        askTotal: r?.ask_total === null || r?.ask_total === undefined ? null : int(r.ask_total, 0),
        askCount: int(r?.ask_count),
      };
    });
  });
}

export type ActivityCount = { kind: ActivityKind; last30: number; last90: number; allTime: number };

export async function activityCounts(ctx: WorkspaceCtx, deps?: Deps): Promise<ActivityCount[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ kind: string; last30: number | string; last90: number | string; all_time: number | string }[]>`
      select kind,
             count(*) filter (where occurred_at >= now() - interval '30 days')::int as last30,
             count(*) filter (where occurred_at >= now() - interval '90 days')::int as last90,
             count(*)::int as all_time
      from getfunded.activities
      where workspace_id = ${ctx.workspaceId}::uuid
      group by kind`;
    const by = new Map(rows.map((r) => [r.kind, r]));
    return ACTIVITY_KINDS.map((kind) => {
      const r = by.get(kind);
      return { kind, last30: int(r?.last30), last90: int(r?.last90), allTime: int(r?.all_time) };
    });
  });
}

export type AskRow = { savedFunderId: string; orgId: string; name: string; stage: Stage; askAmount: number; ownerName: string | null };

export async function topAsks(ctx: WorkspaceCtx, limit = 15, deps?: Deps): Promise<AskRow[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<Record<string, unknown>[]>`
      select f.id, f.org_id, f.snapshot->>'name' as name, f.stage, f.ask_amount::text as ask_amount,
             coalesce(nullif(u.display_name, ''), u.email) as owner_name
      from getfunded.saved_funders f
      left join getfunded.users u on u.id = f.owner_id
      where f.workspace_id = ${ctx.workspaceId}::uuid and f.archived_at is null and f.ask_amount is not null
      order by f.ask_amount desc, lower(f.snapshot->>'name')
      limit ${Math.min(Math.max(limit, 1), 100)}`;
    return rows.map((r) => ({
      savedFunderId: String(r.id),
      orgId: String(r.org_id),
      name: typeof r.name === "string" && r.name.length > 0 ? r.name : "Unnamed organization",
      stage: isStage(r.stage) ? r.stage : "identified",
      askAmount: int(r.ask_amount, 0),
      ownerName: typeof r.owner_name === "string" && r.owner_name.trim().length > 0 ? r.owner_name : null,
    }));
  });
}

export type Velocity = { fromStage: Stage; toStage: Stage; moves: number; medianDays: number | null };

/** Median days spent in the previous stage before each kind of move. */
export async function stageVelocity(ctx: WorkspaceCtx, deps?: Deps): Promise<Velocity[]> {
  return run(ctx, deps, async (sql) => {
    const rows = await sql<{ from_stage: string; to_stage: string; n: number | string; median_days: string | number | null }[]>`
      with h as (
        select saved_funder_id, from_stage, to_stage, created_at,
               lag(created_at) over (partition by saved_funder_id order by created_at, id) as prev_at
        from getfunded.stage_history
        where workspace_id = ${ctx.workspaceId}::uuid
      )
      select from_stage, to_stage, count(*)::int as n,
             percentile_cont(0.5) within group (order by extract(epoch from (created_at - prev_at)) / 86400)::numeric(10,1) as median_days
      from h
      where from_stage is not null and prev_at is not null
      group by from_stage, to_stage
      order by n desc
      limit 30`;
    return rows
      .filter((r) => isStage(r.from_stage) && isStage(r.to_stage))
      .map((r) => ({
        fromStage: r.from_stage as Stage,
        toStage: r.to_stage as Stage,
        moves: int(r.n),
        medianDays: r.median_days === null ? null : Math.round(Number(r.median_days)),
      }));
  });
}
