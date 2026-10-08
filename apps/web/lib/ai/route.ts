import "server-only";
/**
 * The shared front door for every /api/ai/* handler:
 *   1. same-origin only (assertSameOrigin),
 *   2. signed in (401 as JSON, never a redirect, since callers are fetch()),
 *   3. provisioned + active workspace (requireWorkspace),
 *   4. plan feature gate (can(plan, feature) → 403 plan_feature),
 *   5. typed errors → JSON (402 quota, 503 disabled, ...), unknown → 500.
 */
import { getUserOrNull, type SessionUser } from "@/lib/auth/session";
import { can, planFor, type PlanFeature, type ResolvedPlan } from "@/lib/plans";
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

export async function guardAiRequest(req: Request, feature: PlanFeature): Promise<AiRouteContext> {
  assertSameOrigin(req);
  const user = await getUserOrNull();
  if (!user) throw new SignInRequiredError();
  const { workspace } = await requireWorkspace();
  const plan = planFor(workspace);
  if (!can(plan, feature)) throw new PlanFeatureError(feature, plan.id);
  return { user, workspace, plan, ctx: { userId: user.id, workspaceId: workspace.id } };
}

/** Run a handler behind the guard and turn every typed error into JSON. */
export async function aiRoute(
  req: Request,
  feature: PlanFeature,
  handler: (route: AiRouteContext) => Promise<Response>,
): Promise<Response> {
  try {
    const route = await guardAiRequest(req, feature);
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
