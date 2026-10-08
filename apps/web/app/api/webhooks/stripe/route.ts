/**
 * POST /api/webhooks/stripe — Stripe calls this; no session, no same-origin check.
 * The raw body is verified against STRIPE_WEBHOOK_SECRET, then the event is
 * applied idempotently (see lib/billing/webhook.ts). Returns 200 for handled,
 * duplicate and ignored events, 400 for bad signatures, and 500 so Stripe
 * retries when the database rejected the change OR when an entitled
 * subscription arrived on a price id that no STRIPE_PRICE_* variable maps
 * (`unknown_price`): answering 200 there would make Stripe forget the event
 * and leave the workspace on the wrong plan.
 */
import { stripe, webhookSecret, StripeNotConfiguredError } from "@/lib/billing/stripe";
import { UnknownPriceError, handleStripeEvent } from "@/lib/billing/webhook";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "missing_signature" }, { status: 400, headers: NO_STORE });

  const payload = await req.text();
  let event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, webhookSecret());
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      return Response.json({ error: "stripe_not_configured" }, { status: 503, headers: NO_STORE });
    }
    return Response.json({ error: "invalid_signature" }, { status: 400, headers: NO_STORE });
  }

  try {
    const outcome = await handleStripeEvent(event);
    return Response.json({ received: true, ...outcome }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof UnknownPriceError) {
      // Already logged at error level by the handler, with the price id and the hint.
      return Response.json({ error: "unknown_price", eventId: event.id, priceId: err.priceId }, { status: 500, headers: NO_STORE });
    }
    console.error("[stripe-webhook] failed", { eventId: event.id, type: event.type, error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: "webhook_failed", eventId: event.id }, { status: 500, headers: NO_STORE });
  }
}
