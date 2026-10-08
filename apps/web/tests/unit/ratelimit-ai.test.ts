// @vitest-environment node
/**
 * P1 regression: every /api/ai/* request is counted against a per-user bucket
 * (AI_REQUESTS, 20/min) BEFORE the workspace is loaded or any credit is
 * reserved, and an empty bucket answers 429 with Retry-After.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));
vi.mock("@/lib/auth/session", () => ({ getUserOrNull: vi.fn() }));
vi.mock("@/lib/workspace/context", () => ({ requireWorkspace: vi.fn() }));

import { PlanFeatureError, SignInRequiredError } from "@/lib/ai/http";
import { aiRoute, guardAiRequest, type AiGuardDeps } from "@/lib/ai/route";
import { PLANS, PLAN_FEATURES, can, type PlanFeature } from "@/lib/plans";
import { AI_REQUESTS, tooManyRequests } from "@/lib/ratelimit";

const USER = { id: "22222222-2222-4222-8222-222222222222", email: "pat@example.org", displayName: "Pat" };
const WS = { id: "11111111-1111-4111-8111-111111111111", slug: "ws", name: "Food Bank", plan: "pro" as const, profile: {}, settings: {}, role: "owner" as const, version: 1 };
const req = () => new Request("https://getfunded.test/api/ai/fit", { method: "POST", headers: { origin: "https://getfunded.test", "content-type": "application/json" }, body: "{}" });

function deps(over: Partial<AiGuardDeps> = {}): AiGuardDeps & { rateLimit: ReturnType<typeof vi.fn>; requireWorkspace: ReturnType<typeof vi.fn> } {
  const rateLimit = vi.fn(async () => null as Response | null);
  const requireWorkspace = vi.fn(async () => ({ user: USER, workspace: WS }));
  return {
    getUser: async () => USER,
    requireWorkspace,
    rateLimit,
    assertSameOrigin: () => undefined,
    env: { SELF_HOSTED: "" },
    ...over,
    // keep the spies reachable even when `over` replaced them
    ...(over.rateLimit ? { rateLimit: over.rateLimit as never } : {}),
  } as never;
}

describe("guardAiRequest", () => {
  it("takes one AI_REQUESTS token for the signed-in user before loading the workspace", async () => {
    const d = deps();
    const route = await guardAiRequest(req(), "fit", d);
    expect(route.ctx).toEqual({ userId: USER.id, workspaceId: WS.id });
    expect(d.rateLimit).toHaveBeenCalledTimes(1);
    expect(d.rateLimit.mock.calls[0]?.[1]).toBe(AI_REQUESTS);
    expect(d.rateLimit.mock.calls[0]?.[2]).toBe(`user:${USER.id}`);
    expect(d.rateLimit.mock.invocationCallOrder[0]).toBeLessThan(d.requireWorkspace.mock.invocationCallOrder[0]);
  });

  it("an empty bucket throws the 429 Response and never loads the workspace (so no credit can be reserved)", async () => {
    const limited = tooManyRequests(3);
    const d = deps({ rateLimit: vi.fn(async () => limited) });
    const err = await guardAiRequest(req(), "fit", d).catch((e: unknown) => e);
    expect(err).toBe(limited);
    expect(d.requireWorkspace).not.toHaveBeenCalled();
  });

  it("a signed-out caller gets 401 before the bucket is touched", async () => {
    const d = deps({ getUser: async () => null });
    await expect(guardAiRequest(req(), "fit", d)).rejects.toBeInstanceOf(SignInRequiredError);
    expect(d.rateLimit).not.toHaveBeenCalled();
  });

  it("the plan gate still runs after the bucket", async () => {
    const missing = PLAN_FEATURES.find((f: PlanFeature) => !can("free", f));
    if (!missing) return; // every feature is on Free: nothing to gate
    const d = deps({ requireWorkspace: vi.fn(async () => ({ user: USER, workspace: { ...WS, plan: "free" as const } })) });
    await expect(guardAiRequest(req(), missing, d)).rejects.toBeInstanceOf(PlanFeatureError);
    expect(d.rateLimit).toHaveBeenCalledTimes(1);
    expect(PLANS.free.features[missing]).not.toBe(true);
  });
});

describe("aiRoute", () => {
  it("returns the 429 as-is with Retry-After and does not run the handler", async () => {
    const d = deps({ rateLimit: vi.fn(async () => tooManyRequests(2)) });
    const handler = vi.fn(async () => Response.json({ ok: true }));
    const res = await aiRoute(req(), "fit", handler, d);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(await res.json()).toMatchObject({ error: "rate_limited" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the handler with the route context when the bucket has tokens", async () => {
    const d = deps();
    const res = await aiRoute(req(), "fit", async ({ ctx }) => Response.json(ctx), d);
    expect(await res.json()).toEqual({ userId: USER.id, workspaceId: WS.id });
  });
});
