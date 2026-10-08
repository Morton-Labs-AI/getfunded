// @vitest-environment node
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { allowedHosts, assertSameOrigin, boundedJson, clientIp, isSameOrigin, jsonError } from "@/lib/security";

const APP = "https://getfunded.ai";

function req(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(url, { method: "POST", ...init });
}

async function refusal(fn: () => unknown | Promise<unknown>): Promise<{ status: number; code: string; body: unknown }> {
  try {
    await fn();
  } catch (thrown) {
    if (thrown instanceof Response) {
      const body = (await thrown.json()) as { error: { code: string } };
      return { status: thrown.status, code: body.error.code, body };
    }
    throw thrown;
  }
  throw new Error("expected a thrown Response");
}

describe("jsonError", () => {
  it("returns a JSON body with code and message and no-store", async () => {
    const res = jsonError(418, "teapot", "Short and stout.", { extra: 1 });
    expect(res.status).toBe(418);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: { code: "teapot", message: "Short and stout.", extra: 1 } });
  });
});

describe("assertSameOrigin", () => {
  const env = { APP_URL: APP };

  it("accepts an Origin that matches APP_URL", () => {
    const r = req(`${APP}/api/x`, { headers: { origin: APP } });
    expect(() => assertSameOrigin(r, env)).not.toThrow();
    expect(isSameOrigin(r, env)).toBe(true);
  });

  it("accepts an Origin that matches the request host (preview deploys)", () => {
    const r = req("https://preview-abc.vercel.app/api/x", {
      headers: { origin: "https://preview-abc.vercel.app", host: "preview-abc.vercel.app" },
    });
    expect(() => assertSameOrigin(r, env)).not.toThrow();
  });

  it("falls back to Referer when Origin is absent", () => {
    const r = req(`${APP}/api/x`, { headers: { referer: `${APP}/app/saved?x=1` } });
    expect(() => assertSameOrigin(r, env)).not.toThrow();
  });

  it("refuses a foreign Origin with 403", async () => {
    const r = req(`${APP}/api/x`, { headers: { origin: "https://evil.example" } });
    const out = await refusal(() => assertSameOrigin(r, env));
    expect(out.status).toBe(403);
    expect(out.code).toBe("bad_origin");
    expect(isSameOrigin(r, env)).toBe(false);
  });

  it("refuses a lookalike host that only shares a suffix", async () => {
    const r = req(`${APP}/api/x`, { headers: { origin: "https://getfunded.ai.evil.example" } });
    expect((await refusal(() => assertSameOrigin(r, env))).code).toBe("bad_origin");
  });

  it("refuses when neither Origin nor Referer is present", async () => {
    const r = req(`${APP}/api/x`);
    const out = await refusal(() => assertSameOrigin(r, env));
    expect(out.status).toBe(403);
    expect(out.code).toBe("missing_origin");
  });

  it('refuses the literal Origin "null"', async () => {
    const r = req(`${APP}/api/x`, { headers: { origin: "null" } });
    expect((await refusal(() => assertSameOrigin(r, env))).code).toBe("missing_origin");
  });

  it("refuses Sec-Fetch-Site: cross-site even with a matching Origin", async () => {
    const r = req(`${APP}/api/x`, { headers: { origin: APP, "sec-fetch-site": "cross-site" } });
    expect((await refusal(() => assertSameOrigin(r, env))).code).toBe("cross_site");
  });

  it("compares hosts, so a scheme difference behind a TLS-terminating proxy is tolerated", () => {
    const r = req("http://getfunded.ai/api/x", { headers: { origin: APP } });
    expect(() => assertSameOrigin(r, env)).not.toThrow();
  });

  it("lists APP_URL, the request URL host and the Host header", () => {
    const r = req("https://a.example/api", { headers: { host: "b.example" } });
    expect([...allowedHosts(r, env)].sort()).toEqual(["a.example", "b.example", "getfunded.ai"]);
  });
});

describe("boundedJson", () => {
  const schema = z.object({ q: z.string().min(1), limit: z.number().int().max(50).optional() });

  function jsonReq(body: string, headers: Record<string, string> = {}): Request {
    return new Request(`${APP}/api/x`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  }

  it("parses a valid body", async () => {
    await expect(boundedJson(jsonReq(JSON.stringify({ q: "food", limit: 10 })), schema)).resolves.toEqual({
      q: "food",
      limit: 10,
    });
  });

  it("accepts a charset parameter on the content type", async () => {
    const r = jsonReq(JSON.stringify({ q: "x" }), { "content-type": "application/json; charset=utf-8" });
    await expect(boundedJson(r, schema)).resolves.toEqual({ q: "x" });
  });

  it("refuses a non-JSON content type with 415", async () => {
    const r = new Request(`${APP}/api/x`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "q=food",
    });
    const out = await refusal(() => boundedJson(r, schema));
    expect(out.status).toBe(415);
  });

  it("refuses a declared Content-Length over the cap with 413", async () => {
    const r = jsonReq(JSON.stringify({ q: "x" }), { "content-length": "999999" });
    const out = await refusal(() => boundedJson(r, schema, 1000));
    expect(out.status).toBe(413);
    expect(out.code).toBe("payload_too_large");
  });

  it("refuses a streamed body over the cap with 413", async () => {
    const big = JSON.stringify({ q: "x".repeat(5000) });
    const out = await refusal(() => boundedJson(jsonReq(big), schema, 1000));
    expect(out.status).toBe(413);
  });

  it("allows a body exactly at the cap", async () => {
    const body = JSON.stringify({ q: "ok" });
    await expect(boundedJson(jsonReq(body), schema, body.length)).resolves.toEqual({ q: "ok" });
  });

  it("refuses invalid JSON with 400", async () => {
    const out = await refusal(() => boundedJson(jsonReq("{not json"), schema));
    expect(out.status).toBe(400);
    expect(out.code).toBe("invalid_json");
  });

  it("refuses a schema mismatch with 400 and issues", async () => {
    const out = await refusal(() => boundedJson(jsonReq(JSON.stringify({ q: "", limit: 500 })), schema));
    expect(out.status).toBe(400);
    expect(out.code).toBe("invalid_body");
    const issues = (out.body as { error: { issues: { path: string }[] } }).error.issues.map((i) => i.path);
    expect(issues).toEqual(expect.arrayContaining(["q", "limit"]));
  });

  it("refuses a missing body with 400", async () => {
    const r = new Request(`${APP}/api/x`, { method: "POST", headers: { "content-type": "application/json" } });
    const out = await refusal(() => boundedJson(r, schema));
    expect(out.status).toBe(400);
    expect(out.code).toBe("empty_body");
  });
});

describe("clientIp", () => {
  const get = (headers: Record<string, string>) => clientIp(new Request(`${APP}/x`, { headers }));

  it("takes the first hop of X-Forwarded-For", () => {
    expect(get({ "x-forwarded-for": "203.0.113.9, 10.0.0.1, 10.0.0.2" })).toBe("203.0.113.9");
  });

  it("trims whitespace and lower-cases IPv6", () => {
    expect(get({ "x-forwarded-for": "  2001:DB8::1 , 10.0.0.1" })).toBe("2001:db8::1");
  });

  it("strips brackets and a port", () => {
    expect(get({ "x-forwarded-for": "[2001:db8::1]:443" })).toBe("2001:db8::1");
    expect(get({ "x-forwarded-for": "203.0.113.9:51234" })).toBe("203.0.113.9");
  });

  it("falls back to X-Real-IP", () => {
    expect(get({ "x-real-ip": "198.51.100.4" })).toBe("198.51.100.4");
  });

  it('returns "unknown" when nothing usable is present', () => {
    expect(get({})).toBe("unknown");
    expect(get({ "x-forwarded-for": "not an ip" })).toBe("unknown");
    expect(get({ "x-forwarded-for": "" })).toBe("unknown");
  });
});
