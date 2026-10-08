// @vitest-environment node
/**
 * The browser-side reading of /api/ai/* errors (lib/ai/api-client.ts): the
 * status and code decide what the person is told and where the link goes.
 */
import { describe, expect, it } from "vitest";

import { aiErrorCopy, errorKind, readAiError } from "@/lib/ai/api-client";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("readAiError / errorKind", () => {
  it("reads code, message and upgrade link from the standard error body", async () => {
    const err = await readAiError(json(402, { error: { code: "quota_exceeded", message: "AI credit limit reached.", upgradeUrl: "/pricing", used: 25 } }));
    expect(err).toEqual({ kind: "quota", status: 402, code: "quota_exceeded", message: "AI credit limit reached.", upgradeUrl: "/pricing" });
    const copy = aiErrorCopy(err);
    expect(copy.href).toBe("/app/settings/billing");
    expect(copy.linkLabel).toBe("See plans");
  });

  it("classifies the typed codes", () => {
    expect(errorKind(403, "plan_feature")).toBe("plan");
    expect(errorKind(503, "ai_disabled")).toBe("disabled");
    expect(errorKind(503, "not_configured")).toBe("not_configured");
    expect(errorKind(401, "sign_in_required")).toBe("sign_in");
    expect(errorKind(422, "evidence_too_thin")).toBe("thin");
    expect(errorKind(404, "funder_not_found")).toBe("not_found");
    expect(errorKind(500, "internal_error")).toBe("other");
  });

  it("tolerates a non-JSON body and fills a plain fallback message", async () => {
    const err = await readAiError(new Response("Bad Gateway", { status: 502 }));
    expect(err.kind).toBe("other");
    expect(err.code).toBe("request_failed");
    expect(err.message).toMatch(/try again/i);
    const limited = await readAiError(new Response("", { status: 429 }));
    expect(limited.code).toBe("rate_limited");
  });

  it("never offers a plan link for a kill-switch or not-configured answer", () => {
    expect(aiErrorCopy({ kind: "disabled", status: 503, code: "ai_disabled", message: "off" }).href).toBeNull();
    expect(aiErrorCopy({ kind: "not_configured", status: 503, code: "not_configured", message: "no analyst" }).href).toBeNull();
  });
});
