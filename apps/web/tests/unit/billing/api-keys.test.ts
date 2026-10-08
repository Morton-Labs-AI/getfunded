// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { USER, WS, makeFakeSql } from "./fake-sql";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import {
  API_KEY_PATTERN,
  generateApiKey,
  hashApiKey,
  lookupApiKey,
  parseApiKeyHeader,
  randomBase62,
  requireApiKey,
  verifyApiKey,
} from "@/lib/api/keys";

describe("generateApiKey", () => {
  it("mints gf_live_ + 32 base62 chars, a display prefix and a sha256 hash", () => {
    const k = generateApiKey();
    expect(k.plaintext).toMatch(API_KEY_PATTERN);
    expect(k.plaintext).toHaveLength("gf_live_".length + 32);
    expect(k.prefix).toBe(k.plaintext.slice(0, 16));
    expect(k.prefix.startsWith("gf_live_")).toBe(true);
    expect(k.hash).toBe(createHash("sha256").update(k.plaintext).digest("hex"));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(k.plaintext)).toBe(k.hash);
  });
  it("keys are unique and base62 only", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateApiKey().plaintext));
    expect(seen.size).toBe(200);
    for (const k of seen) expect(k.slice(8)).toMatch(/^[0-9A-Za-z]{32}$/);
    expect(randomBase62(100)).toMatch(/^[0-9A-Za-z]{100}$/);
  });
});

describe("parseApiKeyHeader", () => {
  const key = generateApiKey().plaintext;
  it("accepts Bearer and bare forms, rejects everything else", () => {
    expect(parseApiKeyHeader(`Bearer ${key}`)).toBe(key);
    expect(parseApiKeyHeader(`bearer   ${key}  `)).toBe(key);
    expect(parseApiKeyHeader(key)).toBe(key);
    expect(parseApiKeyHeader(null)).toBeNull();
    expect(parseApiKeyHeader("")).toBeNull();
    expect(parseApiKeyHeader("Bearer sk_live_abc")).toBeNull();
    expect(parseApiKeyHeader(`Bearer ${key}x`)).toBeNull();
    expect(parseApiKeyHeader("Basic dXNlcjpwYXNz")).toBeNull();
  });
});

function doorSql(row: Record<string, unknown> | null) {
  return makeFakeSql((call) => (call.text.includes("getfunded.verify_api_key(") ? (row ? [row] : []) : []));
}

describe("verifyApiKey / lookupApiKey", () => {
  const key = generateApiKey();
  const row = { id: "44444444-4444-4444-8444-444444444444", workspace_id: WS, name: "CI", scopes: ["read"], created_by: USER, plan: "team" };

  it("looks the key up by hash and returns the principal", async () => {
    const fake = doorSql(row);
    const principal = await verifyApiKey(`Bearer ${key.plaintext}`, { sql: fake.sql });
    expect(principal).toEqual({ keyId: row.id, workspaceId: WS, name: "CI", scopes: ["read"], createdBy: USER, plan: "team" });
    expect(fake.calls[0].values).toEqual([key.hash]);
  });

  it("returns null for an unknown key and never queries for a malformed header", async () => {
    expect(await verifyApiKey(`Bearer ${key.plaintext}`, { sql: doorSql(null).sql })).toBeNull();
    const fake = doorSql(row);
    expect(await verifyApiKey("Bearer nope", { sql: fake.sql })).toBeNull();
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses keys on plans without API access", async () => {
    const r = await lookupApiKey(`Bearer ${key.plaintext}`, { sql: doorSql({ ...row, plan: "pro" }).sql, env: { SELF_HOSTED: "" } });
    expect(r.status).toBe("plan_forbidden");
    expect(await verifyApiKey(`Bearer ${key.plaintext}`, { sql: doorSql({ ...row, plan: "pro" }).sql, env: { SELF_HOSTED: "" } })).toBeNull();
  });

  it("resolves the plan through planFor, so a SELF_HOSTED install accepts keys whatever the column says", async () => {
    const env = { SELF_HOSTED: "true" };
    const free = await lookupApiKey(`Bearer ${key.plaintext}`, { sql: doorSql({ ...row, plan: "free" }).sql, env });
    expect(free.status).toBe("ok");
    const pro = await verifyApiKey(`Bearer ${key.plaintext}`, { sql: doorSql({ ...row, plan: "pro" }).sql, env });
    expect(pro?.workspaceId).toBe(WS);
  });

  it("filters unknown scopes", async () => {
    const principal = await verifyApiKey(key.plaintext, { sql: doorSql({ ...row, scopes: ["read", "admin", "write"] }).sql });
    expect(principal?.scopes).toEqual(["read", "write"]);
  });
});

describe("requireApiKey", () => {
  const key = generateApiKey();
  const row = { id: "44444444-4444-4444-8444-444444444444", workspace_id: WS, name: "CI", scopes: ["read"], created_by: USER, plan: "enterprise" };
  const req = (auth?: string) => new Request("https://getfunded.test/api/v1/search", { headers: auth ? { authorization: auth } : {} });

  it("401 without a key, with WWW-Authenticate", async () => {
    const r = await requireApiKey(req(), {}, { sql: doorSql(row).sql });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.response.status).toBe(401);
      expect(r.response.headers.get("www-authenticate")).toContain("Bearer");
    }
  });
  it("401 for an invalid key", async () => {
    const r = await requireApiKey(req(`Bearer ${key.plaintext}`), {}, { sql: doorSql(null).sql });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });
  it("403 for the wrong scope or plan", async () => {
    const r = await requireApiKey(req(`Bearer ${key.plaintext}`), { scope: "write" }, { sql: doorSql(row).sql });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
    const p = await requireApiKey(req(`Bearer ${key.plaintext}`), {}, { sql: doorSql({ ...row, plan: "free" }).sql });
    expect(p.ok).toBe(false);
    if (!p.ok) expect((await p.response.json()).message).toMatch(/Team plan/);
  });
  it("ok with the principal", async () => {
    const r = await requireApiKey(req(`Bearer ${key.plaintext}`), { scope: "read" }, { sql: doorSql(row).sql });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.principal.workspaceId).toBe(WS);
  });
});
