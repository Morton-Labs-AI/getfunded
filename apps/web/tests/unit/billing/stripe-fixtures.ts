/** A minimal Stripe.Subscription as the webhook sees it (periods on the item, metadata from checkout). */
import type Stripe from "stripe";
import { WS } from "./fake-sql";

export function fakeSubscription(over: Partial<Stripe.Subscription> & { priceId?: string } = {}): Stripe.Subscription {
  const { priceId = "price_pro", ...rest } = over;
  return {
    id: "sub_123",
    object: "subscription",
    customer: "cus_123",
    status: "active",
    cancel_at_period_end: false,
    metadata: { workspace_id: WS, plan: "pro" },
    items: {
      object: "list",
      data: [{ id: "si_1", object: "subscription_item", price: { id: priceId, object: "price" }, current_period_start: 1_767_225_600, current_period_end: 1_769_904_000 }],
      has_more: false,
      url: "/v1/subscription_items",
    },
    ...rest,
  } as unknown as Stripe.Subscription;
}

