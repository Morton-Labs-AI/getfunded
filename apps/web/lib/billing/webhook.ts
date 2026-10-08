import "server-only";
/**
 * Stripe webhook handling. The route verifies the signature; this module turns
 * an event into one call of the SECURITY DEFINER door
 * `getfunded.apply_subscription(...)` (migrations/getfunded_0008_billing_webhook.sql),
 * which records the event id for idempotency, upserts `getfunded.subscriptions`
 * and sets `workspaces.plan` in one transaction. The webhook runs as the
 * system (no user), which RLS would otherwise block for writes.
 *
 * Handled: checkout.session.completed, customer.subscription.created/updated/deleted,
 * invoice.payment_failed. Unknown price ids are logged and ignored.
 */
import type Stripe from "stripe";
import { appDb, type Db } from "./db";
import {
  ENTITLED_STATUSES,
  idOf,
  stripe as stripeClient,
  subscriptionRecord,
  uuidOrNull,
  type SubscriptionStatus,
} from "./stripe";

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export type WebhookOutcome = {
  eventId: string;
  type: string;
  outcome: "applied" | "duplicate" | "stale" | "ignored" | "unknown_workspace" | "unknown_price";
  reason?: string;
  workspaceId?: string | null;
  plan?: string | null;
};

type Env = Record<string, string | undefined>;

export type WebhookDeps = {
  sql?: Db;
  stripe?: Pick<Stripe, "subscriptions">;
  env?: Env;
  log?: (message: string, extra?: Record<string, unknown>) => void;
};

type ApplyInput = {
  eventName: string;
  workspaceId: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  plan: string | null;
  status: SubscriptionStatus | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean | null;
  raw: unknown | null;
  props: Record<string, unknown>;
};

async function applySubscription(sql: Db, a: ApplyInput): Promise<{ outcome: string; workspace_id: string | null; plan: string | null }> {
  const rows = await sql`
    select outcome, workspace_id, plan
    from getfunded.apply_subscription(
      ${a.eventName},
      ${a.workspaceId},
      ${a.customerId},
      ${a.subscriptionId},
      ${a.plan},
      ${a.status},
      ${a.periodStart},
      ${a.periodEnd},
      ${a.cancelAtPeriodEnd},
      ${a.raw === null ? null : sql.json(a.raw as never)},
      ${sql.json(a.props as never)}
    )`;
  const row = rows[0] ?? {};
  return {
    outcome: String(row.outcome ?? "applied"),
    workspace_id: row.workspace_id ? String(row.workspace_id) : null,
    plan: row.plan ? String(row.plan) : null,
  };
}

function toOutcome(event: Stripe.Event, r: { outcome: string; workspace_id: string | null; plan: string | null }): WebhookOutcome {
  const known: WebhookOutcome["outcome"][] = ["applied", "duplicate", "stale", "ignored", "unknown_workspace", "unknown_price"];
  const outcome = (known as string[]).includes(r.outcome) ? (r.outcome as WebhookOutcome["outcome"]) : "applied";
  return { eventId: event.id, type: event.type, outcome, workspaceId: r.workspace_id, plan: r.plan };
}

function defaultLog(message: string, extra?: Record<string, unknown>) {
  console.warn(`[stripe-webhook] ${message}`, extra ?? {});
}

/** Apply a subscription object (from a subscription event or a completed checkout). */
async function applyFromSubscription(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  hints: { workspaceId?: string | null; customerId?: string | null; forceStatus?: SubscriptionStatus },
  deps: WebhookDeps,
): Promise<WebhookOutcome> {
  const env = deps.env ?? process.env;
  const sql = deps.sql ?? appDb;
  const log = deps.log ?? defaultLog;
  const rec = subscriptionRecord(sub, env);
  const status = hints.forceStatus ?? rec.status;
  const entitled = ENTITLED_STATUSES.has(status);
  if (entitled && rec.plan === null) {
    log("unknown Stripe price; event ignored", { eventId: event.id, type: event.type, priceId: rec.priceId, subscription: sub.id });
    return { eventId: event.id, type: event.type, outcome: "unknown_price", reason: `price ${rec.priceId ?? "(none)"} is not mapped to a plan` };
  }
  const result = await applySubscription(sql, {
    eventName: `stripe:${event.id}`,
    workspaceId: hints.workspaceId ?? rec.workspaceId,
    customerId: hints.customerId ?? rec.stripeCustomerId,
    subscriptionId: rec.stripeSubscriptionId,
    plan: rec.plan,
    status,
    periodStart: rec.currentPeriodStart,
    periodEnd: rec.currentPeriodEnd,
    cancelAtPeriodEnd: rec.cancelAtPeriodEnd,
    raw: sub,
    props: { type: event.type, subscription: sub.id, status, plan: rec.plan, price: rec.priceId },
  });
  return toOutcome(event, result);
}

/** Handle one verified Stripe event. Safe to call twice with the same event. */
export async function handleStripeEvent(event: Stripe.Event, deps: WebhookDeps = {}): Promise<WebhookOutcome> {
  const sql = deps.sql ?? appDb;
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") {
        return { eventId: event.id, type: event.type, outcome: "ignored", reason: "not a subscription checkout" };
      }
      const subId = idOf(session.subscription);
      if (!subId) return { eventId: event.id, type: event.type, outcome: "ignored", reason: "no subscription on session" };
      const sub =
        typeof session.subscription === "object" && session.subscription !== null
          ? session.subscription
          : await (deps.stripe ?? stripeClient(deps.env)).subscriptions.retrieve(subId);
      return applyFromSubscription(
        event,
        sub,
        {
          workspaceId: uuidOrNull(session.client_reference_id) ?? uuidOrNull(session.metadata?.workspace_id),
          customerId: idOf(session.customer),
        },
        deps,
      );
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return applyFromSubscription(event, event.data.object, {}, deps);
    case "customer.subscription.deleted":
      return applyFromSubscription(event, event.data.object, { forceStatus: "canceled" }, deps);
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const subId = idOf(invoice.parent?.subscription_details?.subscription ?? null);
      const customerId = idOf(invoice.customer);
      if (!subId && !customerId) {
        return { eventId: event.id, type: event.type, outcome: "ignored", reason: "invoice has no subscription or customer" };
      }
      const result = await applySubscription(sql, {
        eventName: `stripe:${event.id}`,
        workspaceId: uuidOrNull(invoice.parent?.subscription_details?.metadata?.workspace_id),
        customerId,
        subscriptionId: subId,
        plan: null,
        status: "past_due",
        periodStart: null,
        periodEnd: null,
        cancelAtPeriodEnd: null,
        raw: null,
        props: { type: event.type, invoice: invoice.id, subscription: subId, attempt: invoice.attempt_count },
      });
      return toOutcome(event, result);
    }
    default:
      return { eventId: event.id, type: event.type, outcome: "ignored", reason: `unhandled event type ${event.type}` };
  }
}
