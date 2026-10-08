import "server-only";
/**
 * The shared front door for every /api/ai/* handler:
 *   1. same-origin only (assertSameOrigin),
 *   2. signed in (401 as JSON, never a redirect, since callers are fetch()),
 *   3. per-user request rate limit (AI_REQUESTS, 429 with Retry-After) BEFORE
 *      any credit is reserved, so a looping client is stopped at the door,
 *   4. provisioned + active workspace (requireWorkspace),
 *   5. plan feature gate (can(plan, feature) → 403 plan_feature),
 *   6. typed errors → JSON (402 quota, 503 disabled, ...), unknown → 500.
 */
import { getUserOrNull, type SessionUser } from "@/lib/auth/session";
import { can, planFor, type PlanFeature, type ResolvedPlan } from "@/lib/plans";
import { AI_REQUESTS, userSubject, withRateLimit, type RateLimitPreset } from "@/lib/ratelimit";
import { assertSameOrigin } from "@/lib/security";
import { requireWorkspace, type Workspace } from "@/lib/workspace/context";
import { PlanFeatureError, SignInRequiredError, aiErrorToResponse, internalErrorResponse } from "./http";

export type AiRouteContext = {
  user: SessionUser;
  workspace: Workspace;
  plan: ResolvedPlan;
  /** What meter() and the feature modules take. */
  ctx: { userId: string; workspaceId: string };
};

/** The request-scoped collaborators, injectable so the guard is unit-testable without Next's request context. */
export type AiGuardDeps = {
  getUser?: () => Promise<SessionUser | null>;
  requireWorkspace?: () => Promise<{ user: SessionUser; workspace: Workspace }>;
  /** The bucket; defaults to lib/ratelimit withRateLimit. Returns a 429 Response or null. */
  rateLimit?: (req: Request, preset: RateLimitPreset, subject: string) => Promise<Response | null>;
  assertSameOrigin?: (req: Request) => void;
  env?: Record<string, string | undefined>;
};

async function defaultRateLimit(req: Request, preset: RateLimitPreset, subject: string): Promise<Response | null> {
  return withRateLimit(req, preset, () => subject);
}

export async function guardAiRequest(req: Request, feature: PlanFeature, deps: AiGuardDeps = {}): Promise<AiRouteContext> {
  (deps.assertSameOrigin ?? assertSameOrigin)(req);
  const user = await (deps.getUser ?? getUserOrNull)();
  if (!user) throw new SignInRequiredError();
  // Per person, not per workspace: a member of several workspaces still gets
  // one budget of model requests. Thrown as a Response so aiRoute returns it as-is.
  const limited = await (deps.rateLimit ?? defaultRateLimit)(req, AI_REQUESTS, userSubject(user.id) as string);
  if (limited) throw limited;
  const { workspace } = await (deps.requireWorkspace ?? requireWorkspace)();
  const plan = planFor(workspace, undefined, deps.env ?? process.env);
  if (!can(plan, feature)) throw new PlanFeatureError(feature, plan.id);
  return { user, workspace, plan, ctx: { userId: user.id, workspaceId: workspace.id } };
}

/** Run a handler behind the guard and turn every typed error into JSON. */
export async function aiRoute(
  req: Request,
  feature: PlanFeature,
  handler: (route: AiRouteContext) => Promise<Response>,
  deps: AiGuardDeps = {},
): Promise<Response> {
  try {
    const route = await guardAiRequest(req, feature, deps);
    return await handler(route);
  } catch (err) {
    const res = aiErrorToResponse(err);
    if (res) return res;
    if (isNextControlFlow(err)) throw err;
    console.error("[api/ai]", err instanceof Error ? `${err.name}: ${err.message}` : err);
    return internalErrorResponse();
  }
}

/** Next.js `redirect()` / `notFound()` throw errors the framework must see. */
function isNextControlFlow(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && /^NEXT_/.test(digest);
}
