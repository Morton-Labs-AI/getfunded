/**
 * POST /api/billing/portal → { url } for the Stripe Customer Portal
 * (plan changes, payment method, cancellation). Same-origin, owner/admin only.
 */
import { handlePortal } from "@/lib/billing/checkout";
import { assertSameOrigin, boundedJson, jsonError } from "@/lib/security";
import { requireWorkspace } from "@/lib/workspace/context";

export async function POST(req: Request): Promise<Response> {
  return handlePortal(req, { requireWorkspace, assertSameOrigin, boundedJson, jsonError });
}
