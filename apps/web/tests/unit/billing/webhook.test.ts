// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { WS, jsonValue, makeFakeSql } from "./fake-sql";
import { fakeSubscription } from "./stripe-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import { UnknownPriceError, handleStripeEvent } from "@/lib/billing/webhook";

const ENV = {
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_TEAM: "price_team",
  STRIPE_PRICE_ENTERPRISE: "price_enterprise",
} as Record<string, string | undefined>;

function event<T extends Stripe.Event["type"]>(type: T, object: unknown, id = "evt_1"): Stripe.Event {
  return { id, object: "event", type, data: { object }, created: 1_767_225_600, livemode: false, api_version: "2026-09-30.endive", pending_webhooks: 1, request: null } as unknown as Stripe.Event;
}

/** The fake door answers 'applied' with the workspace it was given (or found). */
function doorSql(outcome = "applied") {
  return makeFakeSql((call) => {
    if (call.text.includes("getfunded.apply_subscription(")) {
      return [{ outcome, workspace_id: (call.values[1] as string | null) ?? WS, plan: call.values[4] }];
    }
    return [];
  });
}

describe("handleStripeEvent", () => {
  it("customer.subscription.created → one apply_subscription call with the mapped record", async () => {
    const fake = doorSql();
    const out = await handleStripeEvent(event("customer.subscription.created", fakeSubscription()), { sql: fake.sql, env: ENV });
    expect(out).toMatchObject({ outcome: "applied", eventId: "evt_1", workspaceId: WS, plan: "pro" });
    const call = fake.find("getfunded.apply_subscription(")[0];
    expect(call.values[0]).toBe("stripe:evt_1");
    expect(call.values.slice(1, 6)).toEqual([WS, "cus_123", "sub_123", "pro", "active"]);
    expect((call.values[6] as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect((call.values[7] as Date).toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(call.values[8]).toBe(false);
    expect(jsonValue(call.values[9])).toMatchObject({ id: "sub_123" });
    expect(jsonValue(call.values[10])).toMatchObject({ type: "customer.subscription.created", subscription: "sub_123", plan: "pro" });
  });

  it("customer.subscription.updated with cancel_at_period_end keeps the plan", async () => {
    const fake = doorSql();
    await handleStripeEvent(event("customer.subscription.updated", fakeSubscription({ cancel_at_period_end: true })), { sql: fake.sql, env: ENV });
    const call = fake.find("getfunded.apply_subscription(")[0];
    expect(call.values[5]).toBe("active");
    expect(call.values[8]).toBe(true);
  });

  it("customer.subscription.deleted forces status canceled", async () => {
    const fake = doorSql();
    const out = await handleStripeEvent(event("customer.subscription.deleted", fakeSubscription({ status: "canceled" })), { sql: fake.sql, env: ENV });
    expect(out.outcome).toBe("applied");
    expect(fake.find("getfunded.apply_subscription(")[0].values[5]).toBe("canceled");
  });

  it("a canceled subscription with an unknown price is still applied (downgrade to free)", async () => {
    const fake = doorSql();
    const out = await handleStripeEvent(event("customer.subscription.deleted", fakeSubscription({ priceId: "price_old" })), { sql: fake.sql, env: ENV });
    expect(out.outcome).toBe("applied");
    expect(fake.find("getfunded.apply_subscription(")[0].values[4]).toBeNull();
  });

  it("an entitled subscription on an unknown price is REFUSED (UnknownPriceError → 500 so Stripe retries) and logged at error level", async () => {
    const fake = doorSql();
    const logError = vi.fn();
    const err = (await handleStripeEvent(event("customer.subscription.updated", fakeSubscription({ priceId: "price_other_product" })), {
      sql: fake.sql,
      env: ENV,
      logError,
    }).catch((e: unknown) => e)) as UnknownPriceError;
    expect(err).toBeInstanceOf(UnknownPriceError);
    expect(err).toMatchObject({ code: "unknown_price", eventId: "evt_1", priceId: "price_other_product" });
    // Nothing was written: a 200 here would have made Stripe forget the event.
    expect(fake.calls).toHaveLength(0);
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining("unknown Stripe price"),
      expect.objectContaining({ priceId: "price_other_product", eventId: "evt_1", hint: expect.stringContaining("STRIPE_PRICE_") }),
    );
  });

  it("checkout.session.completed retrieves the subscription and prefers client_reference_id", async () => {
    const fake = doorSql();
    const retrieve = vi.fn(async () => fakeSubscription({ metadata: {} }));
    const session = { id: "cs_1", object: "checkout.session", mode: "subscription", subscription: "sub_123", customer: "cus_123", client_reference_id: WS, metadata: {} };
    const out = await handleStripeEvent(event("checkout.session.completed", session), {
      sql: fake.sql,
      env: ENV,
      stripe: { subscriptions: { retrieve } } as unknown as Pick<Stripe, "subscriptions">,
    });
    expect(retrieve).toHaveBeenCalledWith("sub_123");
    expect(out.outcome).toBe("applied");
    expect(fake.find("getfunded.apply_subscription(")[0].values.slice(1, 4)).toEqual([WS, "cus_123", "sub_123"]);
  });

  it("checkout.session.completed for a one-off payment is ignored", async () => {
    const fake = doorSql();
    const out = await handleStripeEvent(event("checkout.session.completed", { id: "cs_2", object: "checkout.session", mode: "payment" }), { sql: fake.sql, env: ENV });
    expect(out.outcome).toBe("ignored");
    expect(fake.calls).toHaveLength(0);
  });

  it("invoice.payment_failed marks the subscription past_due without touching plan or periods", async () => {
    const fake = doorSql();
    const invoice = {
      id: "in_1",
      object: "invoice",
      customer: "cus_123",
      attempt_count: 2,
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_123", metadata: { workspace_id: WS } } },
    };
    const out = await handleStripeEvent(event("invoice.payment_failed", invoice, "evt_inv"), { sql: fake.sql, env: ENV });
    expect(out.outcome).toBe("applied");
    const call = fake.find("getfunded.apply_subscription(")[0];
    expect(call.values.slice(0, 10)).toEqual(["stripe:evt_inv", WS, "cus_123", "sub_123", null, "past_due", null, null, null, null]);
    expect(jsonValue(call.values[10])).toMatchObject({ invoice: "in_1", attempt: 2 });
  });

  it("surfaces duplicate, stale and unknown_workspace outcomes from the door", async () => {
    for (const outcome of ["duplicate", "stale", "unknown_workspace"] as const) {
      const fake = doorSql(outcome);
      const out = await handleStripeEvent(event("customer.subscription.updated", fakeSubscription()), { sql: fake.sql, env: ENV });
      expect(out.outcome).toBe(outcome);
    }
  });

  it("ignores event types it does not handle", async () => {
    const fake = doorSql();
    const out = await handleStripeEvent(event("customer.created" as never, { id: "cus_x" }), { sql: fake.sql, env: ENV });
    expect(out.outcome).toBe("ignored");
    expect(fake.calls).toHaveLength(0);
  });

  it("propagates database failures so Stripe retries", async () => {
    const fake = makeFakeSql(() => { throw new Error("db down"); });
    await expect(handleStripeEvent(event("customer.subscription.updated", fakeSubscription()), { sql: fake.sql, env: ENV })).rejects.toThrow("db down");
  });
});
