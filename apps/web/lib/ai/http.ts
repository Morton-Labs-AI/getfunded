/**
 * Typed errors for the AI features and the one place they turn into HTTP.
 * Pure module: route handlers, the SSE stream and tests all use it.
 *
 *   402  quota_exceeded       the workspace used its credits (upgrade link)
 *   403  plan_feature         the plan does not include this feature
 *   403  forbidden            RLS or a grant said no
 *   404  funder_not_found     the org id is not in the corpus
 *   404  workspace_not_found  not a member (RLS hides the workspace)
 *   422  evidence_too_thin    nothing in the corpus to reason from
 *   422  ai_refused           the model declined
 *   502  ai_no_tool_call      the model answered in prose twice
 *   502  ai_output_rejected   the model's output failed validation twice
 *   503  ai_disabled          kill switch (AI_ENABLED=false or the steward flag)
 *   503  not_configured       e.g. ANALYST_DATABASE_URL unset
 */
import type { PlanFeature } from "@/lib/plans";

export class AiFeatureError extends Error {
  readonly code: string;
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(code: string, status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "AiFeatureError";
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

export class PlanFeatureError extends AiFeatureError {
  constructor(feature: PlanFeature, plan: string) {
    super("plan_feature", 403, "This feature is not included in your plan.", { feature, plan, upgradeUrl: "/pricing" });
    this.name = "PlanFeatureError";
  }
}

export class SignInRequiredError extends AiFeatureError {
  constructor() {
    super("sign_in_required", 401, "Sign in to use this feature.");
    this.name = "SignInRequiredError";
  }
}

export class AiNotConfiguredError extends AiFeatureError {
  constructor(message = "Not configured on this install.") {
    super("not_configured", 503, message);
    this.name = "AiNotConfiguredError";
  }
}

export class FunderNotFoundError extends AiFeatureError {
  constructor(orgId: string) {
    super("funder_not_found", 404, "That funder is not in the database.", { orgId });
    this.name = "FunderNotFoundError";
  }
}

export class EvidenceTooThinError extends AiFeatureError {
  constructor() {
    super(
      "evidence_too_thin",
      422,
      "There is not enough public data on this funder to analyze it honestly yet: no giving history, financials or application statement on file.",
    );
    this.name = "EvidenceTooThinError";
  }
}

/** The model's output failed validation after the one retry. Carries usage so the ledger can record tokens. */
export class AiOutputRejectedError extends AiFeatureError {
  readonly usage: { inputTokens: number; outputTokens: number; model: string } | null;
  constructor(violations: ReadonlyArray<string>, usage: AiOutputRejectedError["usage"] = null) {
    super("ai_output_rejected", 502, `The analysis was rejected after a retry: ${violations.slice(0, 6).join("; ")}`, {
      violations: violations.slice(0, 12),
    });
    this.name = "AiOutputRejectedError";
    this.usage = usage;
  }
}

export class AnalysisNotFoundError extends AiFeatureError {
  constructor() {
    super("analysis_not_found", 404, "That analysis was not found in this workspace.");
    this.name = "AnalysisNotFoundError";
  }
}

export type AiErrorPayload = { status: number; body: { error: Record<string, unknown> } };

type ErrorLike = { code?: unknown; status?: unknown; message?: unknown; name?: unknown; toJSON?: unknown };

/**
 * Map a thrown value to a status and a JSON body. Returns null for anything
 * unexpected, which the caller logs and answers with a generic 500.
 */
export function aiErrorPayload(err: unknown): AiErrorPayload | null {
  if (err instanceof AiFeatureError) {
    return { status: err.status, body: { error: { code: err.code, message: err.message, ...err.extra } } };
  }
  if (!err || typeof err !== "object") return null;
  const e = err as ErrorLike;
  const message = typeof e.message === "string" ? e.message : "Something went wrong.";

  // lib/billing/quota QuotaExceededError (status 402, has toJSON with used/limit/periodEnd/upgradeUrl).
  if (e.code === "quota_exceeded" && e.status === 402 && typeof e.toJSON === "function") {
    const json = (e.toJSON as () => Record<string, unknown>)();
    const { error: _code, message: _m, ...rest } = json;
    void _code;
    void _m;
    return { status: 402, body: { error: { code: "quota_exceeded", message, ...rest } } };
  }
  // lib/ai/types AiError family: ai_disabled 503, ai_refused 422, ai_no_tool_call 502.
  if (typeof e.code === "string" && typeof e.status === "number" && /^ai_/.test(e.code)) {
    return { status: e.status, body: { error: { code: e.code, message } } };
  }
  // lib/billing/meter WorkspaceAccessError.
  if (e.code === "workspace_not_found") return { status: 404, body: { error: { code: "workspace_not_found", message } } };
  // lib/db/app DbError.
  if (e.name === "DbError") {
    if (e.code === "forbidden") return { status: 403, body: { error: { code: "forbidden", message } } };
    if (e.code === "timeout") return { status: 504, body: { error: { code: "timeout", message } } };
    if (e.code === "quota_exceeded") return { status: 402, body: { error: { code: "quota_exceeded", message, upgradeUrl: "/pricing" } } };
  }
  return null;
}

/** A ready `Response` for a route handler, or null when the error is unexpected. */
export function aiErrorToResponse(err: unknown): Response | null {
  if (err instanceof Response) return err;
  const payload = aiErrorPayload(err);
  if (!payload) return null;
  return Response.json(payload.body, { status: payload.status, headers: { "cache-control": "no-store" } });
}

/** The generic 500, with the message kept out of the body. */
export function internalErrorResponse(): Response {
  return Response.json(
    { error: { code: "internal_error", message: "Something went wrong on our side. Please try again." } },
    { status: 500, headers: { "cache-control": "no-store" } },
  );
}
