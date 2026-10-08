import "server-only";
/**
 * Stripe: lazy client, price <-> plan mapping, Checkout and Customer Portal
 * sessions, and the pure mapping from a Stripe subscription to our record.
 * The webhook handler lives in ./webhook.ts; route wiring in ./checkout.ts.
 */
import Stripe from "stripe";
import { z } from "zod";
import { PAID_PLAN_IDS, PLANS, type PaidPlanId, type PlanId } from "@/lib/plans";
import { type Db, withUser } from "./db";

type Env = Record<string, string | undefined>;

export class StripeNotConfiguredError extends Error {
  readonly code = "stripe_not_configured" as const;
  readonly status = 503;
  constructor(message: string) {
    super(message);
    this.name = "StripeNotConfiguredError";
  }
}

let cached: { key: string; client: Stripe } | null = null;

/** The Stripe client, built on first use. Throws a clear error when STRIPE_SECRET_KEY is unset. */
export function stripe(env: Env = process.env): Stripe {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new StripeNotConfiguredError(
      "STRIPE_SECRET_KEY is not set. Billing is unavailable on this deployment (self-hosted installs have no billing).",
    );
  }
  if (cached?.key !== key) {
    cached = {
      key,
      client: new Stripe(key, {
        typescript: true,
        appInfo: { name: "GetFunded", url: "https://getfunded.ai" },
        maxNetworkRetries: 2,
      }),
    };
  }
  return cached.client;
}

export function webhookSecret(env: Env = process.env): string {
  const s = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!s) throw new StripeNotConfiguredError("STRIPE_WEBHOOK_SECRET is not set.");
  return s;
}

/** The Stripe price id for a purchasable plan, from the env var named in lib/plans.ts. */
export function priceIdFor(plan: PlanId, env: Env = process.env): string {
  const def = PLANS[plan];
  if (!def.stripe_price_env) throw new Error(`Plan "${plan}" cannot be bought through Stripe.`);
  const id = env[def.stripe_price_env]?.trim();
  if (!id) throw new StripeNotConfiguredError(`${def.stripe_price_env} is not set.`);
  return id;
}

/** Reverse lookup: which plan does a Stripe price id belong to? null when unknown. */
export function planForPriceId(priceId: string | null | undefined, env: Env = process.env): PaidPlanId | null {
  if (!priceId) return null;
  for (const plan of PAID_PLAN_IDS) {
    const envName = PLANS[plan].stripe_price_env;
    if (envName && env[envName]?.trim() === priceId) return plan;
  }
  return null;
}

export const SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due", "canceled", "unpaid"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Statuses under which the workspace keeps its paid plan (past_due is a grace period). */
export const ENTITLED_STATUSES: ReadonlySet<SubscriptionStatus> = new Set(["trialing", "active", "past_due"]);

/** Stripe's status vocabulary → ours (`getfunded.subscriptions.status`). */
export function mapSubscriptionStatus(status: string | null | undefined): SubscriptionStatus {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "canceled":
    case "unpaid":
      return status;
    case "incomplete":
      return "unpaid";
    case "incomplete_expired":
      return "canceled";
    case "paused":
      return "past_due";
    default:
      return "unpaid";
  }
}

export type SubscriptionRecord = {
  stripeSubscriptionId: string;
  stripeCustomerId: string | null;
  /** Resolved from the first item's price; null when the price is not one of ours. */
  plan: PaidPlanId | null;
  priceId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** `metadata.workspace_id`, set by createCheckoutSession. */
  workspaceId: string | null;
};

export function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

export function uuidOrNull(value: unknown): string | null {
  const r = z.uuid().safeParse(value);
  return r.success ? r.data : null;
}

function secondsToDate(s: number | null | undefined): Date | null {
  return typeof s === "number" && Number.isFinite(s) ? new Date(s * 1000) : null;
}

/** Pure mapping. Periods live on the subscription item in current Stripe API versions. */
export function subscriptionRecord(sub: Stripe.Subscription, env: Env = process.env): SubscriptionRecord {
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  return {
    stripeSubscriptionId: sub.id,
    stripeCustomerId: idOf(sub.customer),
    plan: planForPriceId(priceId, env),
    priceId,
    status: mapSubscriptionStatus(sub.status),
    currentPeriodStart: secondsToDate(item?.current_period_start),
    currentPeriodEnd: secondsToDate(item?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end === true,
    workspaceId: uuidOrNull(sub.metadata?.workspace_id),
  };
}

type WithUser = <T>(userId: string | null, fn: (sql: Db) => Promise<T>) => Promise<T>;

export type StripeDeps = {
  stripe?: Stripe;
  env?: Env;
  withUser?: WithUser;
};

const WorkspaceRef = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(200).nullish() });

export class BillingWorkspaceError extends Error {
  readonly code = "workspace_not_found" as const;
  readonly status = 404;
  constructor(workspaceId: string) {
    super(`Workspace ${workspaceId} was not found or you may not manage its billing.`);
    this.name = "BillingWorkspaceError";
  }
}

/**
 * Return the workspace's Stripe customer id, creating the customer on first
 * use. The id is written with a compare-and-swap on `stripe_customer_id is
 * null`; if a concurrent request won, its id is kept and ours is deleted.
 * Runs under `withUser(userId)`, so only workspace admins can write (RLS).
 */
export async function ensureCustomer(
  workspaceIn: { id: string; name?: string | null },
  emailIn: string,
  ctx: { userId: string },
  deps: StripeDeps = {},
): Promise<string> {
  const workspace = WorkspaceRef.parse(workspaceIn);
  const email = z.email().parse(emailIn);
  const userId = z.uuid().parse(ctx.userId);
  const wu: WithUser = deps.withUser ?? withUser;
  const s = deps.stripe ?? stripe(deps.env);

  const current = await wu(userId, async (sql) => {
    const rows = await sql`select stripe_customer_id, name from getfunded.workspaces where id = ${workspace.id} and deleted_at is null`;
    if (rows.length === 0) throw new BillingWorkspaceError(workspace.id);
    return rows[0] as { stripe_customer_id: string | null; name: string | null };
  });
  if (current.stripe_customer_id) return current.stripe_customer_id;

  const customer = await s.customers.create({
    email,
    name: workspace.name ?? current.name ?? undefined,
    metadata: { workspace_id: workspace.id },
  });

  const written = await wu(userId, async (sql) => {
    const updated = await sql`
      update getfunded.workspaces
      set stripe_customer_id = ${customer.id}, version = version + 1
      where id = ${workspace.id} and stripe_customer_id is null
      returning stripe_customer_id`;
    if (updated.length > 0) return String(updated[0].stripe_customer_id);
    const again = await sql`select stripe_customer_id from getfunded.workspaces where id = ${workspace.id}`;
    return again[0]?.stripe_customer_id ? String(again[0].stripe_customer_id) : null;
  });

  if (!written) throw new BillingWorkspaceError(workspace.id);
  if (written !== customer.id) {
    // Lost the race: another request already attached a customer. Drop ours; best effort.
    try {
      await s.customers.del(customer.id);
    } catch {
      /* orphaned test customer; harmless */
    }
  }
  return written;
}

const CheckoutInput = z.object({
  workspace: WorkspaceRef,
  plan: z.enum(PAID_PLAN_IDS),
  userEmail: z.email(),
  userId: z.uuid(),
  successUrl: z.url(),
  cancelUrl: z.url(),
});

export type CreateCheckoutSessionInput = z.input<typeof CheckoutInput>;

/** Start Stripe Checkout for a plan. Metadata carries the workspace id so the webhook can find it. */
export async function createCheckoutSession(
  inputIn: CreateCheckoutSessionInput,
  deps: StripeDeps = {},
): Promise<{ id: string; url: string | null }> {
  const input = CheckoutInput.parse(inputIn);
  const env = deps.env ?? process.env;
  const s = deps.stripe ?? stripe(env);
  const price = priceIdFor(input.plan, env);
  const customer = await ensureCustomer(input.workspace, input.userEmail, { userId: input.userId }, { ...deps, stripe: s });
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    customer,
    line_items: [{ price, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.workspace.id,
    allow_promotion_codes: true,
    metadata: { workspace_id: input.workspace.id, plan: input.plan },
    subscription_data: { metadata: { workspace_id: input.workspace.id, plan: input.plan } },
  });
  return { id: session.id, url: session.url ?? null };
}

const PortalInput = z.object({ customerId: z.string().trim().min(1), returnUrl: z.url() });

/** Stripe Customer Portal: plan changes, payment method, cancellation. */
export async function createPortalSession(
  inputIn: z.input<typeof PortalInput>,
  deps: StripeDeps = {},
): Promise<{ url: string }> {
  const input = PortalInput.parse(inputIn);
  const s = deps.stripe ?? stripe(deps.env);
  const session = await s.billingPortal.sessions.create({ customer: input.customerId, return_url: input.returnUrl });
  return { url: session.url };
}
