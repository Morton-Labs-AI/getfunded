/**
 * POST /api/billing/checkout  { plan: "starter" | "pro" | "team" | "enterprise" }
 * → { url } for Stripe Checkout. Same-origin, signed-in, owner/admin only.
 */
import { handleCheckout } from "@/lib/billing/checkout";
import { assertSameOrigin, boundedJson, jsonError } from "@/lib/security";
import { requireWorkspace } from "@/lib/workspace/context";

export async function POST(req: Request): Promise<Response> {
  return handleCheckout(req, { requireWorkspace, assertSameOrigin, boundedJson, jsonError });
}
