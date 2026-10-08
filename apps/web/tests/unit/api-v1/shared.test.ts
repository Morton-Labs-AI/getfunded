// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import { API_V1_KEY_LIMIT, authenticateV1, keySubject, searchParamsRecord, v1Error } from "@/app/api/v1/_lib/shared";
import { rateLimitKey } from "@/lib/ratelimit";

const KEY_ID = "44444444-4444-4444-8444-444444444444";
const principal = { keyId: KEY_ID, workspaceId: "11111111-1111-4111-8111-111111111111", name: "CI", scopes: ["read" as const], createdBy: null, plan: "team" };

describe("API v1 rate limit", () => {
  it("is 600 per minute per key, keyed on the key id (never the plaintext key)", () => {
    expect(API_V1_KEY_LIMIT).toEqual({ name: "api", capacity: 600, refillPerSec: 10 });
    expect(keySubject(KEY_ID)).toBe(`key:${KEY_ID}`);
    expect(rateLimitKey(API_V1_KEY_LIMIT, keySubject(KEY_ID))).toBe(`key:${KEY_ID}:api`);
  });

  it("authenticateV1 checks the key first, then the bucket, and hands the key id to the bucket", async () => {
    const requireApiKey = vi.fn(async () => ({ ok: true as const, principal }));
    const seen: string[] = [];
    const withRateLimit = vi.fn(async (_req: Request, preset: { capacity: number }, keyFn: (r: Request) => string | null | undefined) => {
      seen.push(`${keyFn(_req)}@${preset.capacity}`);
      return null;
    });
    const req = new Request("https://getfunded.test/api/v1/search?q=x", { headers: { authorization: "Bearer gf_live_x" } });
    const r = await authenticateV1(req, { requireApiKey, withRateLimit });
    expect(r).toEqual({ ok: true, principal });
    expect(requireApiKey).toHaveBeenCalledWith(req, { scope: "read" });
    expect(seen).toEqual([`key:${KEY_ID}@600`]);
  });

  it("returns the key layer's response untouched and never consults the bucket for a bad key", async () => {
    const denied = new Response("no", { status: 401 });
    const withRateLimit = vi.fn(async () => null);
    const r = await authenticateV1(new Request("https://x.test"), { requireApiKey: async () => ({ ok: false, response: denied }), withRateLimit });
    expect(r).toEqual({ ok: false, response: denied });
    expect(withRateLimit).not.toHaveBeenCalled();
  });

  it("returns the 429 from the bucket", async () => {
    const limited = new Response("slow down", { status: 429 });
    const r = await authenticateV1(new Request("https://x.test"), {
      requireApiKey: async () => ({ ok: true, principal }),
      withRateLimit: async () => limited,
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
