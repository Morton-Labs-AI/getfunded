// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { makeFakeSql } from "./billing/fake-sql";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import { ANON_SEARCH, USER_SEARCH, ipSubject, limit, rateLimitKey, tooManyRequests, userSubject, withRateLimit } from "@/lib/ratelimit";

function bucket(answers: boolean[]) {
  let i = 0;
  return makeFakeSql((call) => (call.text.includes("getfunded.take_token(") ? [{ ok: answers[Math.min(i++, answers.length - 1)] }] : []));
}

describe("presets", () => {
  it("30/min anonymous, 120/min signed in", () => {
    expect(ANON_SEARCH).toEqual({ name: "search", capacity: 30, refillPerSec: 0.5 });
    expect(USER_SEARCH).toEqual({ name: "search", capacity: 120, refillPerSec: 2 });
    expect(rateLimitKey(ANON_SEARCH, "ip:1.2.3.4")).toBe("ip:1.2.3.4:search");
    expect(ipSubject("1.2.3.4")).toBe("ip:1.2.3.4");
    expect(ipSubject("")).toBeNull();
    expect(userSubject("u1")).toBe("user:u1");
  });
});

describe("limit()", () => {
  it("calls take_token with the key, capacity and refill rate", async () => {
    const fake = bucket([true]);
    const r = await limit("ip:1.2.3.4:search", ANON_SEARCH, { sql: fake.sql });
    expect(r).toEqual({ ok: true });
    expect(fake.calls[0].text).toContain("select getfunded.take_token($1, $2, $3) as ok");
    expect(fake.calls[0].values).toEqual(["ip:1.2.3.4:search", 30, 0.5]);
  });
  it("reports retryAfterSec when the bucket is empty", async () => {
    expect(await limit("k", ANON_SEARCH, { sql: bucket([false]).sql })).toEqual({ ok: false, retryAfterSec: 2 });
    expect(await limit("k", USER_SEARCH, { sql: bucket([false]).sql })).toEqual({ ok: false, retryAfterSec: 1 });
  });
  it("validates inputs", async () => {
    await expect(limit("", ANON_SEARCH, { sql: bucket([true]).sql })).rejects.toThrow();
    await expect(limit("k", { capacity: 0, refillPerSec: 1 }, { sql: bucket([true]).sql })).rejects.toThrow();
  });
  it("fails open (and logs) when the database errors, unless told otherwise", async () => {
    const fake = makeFakeSql(() => { throw new Error("db down"); });
    const log = vi.fn();
    expect(await limit("k", ANON_SEARCH, { sql: fake.sql, log })).toEqual({ ok: true });
    expect(log).toHaveBeenCalledWith("take_token failed", expect.objectContaining({ key: "k" }));
    await expect(limit("k", ANON_SEARCH, { sql: fake.sql, log, failOpen: false })).rejects.toThrow("db down");
  });
});

describe("withRateLimit()", () => {
  const req = new Request("https://getfunded.test/api/search?q=food", { headers: { "x-forwarded-for": "203.0.113.9" } });

  it("returns null while tokens remain and a 429 with Retry-After when they run out", async () => {
    const fake = bucket([true, true, false]);
    const keyFn = () => "ip:203.0.113.9";
    expect(await withRateLimit(req, ANON_SEARCH, keyFn, { sql: fake.sql })).toBeNull();
    expect(await withRateLimit(req, ANON_SEARCH, keyFn, { sql: fake.sql })).toBeNull();
    const res = await withRateLimit(req, ANON_SEARCH, keyFn, { sql: fake.sql });
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(429);
    expect(res!.headers.get("retry-after")).toBe("2");
    expect(await res!.json()).toMatchObject({ error: "rate_limited", retryAfterSec: 2 });
    expect(fake.calls.every((c) => c.values[0] === "ip:203.0.113.9:search")).toBe(true);
  });
  it("lets unattributable requests through without touching the bucket", async () => {
    const fake = bucket([false]);
    expect(await withRateLimit(req, ANON_SEARCH, () => null, { sql: fake.sql })).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });
  it("accepts an async key function", async () => {
    const fake = bucket([false]);
    const res = await withRateLimit(req, USER_SEARCH, async () => "user:abc", { sql: fake.sql });
    expect(res?.status).toBe(429);
    expect(fake.calls[0].values).toEqual(["user:abc:search", 120, 2]);
  });
  it("tooManyRequests rounds up and never says 0 seconds", () => {
    expect(tooManyRequests(0.2).headers.get("retry-after")).toBe("1");
    expect(tooManyRequests(2.1).headers.get("retry-after")).toBe("3");
  });
});
