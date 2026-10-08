import "server-only";
/**
 * Route logic for POST /api/billing/checkout and POST /api/billing/portal with
 * the request-context helpers injected, so the handlers are unit-testable and
 * the route files stay one line each. Same-origin, workspace membership and
 * the admin role are checked before anything touches Stripe.
 *
 * The helpers from lib/security throw `Response` objects on failure
 * (403 cross-origin, 400/413/415 bad body); the handlers return those as-is.
 */
import { z } from "zod";
import { PAID_PLAN_IDS, isSelfHosted } from "@/lib/plans";
import { ENTITLED_STATUSES, StripeNotConfiguredError, createCheckoutSession, createPortalSession, type StripeDeps } from "./stripe";
import { type Db, withUser } from "./db";

export type WorkspaceContext = {
  user: { id: string; email: string; displayName?: string | null };
  workspace: { id: string; slug: string; name: string; plan: string; role: string; profile?: unknown; settings?: unknown };
};

type WithUser = <T>(userId: string | null, fn: (sql: Db) => Promise<T>) => Promise<T>;

/** The shape of lib/security + lib/workspace/context, injected so tests can fake them. */
export type BillingRouteDeps = {
  requireWorkspace: () => Promise<WorkspaceContext>;
  /** Throws a 403 `Response` for cross-origin requests. */
  assertSameOrigin: (req: Request) => void;
  /** Reads a bounded JSON body and validates it; throws a `Response` on failure. */
  boundedJson: <T>(req: Request, schema: z.ZodType<T>, maxBytes?: number) => Promise<T>;
  jsonError: (status: number, code: string, message: string, extra?: Record<string, unknown>) => Response;
  env?: Record<string, string | undefined>;
  withUser?: WithUser;
  stripe?: StripeDeps;
  createCheckoutSession?: typeof createCheckoutSession;
  createPortalSession?: typeof createPortalSession;
};

export const CheckoutBody = z.object({ plan: z.enum(PAID_PLAN_IDS) });

export function isBillingAdmin(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

function appOrigin(req: Request, env: Record<string, string | undefined>): string {
  const configured = env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(req.url).origin;
}

/** Same-origin, hosted deployment, signed in, owner or admin. */
async function preamble(req: Request, deps: BillingRouteDeps): Promise<{ ctx: WorkspaceContext } | { response: Response }> {
  deps.assertSameOrigin(req);
  const env = deps.env ?? process.env;
  if (isSelfHosted(env)) {
    return { response: deps.jsonError(404, "billing_unavailable", "Billing is not available on self-hosted installs.") };
  }
  const ctx = await deps.requireWorkspace();
  if (!isBillingAdmin(ctx.workspace.role)) {
    return { response: deps.jsonError(403, "admin_required", "Only workspace owners and admins can manage billing.") };
  }
  return { ctx };
}

function thrownResponse(err: unknown): Response | null {
  return err instanceof Response ? err : null;
}

export async function handleCheckout(req: Request, deps: BillingRouteDeps): Promise<Response> {
  try {
    const pre = await preamble(req, deps);
    if ("response" in pre) return pre.response;
    const { ctx } = pre;
    const env = deps.env ?? process.env;
    const wu: WithUser = deps.withUser ?? withUser;

    const body = await deps.boundedJson(req, CheckoutBody, 4_000);

    // One subscription per workspace: changes go through the portal, never a second checkout.
    const existing = await wu(ctx.user.id, async (sql) => {
      const rows = await sql`select status from getfunded.subscriptions where workspace_id = ${ctx.workspace.id}`;
      return rows[0]?.status ? String(rows[0].status) : null;
    });
    if (existing && ENTITLED_STATUSES.has(existing as never)) {
      return deps.jsonError(
        409,
        "already_subscribed",
        "This workspace already has a subscription. Change plans from the billing portal.",
      );
    }

    const origin = appOrigin(req, env);
    const session = await (deps.createCheckoutSession ?? createCheckoutSession)(
      {
        workspace: { id: ctx.workspace.id, name: ctx.workspace.name },
        plan: body.plan,
        userEmail: ctx.user.email,
        userId: ctx.user.id,
        successUrl: `${origin}/app/settings/billing?checkout=success`,
        cancelUrl: `${origin}/app/settings/billing?checkout=canceled`,
      },
      { env, withUser: wu, ...deps.stripe },
    );
    if (!session.url) return deps.jsonError(502, "stripe_no_url", "Stripe did not return a checkout link.");
    return Response.json({ url: session.url }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const res = thrownResponse(err);
    if (res) return res;
    if (err instanceof StripeNotConfiguredError) {
      return deps.jsonError(503, "stripe_not_configured", "Billing is not configured on this deployment.");
    }
    throw err;
  }
}

export async function handlePortal(req: Request, deps: BillingRouteDeps): Promise<Response> {
  try {
    const pre = await preamble(req, deps);
    if ("response" in pre) return pre.response;
    const { ctx } = pre;
    const env = deps.env ?? process.env;
    const wu: WithUser = deps.withUser ?? withUser;

    const customerId = await wu(ctx.user.id, async (sql) => {
      const rows = await sql`select stripe_customer_id from getfunded.workspaces where id = ${ctx.workspace.id}`;
      return rows[0]?.stripe_customer_id ? String(rows[0].stripe_customer_id) : null;
    });
    if (!customerId) {
      return deps.jsonError(400, "no_billing_account", "This workspace has no billing account yet. Choose a plan first.");
    }

    const session = await (deps.createPortalSession ?? createPortalSession)(
      { customerId, returnUrl: `${appOrigin(req, env)}/app/settings/billing` },
      { env, ...deps.stripe },
    );
    return Response.json({ url: session.url }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    const res = thrownResponse(err);
    if (res) return res;
    if (err instanceof StripeNotConfiguredError) {
      return deps.jsonError(503, "stripe_not_configured", "Billing is not configured on this deployment.");
    }
    throw err;
  }
}
