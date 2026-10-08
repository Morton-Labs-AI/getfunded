// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import { API_V1_IP_LIMIT, API_V1_KEY_LIMIT, addressSubject, authenticateV1, keySubject, searchParamsRecord, v1Error } from "@/app/api/v1/_lib/shared";
import { rateLimitKey, type RateLimitPreset } from "@/lib/ratelimit";

const KEY_ID = "44444444-4444-4444-8444-444444444444";
const principal = { keyId: KEY_ID, workspaceId: "11111111-1111-4111-8111-111111111111", name: "CI", scopes: ["read" as const], createdBy: null, plan: "team" };
const TRUSTED = { TRUST_PROXY: "true" };

describe("API v1 rate limit", () => {
  it("is 600 per minute per key, keyed on the key id (never the plaintext key)", () => {
    expect(API_V1_KEY_LIMIT).toEqual({ name: "api", capacity: 600, refillPerSec: 10 });
    expect(keySubject(KEY_ID)).toBe(`key:${KEY_ID}`);
    expect(rateLimitKey(API_V1_KEY_LIMIT, keySubject(KEY_ID))).toBe(`key:${KEY_ID}:api`);
  });

  it("the per-address bucket is wider than the per-key bucket and never yields a null subject", () => {
    expect(API_V1_IP_LIMIT.capacity).toBeGreaterThan(API_V1_KEY_LIMIT.capacity);
    expect(API_V1_IP_LIMIT.refillPerSec).toBeGreaterThan(API_V1_KEY_LIMIT.refillPerSec);
    expect(API_V1_IP_LIMIT.name).not.toBe(API_V1_KEY_LIMIT.name);
    expect(addressSubject(new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.9" } }), TRUSTED)).toBe("ip:203.0.113.9");
    // Unattributable requests share one bucket instead of bypassing the limit.
    expect(addressSubject(new Request("https://x.test"), TRUSTED)).toBe("ip:unknown");
    expect(addressSubject(new Request("https://x.test", { headers: { "x-forwarded-for": "203.0.113.9" } }), {})).toBe("ip:unknown");
  });

  it("authenticateV1 takes the address bucket BEFORE the key check, then the key, then the per-key bucket", async () => {
    const order: string[] = [];
    const requireApiKey = vi.fn(async () => {
      order.push("key");
      return { ok: true as const, principal };
    });
    const withRateLimit = vi.fn(async (_req: Request, preset: { capacity: number }, keyFn: (r: Request) => string | null | undefined) => {
      order.push(`${keyFn(_req)}@${preset.capacity}`);
      return null;
    });
    const req = new Request("https://getfunded.test/api/v1/search?q=x", { headers: { authorization: "Bearer gf_live_x", "x-forwarded-for": "203.0.113.9" } });
    const r = await authenticateV1(req, { requireApiKey, withRateLimit, env: TRUSTED });
    expect(r).toEqual({ ok: true, principal });
    expect(requireApiKey).toHaveBeenCalledWith(req, { scope: "read" });
    expect(order).toEqual([`ip:203.0.113.9@${API_V1_IP_LIMIT.capacity}`, "key", `key:${KEY_ID}@600`]);
  });

  it("an exhausted address bucket answers 429 without ever consulting the key door", async () => {
    const limited = new Response("slow down", { status: 429 });
    const requireApiKey = vi.fn(async () => ({ ok: true as const, principal }));
    const r = await authenticateV1(new Request("https://x.test"), { requireApiKey, withRateLimit: async () => limited, env: TRUSTED });
    expect(r).toEqual({ ok: false, response: limited });
    expect(requireApiKey).not.toHaveBeenCalled();
  });

  it("returns the key layer's response untouched and never consults the per-key bucket for a bad key", async () => {
    const denied = new Response("no", { status: 401 });
    const withRateLimit = vi.fn<(req: Request, preset: RateLimitPreset, keyFn: unknown) => Promise<Response | null>>(async () => null);
    const r = await authenticateV1(new Request("https://x.test"), { requireApiKey: async () => ({ ok: false, response: denied }), withRateLimit, env: TRUSTED });
    expect(r).toEqual({ ok: false, response: denied });
    // Only the address bucket ran.
    expect(withRateLimit).toHaveBeenCalledTimes(1);
    expect(withRateLimit.mock.calls[0]?.[1]).toBe(API_V1_IP_LIMIT);
  });

  it("returns the 429 from the per-key bucket", async () => {
    const limited = new Response("slow down", { status: 429 });
    let calls = 0;
    const r = await authenticateV1(new Request("https://x.test"), {
      requireApiKey: async () => ({ ok: true, principal }),
      withRateLimit: async () => (calls++ === 0 ? null : limited),
      env: TRUSTED,
    });
    expect(r).toEqual({ ok: false, response: limited });
  });
});

describe("v1Error / searchParamsRecord", () => {
  it("uses the flat error envelope with no-store", async () => {
    const res = v1Error(404, "not_found", "Nope.", { hint: "x" });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(await res.json()).toEqual({ error: "not_found", message: "Nope.", hint: "x" });
  });

  it("turns repeated query keys into arrays and single keys into strings", () => {
    const url = new URL("https://x.test/api/v1/search?q=food&type=private_foundation&type=public_charity&page=2");
    expect(searchParamsRecord(url)).toEqual({ q: "food", type: ["private_foundation", "public_charity"], page: "2" });
  });
});
