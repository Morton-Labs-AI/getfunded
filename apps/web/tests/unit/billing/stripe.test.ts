// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { USER, WS, makeFakeSql, makeFakeWithUser } from "./fake-sql";
import { fakeSubscription } from "./stripe-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import {
  BillingWorkspaceError,
  ENTITLED_STATUSES,
  StripeNotConfiguredError,
  createCheckoutSession,
  createPortalSession,
  ensureCustomer,
  mapSubscriptionStatus,
  planForPriceId,
  priceIdFor,
  stripe,
  subscriptionRecord,
  webhookSecret,
} from "@/lib/billing/stripe";

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_PRICE_STARTER: "price_starter",
  STRIPE_PRICE_PRO: "price_pro",
  STRIPE_PRICE_TEAM: "price_team",
  STRIPE_PRICE_ENTERPRISE: "price_enterprise",
} as Record<string, string | undefined>;

describe("client + configuration", () => {
  it("stripe() throws a clear error without STRIPE_SECRET_KEY", () => {
    expect(() => stripe({})).toThrow(StripeNotConfiguredError);
    expect(() => stripe({ STRIPE_SECRET_KEY: " " })).toThrow(/STRIPE_SECRET_KEY/);
    expect(() => webhookSecret({})).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
  it("stripe() builds and caches a client when the key is set", () => {
    const a = stripe(ENV);
    expect(a).toBe(stripe(ENV));
    expect(typeof a.webhooks.constructEvent).toBe("function");
  });
  it("priceIdFor reads the env var named by the plan", () => {
    expect(priceIdFor("pro", ENV)).toBe("price_pro");
    expect(priceIdFor("enterprise", ENV)).toBe("price_enterprise");
    expect(() => priceIdFor("free", ENV)).toThrow(/cannot be bought/);
    expect(() => priceIdFor("team", { ...ENV, STRIPE_PRICE_TEAM: undefined })).toThrow(StripeNotConfiguredError);
  });
  it("planForPriceId is the reverse map and null for strangers", () => {
    expect(planForPriceId("price_team", ENV)).toBe("team");
    expect(planForPriceId("price_nope", ENV)).toBeNull();
    expect(planForPriceId(null, ENV)).toBeNull();
    expect(planForPriceId("price_pro", {})).toBeNull();
  });
});

describe("subscription mapping", () => {
  it("maps Stripe statuses to ours", () => {
    expect(mapSubscriptionStatus("active")).toBe("active");
    expect(mapSubscriptionStatus("trialing")).toBe("trialing");
    expect(mapSubscriptionStatus("incomplete")).toBe("unpaid");
    expect(mapSubscriptionStatus("incomplete_expired")).toBe("canceled");
    expect(mapSubscriptionStatus("paused")).toBe("past_due");
    expect(mapSubscriptionStatus("made_up")).toBe("unpaid");
    expect(ENTITLED_STATUSES.has("past_due")).toBe(true);
    expect(ENTITLED_STATUSES.has("canceled")).toBe(false);
  });
  it("subscriptionRecord reads the item period, price and metadata", () => {
    const rec = subscriptionRecord(fakeSubscription(), ENV);
    expect(rec).toMatchObject({
      stripeSubscriptionId: "sub_123",
      stripeCustomerId: "cus_123",
      plan: "pro",
      priceId: "price_pro",
      status: "active",
      cancelAtPeriodEnd: false,
      workspaceId: WS,
    });
    expect(rec.currentPeriodStart?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(rec.currentPeriodEnd?.toISOString()).toBe("2026-02-01T00:00:00.000Z");
  });
  it("tolerates expanded customers, unknown prices and missing metadata", () => {
    const rec = subscriptionRecord(
      fakeSubscription({ priceId: "price_mystery", customer: { id: "cus_obj" } as never, metadata: {} }),
      ENV,
    );
    expect(rec.plan).toBeNull();
    expect(rec.stripeCustomerId).toBe("cus_obj");
    expect(rec.workspaceId).toBeNull();
  });
});

function fakeStripeClient() {
  const customers = { create: vi.fn(async () => ({ id: "cus_new" })), del: vi.fn(async () => ({})) };
  const checkout = { sessions: { create: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" })) } };
  const billingPortal = { sessions: { create: vi.fn(async () => ({ url: "https://portal.stripe.test/p" })) } };
  return { customers, checkout, billingPortal } as unknown as Stripe;
}

describe("ensureCustomer", () => {
  it("returns the stored customer id without calling Stripe", async () => {
    const fake = makeFakeSql(() => [{ stripe_customer_id: "cus_existing", name: "Food Bank" }]);
    const { withUser, users } = makeFakeWithUser(fake);
    const s = fakeStripeClient();
    const id = await ensureCustomer({ id: WS }, "owner@example.org", { userId: USER }, { stripe: s, withUser });
    expect(id).toBe("cus_existing");
    expect(users).toEqual([USER]);
    expect((s.customers.create as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it("creates the customer and writes it with a compare-and-swap on null", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.startsWith("select stripe_customer_id, name")) return [{ stripe_customer_id: null, name: "Food Bank" }];
      if (call.text.startsWith("update getfunded.workspaces")) return [{ stripe_customer_id: "cus_new" }];
      return [];
    });
    const { withUser } = makeFakeWithUser(fake);
    const s = fakeStripeClient();
    const id = await ensureCustomer({ id: WS, name: "Food Bank" }, "owner@example.org", { userId: USER }, { stripe: s, withUser });
    expect(id).toBe("cus_new");
    expect(s.customers.create).toHaveBeenCalledWith({ email: "owner@example.org", name: "Food Bank", metadata: { workspace_id: WS } });
    const update = fake.find("update getfunded.workspaces")[0];
    expect(update.text).toContain("and stripe_customer_id is null");
    expect(update.text).toContain("version = version + 1");
    expect(update.values).toEqual(["cus_new", WS]);
  });

  it("keeps the winner's id when a concurrent request got there first", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.startsWith("select stripe_customer_id, name")) return [{ stripe_customer_id: null, name: null }];
      if (call.text.startsWith("update getfunded.workspaces")) return []; // CAS lost
      if (call.text.startsWith("select stripe_customer_id from")) return [{ stripe_customer_id: "cus_winner" }];
      return [];
    });
    const { withUser } = makeFakeWithUser(fake);
    const s = fakeStripeClient();
    const id = await ensureCustomer({ id: WS }, "owner@example.org", { userId: USER }, { stripe: s, withUser });
    expect(id).toBe("cus_winner");
    expect(s.customers.del).toHaveBeenCalledWith("cus_new");
  });

  it("throws when the workspace is hidden by RLS", async () => {
    const fake = makeFakeSql(() => []);
    const { withUser } = makeFakeWithUser(fake);
    await expect(ensureCustomer({ id: WS }, "owner@example.org", { userId: USER }, { stripe: fakeStripeClient(), withUser })).rejects.toBeInstanceOf(BillingWorkspaceError);
  });

  it("validates inputs", async () => {
    const fake = makeFakeSql(() => []);
    const { withUser } = makeFakeWithUser(fake);
    await expect(ensureCustomer({ id: "ws" }, "owner@example.org", { userId: USER }, { stripe: fakeStripeClient(), withUser })).rejects.toThrow();
    await expect(ensureCustomer({ id: WS }, "not-an-email", { userId: USER }, { stripe: fakeStripeClient(), withUser })).rejects.toThrow();
  });
});

describe("createCheckoutSession / createPortalSession", () => {
  it("creates a subscription checkout carrying the workspace id", async () => {
    const fake = makeFakeSql(() => [{ stripe_customer_id: "cus_existing", name: "Food Bank" }]);
    const { withUser } = makeFakeWithUser(fake);
    const s = fakeStripeClient();
    const out = await createCheckoutSession(
      {
        workspace: { id: WS, name: "Food Bank" },
        plan: "team",
        userEmail: "owner@example.org",
        userId: USER,
        successUrl: "https://app.test/app/settings/billing?checkout=success",
        cancelUrl: "https://app.test/app/settings/billing?checkout=canceled",
      },
      { stripe: s, env: ENV, withUser },
    );
    expect(out).toEqual({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" });
    expect(s.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        customer: "cus_existing",
        line_items: [{ price: "price_team", quantity: 1 }],
        client_reference_id: WS,
        metadata: { workspace_id: WS, plan: "team" },
        subscription_data: { metadata: { workspace_id: WS, plan: "team" } },
      }),
    );
  });

  it("rejects a non-purchasable plan and bad urls", async () => {
    const fake = makeFakeSql(() => []);
    const { withUser } = makeFakeWithUser(fake);
    const base = { workspace: { id: WS }, userEmail: "a@b.co", userId: USER, successUrl: "https://x.test/a", cancelUrl: "https://x.test/b" };
    await expect(createCheckoutSession({ ...base, plan: "free" as never }, { stripe: fakeStripeClient(), env: ENV, withUser })).rejects.toThrow();
    await expect(createCheckoutSession({ ...base, plan: "pro", successUrl: "nope" }, { stripe: fakeStripeClient(), env: ENV, withUser })).rejects.toThrow();
  });

  it("portal session", async () => {
    const s = fakeStripeClient();
    const out = await createPortalSession({ customerId: "cus_1", returnUrl: "https://app.test/app/settings/billing" }, { stripe: s, env: ENV });
    expect(out.url).toBe("https://portal.stripe.test/p");
    expect(s.billingPortal.sessions.create).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://app.test/app/settings/billing" });
  });
});
