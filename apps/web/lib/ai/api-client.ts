/**
 * The browser side of /api/ai/*: one `postAi()` the client components share,
 * and one reading of the error body into something a person can act on.
 * Client-safe: no server imports, nothing from lib/ai/client.
 */
import { AI_COPY } from "./copy";
import type { AiErrorBody } from "./api-schemas";

export type AiErrorKind = "quota" | "plan" | "disabled" | "not_configured" | "sign_in" | "thin" | "not_found" | "other";

export type AiApiError = {
  kind: AiErrorKind;
  status: number;
  code: string;
  message: string;
  /** Where to send the person when the fix is a plan change. */
  upgradeUrl?: string;
};

export type AiResult<T> = { ok: true; data: T } | { ok: false; error: AiApiError };

export function errorKind(status: number, code: string): AiErrorKind {
  if (code === "quota_exceeded" || status === 402) return "quota";
  if (code === "plan_feature") return "plan";
  if (code === "ai_disabled") return "disabled";
  if (code === "not_configured") return "not_configured";
  if (code === "sign_in_required" || status === 401) return "sign_in";
  if (code === "evidence_too_thin") return "thin";
  if (code === "funder_not_found" || code === "analysis_not_found") return "not_found";
  return "other";
}

/** Read `{ error: { code, message, upgradeUrl? } }` off a failed response, tolerating a non-JSON body. */
export async function readAiError(res: Response): Promise<AiApiError> {
  let body: Partial<AiErrorBody> | null = null;
  try {
    body = (await res.json()) as Partial<AiErrorBody>;
  } catch {
    body = null;
  }
  const e = body?.error;
  const code = typeof e?.code === "string" ? e.code : res.status === 429 ? "rate_limited" : "request_failed";
  const message = typeof e?.message === "string" && e.message ? e.message : fallbackMessage(res.status);
  const upgradeUrl = typeof e?.upgradeUrl === "string" ? e.upgradeUrl : undefined;
  const kind = errorKind(res.status, code);
  return upgradeUrl ? { kind, status: res.status, code, message, upgradeUrl } : { kind, status: res.status, code, message };
}

function fallbackMessage(status: number): string {
  if (status === 401) return "Sign in to use this feature.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "The request could not be completed.";
}

/** POST JSON to one of our own endpoints, same origin, and read the typed result. */
export async function postAi<T>(path: string, body: unknown, init: { signal?: AbortSignal } = {}): Promise<AiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: init.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: { kind: "other", status: 0, code: "aborted", message: "Stopped." } };
    }
    return { ok: false, error: { kind: "other", status: 0, code: "network", message: "Could not reach the server. Check your connection and try again." } };
  }
  if (!res.ok) return { ok: false, error: await readAiError(res) };
  try {
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, error: { kind: "other", status: res.status, code: "bad_response", message: "The server answered in a shape we did not expect." } };
  }
}

/** Plain-language title, hint and (when the fix is a plan change) a link, for any AI error. */
export function aiErrorCopy(error: AiApiError): { title: string; hint: string; href: string | null; linkLabel: string | null } {
  switch (error.kind) {
    case "quota":
      return { title: AI_COPY.quota.title, hint: `${error.message} ${AI_COPY.quota.hint}`.trim(), href: "/app/settings/billing", linkLabel: AI_COPY.quota.upgrade };
    case "plan":
      return { title: AI_COPY.plan.title, hint: AI_COPY.plan.hint, href: "/app/settings/billing", linkLabel: AI_COPY.plan.upgrade };
    case "disabled":
      return { title: AI_COPY.disabled.title, hint: AI_COPY.disabled.hint, href: null, linkLabel: null };
    case "not_configured":
      return { title: AI_COPY.ask.notConfigured, hint: error.message, href: null, linkLabel: null };
    case "sign_in":
      return { title: "Sign in to continue", hint: error.message, href: "/signin", linkLabel: "Sign in" };
    case "thin":
      return { title: AI_COPY.fit.thin, hint: error.message, href: null, linkLabel: null };
    default:
      return { title: "That did not work", hint: error.message, href: null, linkLabel: null };
  }
}
