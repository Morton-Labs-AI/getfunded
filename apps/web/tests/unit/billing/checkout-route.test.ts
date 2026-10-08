// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { USER, WS, makeFakeSql, makeFakeWithUser } from "./fake-sql";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import { handleCheckout, handlePortal, type BillingRouteDeps, type WorkspaceContext } from "@/lib/billing/checkout";
// The real request helpers: pure functions, so the handlers are exercised end to end.
import { assertSameOrigin, boundedJson, jsonError } from "@/lib/security";

const ENV = { APP_URL: "https://getfunded.test", SELF_HOSTED: "" } as Record<string, string | undefined>;

function ctx(role: string): WorkspaceContext {
  return {
    user: { id: USER, email: "owner@example.org", displayName: "Owner" },
    workspace: { id: WS, slug: "food-bank", name: "Food Bank", plan: "free", role, profile: {}, settings: {} },
  };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://getfunded.test/api/billing/checkout", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://getfunded.test", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(role: string, over: Partial<BillingRouteDeps> = {}) {
  const fake = makeFakeSql(() => []);
  const { withUser } = makeFakeWithUser(fake);
  const createCheckoutSession = vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.test/cs_1" }));
  const createPortalSession = vi.fn(async () => ({ url: "https://portal.stripe.test/p" }));
  const d: BillingRouteDeps = {
    requireWorkspace: vi.fn(async () => ctx(role)),
    assertSameOrigin: (req) => assertSameOrigin(req, ENV),
    boundedJson,
    jsonError,
    env: ENV,
    withUser,
    createCheckoutSession: createCheckoutSession as unknown as BillingRouteDeps["createCheckoutSession"],
    createPortalSession: createPortalSession as unknown as BillingRouteDeps["createPortalSession"],
    ...over,
  };
  return { d, fake, createCheckoutSession, createPortalSession };
}

describe("POST /api/billing/checkout", () => {
  it("rejects a member who is not an admin with 403 and never calls Stripe", async () => {
    const { d, createCheckoutSession } = deps("member");
    const res = await handleCheckout(post({ plan: "pro" }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "admin_required" } });
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests with the 403 thrown by assertSameOrigin", async () => {
    const { d, createCheckoutSession } = deps("owner");
    const res = await handleCheckout(post({ plan: "pro" }, { origin: "https://evil.example" }), d);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: { code: "bad_origin" } });
    expect(d.requireWorkspace).not.toHaveBeenCalled();
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("rejects an unknown plan with the 400 from boundedJson", async () => {
    const { d } = deps("admin");
    const res = await handleCheckout(post({ plan: "free" }), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "invalid_body" } });
    const res2 = await handleCheckout(post("{not json"), d);
    expect(res2.status).toBe(400);
  });

  it("is a 404 on self-hosted installs", async () => {
    const { d } = deps("owner", { env: { ...ENV, SELF_HOSTED: "true" } });
    const res = await handleCheckout(post({ plan: "pro" }), d);
    expect(res.status).toBe(404);
  });

  it("refuses a second checkout while a subscription is active (409 → use the portal)", async () => {
    const fake = makeFakeSql((call) => (call.text.includes("from getfunded.subscriptions") ? [{ status: "active" }] : []));
    const { withUser } = makeFakeWithUser(fake);
    const { d, createCheckoutSession } = deps("owner", { withUser });
    const res = await handleCheckout(post({ plan: "team" }), d);
    expect(res.status).toBe(409);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("creates a checkout session for an admin and returns its url", async () => {
    const { d, createCheckoutSession } = deps("admin");
    const res = await handleCheckout(post({ plan: "team" }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://checkout.stripe.test/cs_1" });
    expect(createCheckoutSession).toHaveBeenCalledWith(
      {
        workspace: { id: WS, name: "Food Bank" },
        plan: "team",
        userEmail: "owner@example.org",
        userId: USER,
        successUrl: "https://getfunded.test/app/settings/billing?checkout=success",
        cancelUrl: "https://getfunded.test/app/settings/billing?checkout=canceled",
      },
      expect.objectContaining({ env: ENV }),
    );
  });

  it("maps AlreadySubscribedError from Stripe's own subscription list to the same 409", async () => {
    const { d } = deps("owner", {
      createCheckoutSession: async () => {
        const { AlreadySubscribedError } = await import("@/lib/billing/stripe");
        throw new AlreadySubscribedError("sub_live", "incomplete");
      },
    });
    const res = await handleCheckout(post({ plan: "pro" }), d);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: "already_subscribed" } });
  });

  it("answers 503 when Stripe is not configured", async () => {
    const { d } = deps("owner", {
      createCheckoutSession: async () => {
        const { StripeNotConfiguredError } = await import("@/lib/billing/stripe");
        throw new StripeNotConfiguredError("no key");
      },
    });
    const res = await handleCheckout(post({ plan: "pro" }), d);
    expect(res.status).toBe(503);
  });
});

describe("POST /api/billing/portal", () => {
  it("rejects non-admins", async () => {
    const { d, createPortalSession } = deps("member");
    const res = await handlePortal(post({}), d);
    expect(res.status).toBe(403);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it("asks for a plan first when there is no customer yet", async () => {
    const { d } = deps("owner");
    const res = await handlePortal(post({}), d);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: { code: "no_billing_account" } });
  });

  it("opens the portal for the stored customer", async () => {
    const fake = makeFakeSql((call) => (call.text.includes("stripe_customer_id") ? [{ stripe_customer_id: "cus_9" }] : []));
    const { withUser } = makeFakeWithUser(fake);
    const { d, createPortalSession } = deps("owner", { withUser });
    const res = await handlePortal(post({}), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://portal.stripe.test/p" });
    expect(createPortalSession).toHaveBeenCalledWith({ customerId: "cus_9", returnUrl: "https://getfunded.test/app/settings/billing" }, expect.anything());
  });
});
