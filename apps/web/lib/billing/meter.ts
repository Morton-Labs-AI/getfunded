import "server-only";
/**
 * `meter()` is the cost-control boundary described in docs/ARCHITECTURE.md.
 * Every model call in the app goes through it:
 *
 *   1. kill switches: `AI_ENABLED=false` (env) and the `ai_enabled` flag row
 *   2. plan limits: `planFor(workspace, plan_overrides)`; SELF_HOSTED = unlimited (recorded, never refused)
 *   3. `getfunded.reserve_credits(...)` inside `withUser()` writes a `reserved` ledger row
 *      or raises `quota_exceeded`, which becomes a `QuotaExceededError`
 *   4. the model call runs with the single `AiClient`
 *   5. the row is settled with real tokens, model and latency, or refunded when the call threw
 *
 * Feature code never touches the ledger or the SDK directly.
 */
import { z } from "zod";
import { aiMode, getAiClient } from "@/lib/ai/client";
import {
  AiDisabledError,
  type AiClient,
  type Usage,
  usageFromError,
} from "@/lib/ai/types";
import {
  CREDIT_COSTS,
  FEATURES,
  planFor,
  type Feature,
  type PlanId,
  type PlanOverride,
  type ResolvedPlan,
} from "@/lib/plans";
import { type Db, withUser } from "./db";
import { toInt } from "./pg";
import { QuotaExceededError, periodEnd, periodStart, quotaDetailFrom, type QuotaScope } from "./quota";

export { AiDisabledError, QuotaExceededError };
/** Re-exported so nothing outside this module needs to import lib/ai/client. */
export { aiMode };

const MeterContextSchema = z.object({
  userId: z.uuid(),
  workspaceId: z.uuid(),
  feature: z.enum(FEATURES),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type MeterContext = z.infer<typeof MeterContextSchema>;

export type MeterRun<T> = (
  ai: AiClient,
  reservation: { ledgerId: string; plan: ResolvedPlan; credits: number },
) => Promise<{ result: T; usage: Usage }>;

type Env = Record<string, string | undefined>;
type WithUser = <T>(userId: string | null, fn: (sql: Db) => Promise<T>) => Promise<T>;

export type MeterDeps = {
  ai?: AiClient;
  env?: Env;
  now?: () => Date;
  withUser?: WithUser;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

/** The workspace is missing, deleted, or the user is not a member (RLS hides it). */
export class WorkspaceAccessError extends Error {
  readonly code = "workspace_not_found" as const;
  readonly status = 404;
  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} was not found or you are not a member.`);
    this.name = "WorkspaceAccessError";
  }
}

type WorkspaceRow = {
  plan: string | null;
  settings: Record<string, unknown> | null;
  billing_anchor_day: number | string | null;
};

export type Limits = { monthly: number | null; daily: number | null };

export type WorkspacePlan = { plan: ResolvedPlan; workspace: WorkspaceRow; limits: Limits };

/** The `ai_enabled` flag value is off when it is false or `{ enabled: false }`. */
export function flagDisabled(value: unknown): boolean {
  if (value === false || value === "false" || value === 0) return true;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return v.enabled === false || v.value === false || v.on === false;
  }
  return false;
}

async function assertAiFlag(sql: Db): Promise<void> {
  const rows = await sql`select value from getfunded.flags where key = 'ai_enabled'`;
  if (rows.length > 0 && flagDisabled(rows[0].value)) {
    throw new AiDisabledError("AI features are paused by the steward. Please try again later.");
  }
}

/** Effective limits: plan limits, steward overrides, and the optional daily-cap opt-out for Team+. */
export function limitsFor(plan: ResolvedPlan, settings: Record<string, unknown> | null | undefined): Limits {
  const monthly = plan.monthly_credits;
  let daily = plan.daily_credits;
  if (plan.can_disable_daily_cap && settings && settings.daily_cap_enabled === false) daily = null;
  return { monthly, daily };
}

export async function loadWorkspacePlan(sql: Db, workspaceId: string, env: Env): Promise<WorkspacePlan> {
  const ws = await sql`
    select plan, settings, billing_anchor_day
    from getfunded.workspaces
    where id = ${workspaceId} and deleted_at is null`;
  if (ws.length === 0) throw new WorkspaceAccessError(workspaceId);
  const workspace = ws[0] as WorkspaceRow;
  const overrides = await sql`
    select monthly_credits, members
    from getfunded.plan_overrides
    where workspace_id = ${workspaceId}`;
  const override: PlanOverride = overrides.length > 0
    ? {
        monthly_credits: overrides[0].monthly_credits === null ? null : toInt(overrides[0].monthly_credits),
        members: overrides[0].members === null ? null : toInt(overrides[0].members),
      }
    : null;
  const plan = planFor(workspace, override, env);
  return { plan, workspace, limits: limitsFor(plan, workspace.settings) };
}

function quotaErrorFrom(err: unknown, feature: Feature, limits: Limits): QuotaExceededError | null {
  const detail = quotaDetailFrom(err);
  if (!detail) return null;
  let scope: QuotaScope = detail.scope ?? "monthly";
  if (!detail.scope && limits.daily !== null && detail.limit === limits.daily && detail.limit !== limits.monthly) {
    scope = "daily";
  }
  const periodEndDate = detail.period_end ? new Date(detail.period_end) : null;
  return new QuotaExceededError({
    used: detail.used,
    limit: detail.limit || (scope === "daily" ? limits.daily : limits.monthly) || 0,
    periodEnd: periodEndDate && !Number.isNaN(periodEndDate.getTime()) ? periodEndDate : null,
    feature,
    scope,
  });
}

type SettleInput = {
  status: "settled" | "refunded";
  usage: Usage | null;
  latencyMs: number;
  extraMeta: Record<string, unknown>;
};

async function settle(wu: WithUser, userId: string, ledgerId: string, input: SettleInput, log: MeterDeps["log"]) {
  try {
    await wu(userId, async (sql) => {
      await sql`
        update getfunded.usage_ledger
        set status = ${input.status},
            model = ${input.usage?.model ?? null},
            input_tokens = ${input.usage?.inputTokens ?? null},
            output_tokens = ${input.usage?.outputTokens ?? null},
            latency_ms = ${input.latencyMs},
            settled_at = now(),
            meta = coalesce(meta, '{}'::jsonb) || ${sql.json(input.extraMeta as never)}::jsonb
        where id = ${ledgerId} and status = 'reserved'`;
    });
  } catch (err) {
    // A failed settle leaves the row 'reserved', which still counts against the
    // quota: the safe direction. Log it; never lose the result over bookkeeping.
    (log ?? defaultLog)("usage_ledger settle failed", {
      ledgerId,
      status: input.status,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function defaultLog(message: string, extra?: Record<string, unknown>) {
  console.error(`[meter] ${message}`, extra ?? {});
}

/**
 * Run one metered model call. Throws `AiDisabledError`, `QuotaExceededError`,
 * `WorkspaceAccessError`, or whatever `run` threw (after refunding the credits).
 */
export async function meter<T>(ctxIn: MeterContext, run: MeterRun<T>, deps: MeterDeps = {}): Promise<T> {
  const ctx = MeterContextSchema.parse(ctxIn);
  const env = deps.env ?? process.env;
  const wu: WithUser = deps.withUser ?? withUser;
  if (aiMode(env) === "disabled") {
    throw new AiDisabledError("AI is turned off for this deployment (AI_ENABLED=false).");
  }
  const credits = CREDIT_COSTS[ctx.feature];

  const reservation = await wu(ctx.userId, async (sql) => {
    await assertAiFlag(sql);
    const { plan, limits } = await loadWorkspacePlan(sql, ctx.workspaceId, env);
    let rows: { id: unknown }[];
    try {
      rows = await sql`
        select getfunded.reserve_credits(
          ${ctx.workspaceId}, ${ctx.feature}, ${credits}, ${limits.monthly}, ${limits.daily}
        ) as id`;
    } catch (err) {
      throw quotaErrorFrom(err, ctx.feature, limits) ?? err;
    }
    const ledgerId = String(rows[0]?.id ?? "");
    if (!ledgerId) throw new Error("reserve_credits returned no ledger id");
    if (ctx.meta && Object.keys(ctx.meta).length > 0) {
      await sql`update getfunded.usage_ledger set meta = ${sql.json(ctx.meta as never)} where id = ${ledgerId}`;
    }
    return { ledgerId, plan, credits };
  });

  const ai = deps.ai ?? getAiClient(env);
  const started = Date.now();
  try {
    const { result, usage } = await run(ai, reservation);
    const extraMeta: Record<string, unknown> = ai.mode === "mock" ? { mock: true } : {};
    await settle(wu, ctx.userId, reservation.ledgerId, { status: "settled", usage, latencyMs: Date.now() - started, extraMeta }, deps.log);
    return result;
  } catch (err) {
    const usage = usageFromError(err);
    const extraMeta: Record<string, unknown> = {
      error: err instanceof Error ? `${err.name}: ${err.message}`.slice(0, 500) : String(err).slice(0, 500),
    };
    if (ai.mode === "mock") extraMeta.mock = true;
    await settle(wu, ctx.userId, reservation.ledgerId, { status: "refunded", usage, latencyMs: Date.now() - started, extraMeta }, deps.log);
    throw err;
  }
}

export type UsageSummary = {
  plan: PlanId;
  planName: string;
  basePlan: PlanId;
  overridden: boolean;
  unlimited: boolean;
  monthlyLimit: number | null;
  dailyLimit: number | null;
  used: number;
  usedToday: number;
  remaining: number | null;
  remainingToday: number | null;
  periodStart: Date;
  periodEnd: Date;
  creditCosts: Record<Feature, number>;
};

/**
 * Numbers for the usage meter in settings. Reads `getfunded.v_usage_period`
 * for the counts and computes the period from the workspace's anchor day.
 */
export async function getUsage(workspaceId: string, userId: string, deps: MeterDeps = {}): Promise<UsageSummary> {
  const ids = z.object({ workspaceId: z.uuid(), userId: z.uuid() }).parse({ workspaceId, userId });
  const env = deps.env ?? process.env;
  const wu: WithUser = deps.withUser ?? withUser;
  const now = deps.now?.() ?? new Date();
  return wu(ids.userId, async (sql) => {
    const { plan, workspace, limits } = await loadWorkspacePlan(sql, ids.workspaceId, env);
    const rows = await sql`
      select credits_used, credits_today
      from getfunded.v_usage_period
      where workspace_id = ${ids.workspaceId}`;
    const used = toInt(rows[0]?.credits_used, 0);
    const usedToday = toInt(rows[0]?.credits_today, 0);
    const anchor = toInt(workspace.billing_anchor_day, 1) || 1;
    return {
      plan: plan.id,
      planName: plan.name,
      basePlan: plan.base_plan,
      overridden: plan.overridden,
      unlimited: limits.monthly === null,
      monthlyLimit: limits.monthly,
      dailyLimit: limits.daily,
      used,
      usedToday,
      remaining: limits.monthly === null ? null : Math.max(0, limits.monthly - used),
      remainingToday: limits.daily === null ? null : Math.max(0, limits.daily - usedToday),
      periodStart: periodStart(now, anchor),
      periodEnd: periodEnd(now, anchor),
      creditCosts: CREDIT_COSTS,
    };
  });
}
