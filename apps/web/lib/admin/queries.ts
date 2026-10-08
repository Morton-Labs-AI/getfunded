import "server-only";

import type postgres from "postgres";

import { getUsage, type UsageSummary } from "@/lib/billing/meter";
import { toInt } from "@/lib/billing/pg";
import { withUser } from "@/lib/db/app";
import { FEATURES, type Feature } from "@/lib/plans";

/**
 * Cross-workspace reads for /admin. Every function runs `withUser(stewardId)`:
 * the steward policies in migrations 0002/0003/0007/0009 are what let these
 * queries see every workspace, so a non-steward id simply gets empty results.
 * Days are UTC calendar days, matching getfunded.utc_today().
 */

type Sql = postgres.TransactionSql;

export type DayCount = { day: string; n: number };
export type FeatureDay = { day: string; feature: Feature; credits: number };

export type Overview = {
  users: number;
  workspaces: number;
  workspacesByPlan: Array<{ plan: string; n: number }>;
  stewards: number;
  activeWorkspaces7d: number;
  signupsPerDay: DayCount[];
  creditsPerDay: FeatureDay[];
  credits30d: number;
  calls30d: number;
  windowDays: number;
  generatedAt: string;
};

/** The last `days` UTC days as YYYY-MM-DD, oldest first, ending today. */
export function dayWindow(days: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days - 1; i >= 0; i--) out.push(new Date(end - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** Fill a sparse day series so every day in the window has a value. */
export function fillDays(days: string[], rows: DayCount[]): DayCount[] {
  const byDay = new Map(rows.map((r) => [r.day, r.n]));
  return days.map((day) => ({ day, n: byDay.get(day) ?? 0 }));
}

/** Pivot feature-per-day rows into one series per feature (in FEATURES order). */
export function pivotFeatures(days: string[], rows: FeatureDay[]): Array<{ feature: Feature; values: number[]; total: number }> {
  return FEATURES.map((feature) => {
    const byDay = new Map(rows.filter((r) => r.feature === feature).map((r) => [r.day, r.credits]));
    const values = days.map((d) => byDay.get(d) ?? 0);
    return { feature, values, total: values.reduce((a, b) => a + b, 0) };
  });
}

function windowStart(sql: Sql, days: number) {
  return sql`(getfunded.utc_today() - ${days - 1})::timestamp at time zone 'UTC'`;
}

export async function getOverview(stewardId: string, days = 30): Promise<Overview> {
  const window = dayWindow(days);
  return withUser(stewardId, async (sql) => {
    const [users, workspaces, byPlan, stewards, active, signups, credits, totals] = await Promise.all([
      sql<{ n: number }[]>`select count(*)::int as n from getfunded.users`,
      sql<{ n: number }[]>`select count(*)::int as n from getfunded.workspaces where deleted_at is null`,
      sql<{ plan: string; n: number }[]>`
        select plan, count(*)::int as n from getfunded.workspaces where deleted_at is null group by plan order by n desc, plan`,
      sql<{ n: number }[]>`select count(*)::int as n from getfunded.users where is_steward`,
      sql<{ n: number }[]>`
        select count(distinct workspace_id)::int as n from (
          select workspace_id from getfunded.usage_ledger where created_at >= now() - interval '7 days'
          union
          select workspace_id from getfunded.events where workspace_id is not null and created_at >= now() - interval '7 days'
        ) x`,
      sql<{ day: string; n: number }[]>`
        select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*)::int as n
        from getfunded.users
        where created_at >= ${windowStart(sql, days)}
        group by 1 order by 1`,
      sql<{ day: string; feature: Feature; credits: number }[]>`
        select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, feature, sum(credits)::int as credits
        from getfunded.usage_ledger
        where status in ('reserved', 'settled') and created_at >= ${windowStart(sql, days)}
        group by 1, 2 order by 1, 2`,
      sql<{ credits: number | string | null; calls: number | string | null }[]>`
        select coalesce(sum(credits), 0) as credits, count(*) as calls
        from getfunded.usage_ledger
        where status in ('reserved', 'settled') and created_at >= ${windowStart(sql, days)}`,
    ]);
    return {
      users: toInt(users[0]?.n),
      workspaces: toInt(workspaces[0]?.n),
      workspacesByPlan: byPlan.map((r) => ({ plan: r.plan, n: toInt(r.n) })),
      stewards: toInt(stewards[0]?.n),
      activeWorkspaces7d: toInt(active[0]?.n),
      signupsPerDay: fillDays(window, signups.map((r) => ({ day: r.day, n: toInt(r.n) }))),
      creditsPerDay: credits.map((r) => ({ day: r.day, feature: r.feature, credits: toInt(r.credits) })),
      credits30d: toInt(totals[0]?.credits),
      calls30d: toInt(totals[0]?.calls),
      windowDays: days,
      generatedAt: new Date().toISOString(),
    };
  });
}

export type TopWorkspace = { workspaceId: string; name: string; slug: string; plan: string; credits: number; calls: number };
export type ModelTotal = {
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  credits: number;
  avgLatencyMs: number | null;
};
export type StatusCount = { status: string; n: number };

export type UsageReport = {
  windowDays: number;
  days: string[];
  creditsPerDay: FeatureDay[];
  topWorkspaces: TopWorkspace[];
  modelTotals: ModelTotal[];
  statusCounts: StatusCount[];
  generatedAt: string;
};

export async function getUsageReport(stewardId: string, days = 30): Promise<UsageReport> {
  const window = dayWindow(days);
  return withUser(stewardId, async (sql) => {
    const [credits, top, models, statuses] = await Promise.all([
      sql<{ day: string; feature: Feature; credits: number }[]>`
        select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, feature, sum(credits)::int as credits
        from getfunded.usage_ledger
        where status in ('reserved', 'settled') and created_at >= ${windowStart(sql, days)}
        group by 1, 2 order by 1, 2`,
      sql<{ workspace_id: string; name: string; slug: string; plan: string; credits: number; calls: number }[]>`
        select l.workspace_id, w.name, w.slug::text as slug, w.plan, sum(l.credits)::int as credits, count(*)::int as calls
        from getfunded.usage_ledger l
        join getfunded.workspaces w on w.id = l.workspace_id
        where l.status in ('reserved', 'settled') and l.created_at >= ${windowStart(sql, days)}
        group by 1, 2, 3, 4
        order by credits desc, calls desc
        limit 10`,
      sql<{ model: string | null; calls: number; input_tokens: number | string | null; output_tokens: number | string | null; credits: number; avg_latency: number | string | null }[]>`
        select model, count(*)::int as calls,
               coalesce(sum(input_tokens), 0) as input_tokens,
               coalesce(sum(output_tokens), 0) as output_tokens,
               coalesce(sum(credits), 0)::int as credits,
               avg(latency_ms) as avg_latency
        from getfunded.usage_ledger
        where status = 'settled' and created_at >= ${windowStart(sql, days)}
        group by model
        order by calls desc`,
      sql<{ status: string; n: number }[]>`
        select status, count(*)::int as n from getfunded.usage_ledger
        where created_at >= ${windowStart(sql, days)}
        group by status order by status`,
    ]);
    return {
      windowDays: days,
      days: window,
      creditsPerDay: credits.map((r) => ({ day: r.day, feature: r.feature, credits: toInt(r.credits) })),
      topWorkspaces: top.map((r) => ({
        workspaceId: r.workspace_id,
        name: r.name,
        slug: r.slug,
        plan: r.plan,
        credits: toInt(r.credits),
        calls: toInt(r.calls),
      })),
      modelTotals: models.map((r) => ({
        model: r.model,
        calls: toInt(r.calls),
        inputTokens: toInt(r.input_tokens),
        outputTokens: toInt(r.output_tokens),
        credits: toInt(r.credits),
        avgLatencyMs: r.avg_latency === null || r.avg_latency === undefined ? null : toInt(r.avg_latency),
      })),
      statusCounts: statuses.map((r) => ({ status: r.status, n: toInt(r.n) })),
      generatedAt: new Date().toISOString(),
    };
  });
}

export type WorkspaceListRow = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  createdAt: string;
  memberCount: number;
  ownerEmail: string | null;
  creditsUsed: number;
  overrideMonthlyCredits: number | null;
  overrideMembers: number | null;
  subscriptionStatus: string | null;
};

export type WorkspaceListParams = { q?: string; plan?: string; page?: number; pageSize?: number };
export type WorkspaceList = { rows: WorkspaceListRow[]; total: number; page: number; pageSize: number };

const PAGE_SIZE = 50;

/** Escape `%` and `_` so a search for "100%" is a literal search. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listWorkspaces(stewardId: string, params: WorkspaceListParams = {}): Promise<WorkspaceList> {
  const q = (params.q ?? "").trim().slice(0, 120);
  const plan = (params.plan ?? "").trim();
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.floor(params.pageSize ?? PAGE_SIZE)));
  const pattern = likePattern(q);
  return withUser(stewardId, async (sql) => {
    const where = sql`
      w.deleted_at is null
      and (${q} = '' or w.name ilike ${pattern} escape '\\' or w.slug::text ilike ${pattern} escape '\\'
           or exists (select 1 from getfunded.members m join getfunded.users u on u.id = m.user_id
                      where m.workspace_id = w.id and u.email::text ilike ${pattern} escape '\\'))
      and (${plan} = '' or w.plan = ${plan})`;
    const [rows, count] = await Promise.all([
      sql<
        {
          id: string;
          slug: string;
          name: string;
          plan: string;
          created_at: string;
          member_count: number;
          owner_email: string | null;
          credits_used: number | string | null;
          override_monthly_credits: number | null;
          override_members: number | null;
          subscription_status: string | null;
        }[]
      >`
        select w.id, w.slug::text as slug, w.name, w.plan, w.created_at,
               (select count(*)::int from getfunded.members m where m.workspace_id = w.id) as member_count,
               (select u.email::text from getfunded.members m join getfunded.users u on u.id = m.user_id
                 where m.workspace_id = w.id order by (m.role = 'owner') desc, m.created_at asc limit 1) as owner_email,
               coalesce(v.credits_used, 0) as credits_used,
               po.monthly_credits as override_monthly_credits,
               po.members as override_members,
               s.status as subscription_status
        from getfunded.workspaces w
        left join getfunded.v_usage_period v on v.workspace_id = w.id
        left join getfunded.plan_overrides po on po.workspace_id = w.id
        left join getfunded.subscriptions s on s.workspace_id = w.id
        where ${where}
        order by w.created_at desc, w.id
        limit ${pageSize} offset ${(page - 1) * pageSize}`,
      sql<{ n: number | string }[]>`select count(*) as n from getfunded.workspaces w where ${where}`,
    ]);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        plan: r.plan,
        createdAt: new Date(r.created_at).toISOString(),
        memberCount: toInt(r.member_count),
        ownerEmail: r.owner_email,
        creditsUsed: toInt(r.credits_used),
        overrideMonthlyCredits: r.override_monthly_credits === null ? null : toInt(r.override_monthly_credits),
        overrideMembers: r.override_members === null ? null : toInt(r.override_members),
        subscriptionStatus: r.subscription_status,
      })),
      total: toInt(count[0]?.n),
      page,
      pageSize,
    };
  });
}

export type WorkspaceMember = {
  userId: string;
  email: string;
  displayName: string | null;
  role: string;
  isSteward: boolean;
  lastSeenAt: string | null;
  joinedAt: string;
};

export type LedgerRow = {
  id: string;
  feature: string;
  credits: number;
  status: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
  userEmail: string | null;
};

export type WorkspaceDetail = {
  id: string;
  slug: string;
  name: string;
  plan: string;
  billingAnchorDay: number;
  stripeCustomerId: string | null;
  createdAt: string;
  deletedAt: string | null;
  settings: Record<string, unknown>;
  profileSummary: { mission: string | null; state: string | null; website: string | null };
  override: { monthlyCredits: number | null; members: number | null; note: string | null; setBy: string | null; updatedAt: string | null } | null;
  subscription: { status: string; plan: string; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean } | null;
  members: WorkspaceMember[];
  apiKeys: number;
  recentLedger: LedgerRow[];
  usage: UsageSummary | null;
};

export async function getWorkspaceDetail(stewardId: string, workspaceId: string): Promise<WorkspaceDetail | null> {
  const base = await withUser(stewardId, async (sql) => {
    const ws = await sql<
      {
        id: string;
        slug: string;
        name: string;
        plan: string;
        billing_anchor_day: number;
        stripe_customer_id: string | null;
        created_at: string;
        deleted_at: string | null;
        settings: Record<string, unknown> | null;
        profile: Record<string, unknown> | null;
      }[]
    >`
      select id, slug::text as slug, name, plan, billing_anchor_day, stripe_customer_id, created_at, deleted_at, settings, profile
      from getfunded.workspaces where id = ${workspaceId}::uuid`;
    const row = ws[0];
    if (!row) return null;

    const [override, sub, members, keys, ledger] = await Promise.all([
      sql<{ monthly_credits: number | null; members: number | null; note: string | null; set_by: string | null; updated_at: string }[]>`
        select monthly_credits, members, note, set_by, updated_at from getfunded.plan_overrides where workspace_id = ${workspaceId}::uuid`,
      sql<{ status: string; plan: string; current_period_end: string | null; cancel_at_period_end: boolean }[]>`
        select status, plan, current_period_end, cancel_at_period_end from getfunded.subscriptions where workspace_id = ${workspaceId}::uuid`,
      sql<{ user_id: string; email: string; display_name: string | null; role: string; is_steward: boolean; last_seen_at: string | null; joined_at: string }[]>`
        select m.user_id, u.email::text as email, u.display_name, m.role, u.is_steward, u.last_seen_at, m.created_at as joined_at
        from getfunded.members m join getfunded.users u on u.id = m.user_id
        where m.workspace_id = ${workspaceId}::uuid
        order by (m.role = 'owner') desc, m.created_at asc`,
      sql<{ n: number }[]>`select count(*)::int as n from getfunded.api_keys where workspace_id = ${workspaceId}::uuid and revoked_at is null`,
      sql<
        {
          id: string;
          feature: string;
          credits: number;
          status: string;
          model: string | null;
          input_tokens: number | null;
          output_tokens: number | null;
          latency_ms: number | null;
          created_at: string;
          user_email: string | null;
        }[]
      >`
        select l.id::text as id, l.feature, l.credits, l.status, l.model, l.input_tokens, l.output_tokens, l.latency_ms, l.created_at,
               u.email::text as user_email
        from getfunded.usage_ledger l left join getfunded.users u on u.id = l.user_id
        where l.workspace_id = ${workspaceId}::uuid
        order by l.created_at desc limit 20`,
    ]);

    const profile = row.profile ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    const detail: Omit<WorkspaceDetail, "usage"> = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      plan: row.plan,
      billingAnchorDay: toInt(row.billing_anchor_day, 1),
      stripeCustomerId: row.stripe_customer_id,
      createdAt: new Date(row.created_at).toISOString(),
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      settings: row.settings ?? {},
      profileSummary: { mission: str(profile.mission), state: str(profile.state), website: str(profile.website) },
      override: override[0]
        ? {
            monthlyCredits: override[0].monthly_credits === null ? null : toInt(override[0].monthly_credits),
            members: override[0].members === null ? null : toInt(override[0].members),
            note: override[0].note,
            setBy: override[0].set_by,
            updatedAt: new Date(override[0].updated_at).toISOString(),
          }
        : null,
      subscription: sub[0]
        ? {
            status: sub[0].status,
            plan: sub[0].plan,
            currentPeriodEnd: sub[0].current_period_end ? new Date(sub[0].current_period_end).toISOString() : null,
            cancelAtPeriodEnd: sub[0].cancel_at_period_end === true,
          }
        : null,
      members: members.map((m) => ({
        userId: m.user_id,
        email: m.email,
        displayName: m.display_name,
        role: m.role,
        isSteward: m.is_steward === true,
        lastSeenAt: m.last_seen_at ? new Date(m.last_seen_at).toISOString() : null,
        joinedAt: new Date(m.joined_at).toISOString(),
      })),
      apiKeys: toInt(keys[0]?.n),
      recentLedger: ledger.map((l) => ({
        id: l.id,
        feature: l.feature,
        credits: toInt(l.credits),
        status: l.status,
        model: l.model,
        inputTokens: l.input_tokens === null ? null : toInt(l.input_tokens),
        outputTokens: l.output_tokens === null ? null : toInt(l.output_tokens),
        latencyMs: l.latency_ms === null ? null : toInt(l.latency_ms),
        createdAt: new Date(l.created_at).toISOString(),
        userEmail: l.user_email,
      })),
    };
    return detail;
  });
  if (!base) return null;

  let usage: UsageSummary | null = null;
  try {
    // Same reader the settings page uses; the steward policies make it work across workspaces.
    usage = await getUsage(workspaceId, stewardId);
  } catch {
    usage = null;
  }
  return { ...base, usage };
}

/** Every steward, for the overview's "who can see this page" list. */
export async function listStewards(stewardId: string): Promise<Array<{ userId: string; email: string; displayName: string | null }>> {
  return withUser(stewardId, async (sql) => {
    const rows = await sql<{ id: string; email: string; display_name: string | null }[]>`
      select id, email::text as email, display_name from getfunded.users where is_steward order by email`;
    return rows.map((r) => ({ userId: r.id, email: r.email, displayName: r.display_name }));
  });
}
