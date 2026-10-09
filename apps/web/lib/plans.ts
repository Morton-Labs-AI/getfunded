/**
 * Plans, credit prices and feature flags: the code twin of docs/PLANS.md.
 *
 * docs/PLANS.md is the single source of truth. `tests/unit/billing/plans.test.ts`
 * parses its tables and fails when the numbers here drift from the document.
 * This module is pure (no server imports) so the pricing page can render it.
 */

export const PLAN_IDS = ["free", "starter", "pro", "team", "enterprise", "unlimited"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Plans a workspace can buy through Stripe Checkout. */
export const PAID_PLAN_IDS = ["starter", "pro", "team", "enterprise"] as const;
export type PaidPlanId = (typeof PAID_PLAN_IDS)[number];

/** Metered features: every model call is one of these and costs `CREDIT_COSTS[feature]`. */
export const FEATURES = ["filter", "ask", "draft", "fit", "research"] as const;
export type Feature = (typeof FEATURES)[number];

export const CREDIT_COSTS: Record<Feature, number> = {
  filter: 1,
  ask: 2,
  draft: 2,
  fit: 5,
  research: 10,
};

/** Capability flags a plan grants. `can(plan, flag)` answers "may this workspace do X". */
export const PLAN_FEATURES = [
  "nl_filter",
  "ask",
  "fit",
  "research",
  "draft",
  "send_gmail",
  "api",
  "sequences",
  "shared_knowledge",
  "dedicated_outreach",
  "reports",
  "signal_discovery",
] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export type ExportLevel = "none" | "limited100" | "full";

export type Plan = {
  id: PlanId;
  name: string;
  /** Monthly price in cents. 0 for Free and the internal Unlimited plan. */
  price_cents_monthly: number;
  /** Seats. null = unlimited. */
  members: number | null;
  /** AI credits per billing period. null = unlimited (recorded, never refused). */
  monthly_credits: number | null;
  /** Daily soft cap = ceil(monthly / 3). null when monthly is unlimited. */
  daily_credits: number | null;
  /** null = unlimited. */
  saved_funders_limit: number | null;
  /** null = unlimited. */
  pipelines_limit: number | null;
  export: ExportLevel;
  /** Row cap for `limited100`; null otherwise. */
  export_rows: number | null;
  features: Record<PlanFeature, boolean>;
  /** Name of the env var holding the Stripe price id; null when not purchasable. */
  stripe_price_env: string | null;
  /** Team and above may switch the daily soft cap off (workspace setting `daily_cap_enabled`). */
  can_disable_daily_cap: boolean;
  /** False for the internal Unlimited plan, which never appears on /pricing. */
  public: boolean;
};

/** Daily soft cap: one third of the monthly credits, rounded up. */
export function dailyCreditsFor(monthly: number | null): number | null {
  if (monthly === null) return null;
  return Math.ceil(monthly / 3);
}

const BASE_FEATURES: Record<PlanFeature, boolean> = {
  nl_filter: true,
  ask: true,
  fit: true,
  research: true,
  draft: true,
  send_gmail: false,
  api: false,
  sequences: false,
  shared_knowledge: false,
  dedicated_outreach: false,
  reports: false,
  signal_discovery: false,
};

function plan(
  id: PlanId,
  name: string,
  price_cents_monthly: number,
  members: number | null,
  monthly_credits: number | null,
  saved_funders_limit: number | null,
  pipelines_limit: number | null,
  exportLevel: ExportLevel,
  features: Partial<Record<PlanFeature, boolean>>,
  stripe_price_env: string | null,
  opts: { can_disable_daily_cap?: boolean; public?: boolean } = {},
): Plan {
  return {
    id,
    name,
    price_cents_monthly,
    members,
    monthly_credits,
    daily_credits: dailyCreditsFor(monthly_credits),
    saved_funders_limit,
    pipelines_limit,
    export: exportLevel,
    export_rows: exportLevel === "limited100" ? 100 : null,
    features: { ...BASE_FEATURES, ...features },
    stripe_price_env,
    can_disable_daily_cap: opts.can_disable_daily_cap ?? false,
    public: opts.public ?? true,
  };
}

export const PLANS: Record<PlanId, Plan> = {
  free: plan("free", "Free", 0, 1, 25, 50, 1, "limited100", {}, null),
  starter: plan("starter", "Starter", 1_000, 1, 150, 500, 3, "full", { signal_discovery: true }, "STRIPE_PRICE_STARTER"),
  pro: plan(
    "pro",
    "Pro",
    2_000,
    3,
    500,
    null,
    null,
    "full",
    { send_gmail: true, reports: true, signal_discovery: true },
    "STRIPE_PRICE_PRO",
  ),
  team: plan(
    "team",
    "Team",
    10_000,
    10,
    3_000,
    null,
    null,
    "full",
    { send_gmail: true, reports: true, api: true, sequences: true, shared_knowledge: true, signal_discovery: true },
    "STRIPE_PRICE_TEAM",
    { can_disable_daily_cap: true },
  ),
  enterprise: plan(
    "enterprise",
    "Enterprise",
    150_000,
    null,
    25_000,
    null,
    null,
    "full",
    {
      send_gmail: true,
      reports: true,
      api: true,
      sequences: true,
      shared_knowledge: true,
      dedicated_outreach: true,
      signal_discovery: true,
    },
    "STRIPE_PRICE_ENTERPRISE",
    { can_disable_daily_cap: true },
  ),
  unlimited: plan(
    "unlimited",
    "Unlimited",
    0,
    null,
    null,
    null,
    null,
    "full",
    {
      send_gmail: true,
      reports: true,
      api: true,
      sequences: true,
      shared_knowledge: true,
      dedicated_outreach: true,
      signal_discovery: true,
    },
    null,
    { can_disable_daily_cap: true, public: false },
  ),
};

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && (PLAN_IDS as readonly string[]).includes(value);
}

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && (PAID_PLAN_IDS as readonly string[]).includes(value);
}

export function isFeature(value: unknown): value is Feature {
  return typeof value === "string" && (FEATURES as readonly string[]).includes(value);
}

type Env = Record<string, string | undefined>;

/** `SELF_HOSTED=true` (or 1) puts every workspace on the internal Unlimited plan. */
export function isSelfHosted(env: Env = process.env): boolean {
  const v = env.SELF_HOSTED?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** A steward-granted exception from `getfunded.plan_overrides`. */
export type PlanOverride = {
  monthly_credits?: number | null;
  members?: number | null;
} | null;

export type ResolvedPlan = Plan & {
  /** The plan id the workspace row carries, before SELF_HOSTED or overrides. */
  base_plan: PlanId;
  /** True when a plan_overrides row changed the limits. */
  overridden: boolean;
};

/**
 * Resolve the effective plan for a workspace: SELF_HOSTED wins, then the
 * workspace's plan column (unknown values fall back to Free), then any
 * steward override of monthly credits or seats. The daily cap follows the
 * overridden monthly value.
 */
export function planFor(
  workspace: { plan?: string | null } | null | undefined,
  override?: PlanOverride,
  env: Env = process.env,
): ResolvedPlan {
  if (isSelfHosted(env)) {
    return { ...PLANS.unlimited, base_plan: "unlimited", overridden: false };
  }
  const id: PlanId = isPlanId(workspace?.plan) ? workspace.plan : "free";
  const base = PLANS[id];
  const monthly = override?.monthly_credits;
  const members = override?.members;
  const hasMonthly = monthly !== undefined && monthly !== null && Number.isFinite(monthly);
  const hasMembers = members !== undefined && members !== null && Number.isFinite(members);
  if (!hasMonthly && !hasMembers) {
    return { ...base, base_plan: id, overridden: false };
  }
  const monthly_credits = hasMonthly ? Math.max(0, Math.floor(monthly)) : base.monthly_credits;
  return {
    ...base,
    monthly_credits,
    daily_credits: base.monthly_credits === null ? null : dailyCreditsFor(monthly_credits),
    members: hasMembers ? Math.max(1, Math.floor(members)) : base.members,
    base_plan: id,
    overridden: true,
  };
}

/** Does this plan include a capability? Accepts a plan object or id. */
export function can(plan: Plan | PlanId | string | null | undefined, feature: PlanFeature): boolean {
  const def = typeof plan === "object" && plan !== null ? plan : PLANS[isPlanId(plan) ? plan : "free"];
  return def.features[feature] === true;
}

/** Monthly price for display, e.g. "$0", "$10", "$1,500". */
export function formatPlanPrice(plan: Plan): string {
  return `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(plan.price_cents_monthly / 100)}`;
}
