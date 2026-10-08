// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import {
  handleV1Funder,
  handleV1Saved,
  handleV1Search,
  parseIncludes,
  type SavedDeps,
} from "@/app/api/v1/_lib/handlers";
import type { V1AuthDeps } from "@/app/api/v1/_lib/shared";

const KEY_ID = "44444444-4444-4444-8444-444444444444";
const WS = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const principal = { keyId: KEY_ID, workspaceId: WS, name: "CI", scopes: ["read" as const], createdBy: USER as string | null, plan: "team" };

function auth(over: Partial<V1AuthDeps> = {}): V1AuthDeps {
  return {
    requireApiKey: async () => ({ ok: true, principal }),
    withRateLimit: async () => null,
    ...over,
  };
}

const unauthorized = (): V1AuthDeps => ({
  requireApiKey: async () => ({ ok: false, response: Response.json({ error: "unauthorized" }, { status: 401 }) }),
  withRateLimit: async () => null,
});

describe("GET /api/v1/search", () => {
  it("passes the query record to parseSearchParams and returns searchFunders' result as-is", async () => {
    const parseSearchParams = vi.fn((raw: unknown) => ({ parsed: raw }));
    const searchFunders = vi.fn(async () => ({ items: [{ id: ORG }], total: 1, page: 1 }));
    const res = await handleV1Search(new Request("https://x.test/api/v1/search?q=food+bank&state=OR"), { ...auth(), parseSearchParams, searchFunders });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ items: [{ id: ORG }], total: 1, page: 1 });
    expect(parseSearchParams).toHaveBeenCalledWith({ q: "food bank", state: "OR" });
    expect(searchFunders).toHaveBeenCalledWith({ parsed: { q: "food bank", state: "OR" } });
  });

  it("is 401 without a key and never searches", async () => {
    const searchFunders = vi.fn(async () => ({}));
    const res = await handleV1Search(new Request("https://x.test/api/v1/search"), { ...unauthorized(), parseSearchParams: (r) => r, searchFunders });
    expect(res.status).toBe(401);
    expect(searchFunders).not.toHaveBeenCalled();
  });

  it("is 429 when the bucket is empty", async () => {
    const res = await handleV1Search(new Request("https://x.test/api/v1/search"), {
      ...auth({ withRateLimit: async () => Response.json({ error: "rate_limited" }, { status: 429 }) }),
      parseSearchParams: (r) => r,
      searchFunders: async () => ({}),
    });
    expect(res.status).toBe(429);
  });

  it("maps a parse failure to 400, a timeout to 504 and any other failure to 500", async () => {
    const bad = await handleV1Search(new Request("https://x.test/api/v1/search?page=-1"), {
      ...auth(),
      parseSearchParams: () => {
        throw new Error("page must be 1 or more");
      },
      searchFunders: async () => ({}),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_params", message: "page must be 1 or more" });

    const timeout = await handleV1Search(new Request("https://x.test/api/v1/search"), {
      ...auth(),
      parseSearchParams: (r) => r,
      searchFunders: async () => {
        throw Object.assign(new Error("canceled"), { code: "timeout" });
      },
    });
    expect(timeout.status).toBe(504);

    const boom = await handleV1Search(new Request("https://x.test/api/v1/search"), {
      ...auth(),
      parseSearchParams: (r) => r,
      searchFunders: async () => {
        throw new Error("boom");
      },
    });
    expect(boom.status).toBe(500);
    expect((await boom.json()).message).not.toContain("boom");
  });
});

describe("GET /api/v1/funders/{id}", () => {
  it("validates the id, 404s a missing funder, returns the profile", async () => {
    const getFunder = vi.fn(async (id: string) => (id === ORG ? { orgId: ORG, name: "Example Foundation" } : null));
    const base = { ...auth(), getFunder };

    const bad = await handleV1Funder(new Request("https://x.test/api/v1/funders/nope"), "nope", base);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_id");

    const missing = await handleV1Funder(new Request("https://x.test/api/v1/funders/x"), "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", base);
    expect(missing.status).toBe(404);

    const ok = await handleV1Funder(new Request("https://x.test/api/v1/funders/x"), ORG, base);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ funder: { orgId: ORG, name: "Example Foundation" } });
  });

  it("loads includes in parallel, reports unknown names (400) and unavailable loaders", async () => {
    const getFunderGrants = vi.fn(async () => [{ amount: 1000 }]);
    const getFunderFinancials = vi.fn(async () => {
      throw new Error("db");
    });
    const deps = { ...auth(), getFunder: async () => ({ orgId: ORG }), getFunderGrants, getFunderFinancials };

    const unknown = await handleV1Funder(new Request("https://x.test/api/v1/funders/x?include=grants,people"), ORG, deps);
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("invalid_include");

    const res = await handleV1Funder(new Request("https://x.test/api/v1/funders/x?include=grants, financials,officers"), ORG, deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      funder: { orgId: ORG },
      included: { grants: [{ amount: 1000 }], financials: null },
      unavailable: ["financials", "officers"],
    });
    expect(getFunderGrants).toHaveBeenCalledWith(ORG);
  });

  it("parseIncludes de-duplicates and lower-cases", () => {
    expect(parseIncludes("Grants,grants, SIMILAR")).toEqual({ ok: true, includes: ["grants", "similar"] });
    expect(parseIncludes(null)).toEqual({ ok: true, includes: [] });
    expect(parseIncludes("x,grants,y")).toEqual({ ok: false, unknown: ["x", "y"] });
  });

  it("is 401 without a key", async () => {
    const res = await handleV1Funder(new Request("https://x.test/api/v1/funders/x"), ORG, { ...unauthorized(), getFunder: async () => ({}) });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/saved", () => {
  const row = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", org_id: ORG, snapshot: { name: "X" }, stage: "identified", tier: null, owner_id: null, ask_amount: null, next_action: null, next_action_due: null, source_detail: null, tags: [], archived_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", version: 1 };

  function deps(over: Partial<SavedDeps> = {}): SavedDeps {
    return { ...auth(), listSaved: vi.fn(async () => ({ rows: [row], total: 120 })), ...over };
  }

  it("lists as the key's creator with paging defaults and reports has_more", async () => {
    const d = deps();
    const res = await handleV1Saved(new Request("https://x.test/api/v1/saved"), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [row], page: 1, limit: 50, total: 120, has_more: true });
    expect(d.listSaved).toHaveBeenCalledWith({ userId: USER, workspaceId: WS }, { limit: 50, offset: 0, includeArchived: false });
  });

  it("honours page, limit and archived, and rejects out-of-range values", async () => {
    const d = deps();
    const res = await handleV1Saved(new Request("https://x.test/api/v1/saved?page=3&limit=20&archived=true"), d);
    expect(await res.json()).toMatchObject({ page: 3, limit: 20, has_more: true });
    expect(d.listSaved).toHaveBeenCalledWith({ userId: USER, workspaceId: WS }, { limit: 20, offset: 40, includeArchived: true });

    const bad = await handleV1Saved(new Request("https://x.test/api/v1/saved?limit=5000"), deps());
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("invalid_params");
  });

  it("refuses a key whose creator is gone or no longer a member", async () => {
    const gone = await handleV1Saved(new Request("https://x.test/api/v1/saved"), {
      ...deps(),
      requireApiKey: async () => ({ ok: true, principal: { ...principal, createdBy: null } }),
    });
    expect(gone.status).toBe(403);
    expect((await gone.json()).error).toBe("key_owner_missing");

    const notMember = await handleV1Saved(new Request("https://x.test/api/v1/saved"), deps({ listSaved: async () => null }));
    expect(notMember.status).toBe(403);
    expect((await notMember.json()).error).toBe("key_owner_not_member");
  });
});
