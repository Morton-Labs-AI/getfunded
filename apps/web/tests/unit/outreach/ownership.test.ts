// @vitest-environment node
/**
 * Client-supplied foreign ids are checked against the caller's workspace
 * before anything is written:
 *   - lib/outreach/messages saveDraft: savedFunderId and contactId
 *   - lib/ai/fit runFit / lib/ai/research runResearch: savedFunderId (before any credit is reserved)
 *   - lib/workspace/saved updateSavedFunder: ownerId must be a member
 * RLS would hide a stranger's rows from a SELECT, but inserting a foreign id
 * into our own row is not a read, so the checks are explicit.
 */
import { describe, expect, it, vi } from "vitest";
import { OTHER_USER, USER, WS, makeFakeSql, makeFakeWithUser, type SqlCall } from "../billing/fake-sql";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));
vi.mock("@/lib/db/app", () => ({
  appDb: undefined,
  withUser: async () => {
    throw new Error("real withUser");
  },
  DbError: class DbError extends Error {
    code = "unknown";
    static is() {
      return false;
    }
  },
}));
vi.mock("@/lib/outreach/store", () => ({ cancelPendingFollowUps: vi.fn() }));

import { assertOwnsSavedFunder, runFit } from "@/lib/ai/fit";
import { AiFeatureError } from "@/lib/ai/http";
import { runResearch } from "@/lib/ai/research";
import { FOREIGN_CONTACT, FOREIGN_FUNDER } from "@/lib/outreach/messages";
import { updateSavedFunder } from "@/lib/workspace/saved";

const FUNDER = "55555555-5555-4555-8555-555555555555";
const CONTACT = "66666666-6666-4666-8666-666666666666";
const ORG = "77777777-7777-4777-8777-777777777777";
const ctx = { userId: USER, workspaceId: WS };

/** Rows for the two ownership probes; everything else answers `rest`. */
function owning(opts: { funder: boolean; contact: boolean }, rest: (call: SqlCall) => unknown[] = () => []) {
  return makeFakeSql((call) => {
    if (call.text.includes("from getfunded.saved_funders where id = $1")) return opts.funder ? [{ ok: 1 }] : [];
    if (call.text.includes("from getfunded.contacts where id = $1")) return opts.contact ? [{ ok: 1 }] : [];
    return rest(call);
  });
}

describe("saveDraft ownership", () => {
  // messages.ts reads withUser from lib/outreach/db → lib/db/app, mocked above to
  // throw. Exercise the same code through the fake by mocking that seam per test.
  async function withSeam(fake: ReturnType<typeof makeFakeSql>) {
    vi.resetModules();
    const { withUser } = makeFakeWithUser(fake);
    vi.doMock("@/lib/outreach/db", async () => {
      const real = await vi.importActual<typeof import("@/lib/outreach/db")>("@/lib/outreach/db");
      return { ...real, withUser };
    });
    return await import("@/lib/outreach/messages");
  }
  const draft = { savedFunderId: FUNDER, contactId: CONTACT, channel: "email" as const, subject: "Hi", body: "Hello", draftSource: "template" as const };

  it("refuses a foreign contact before any write", async () => {
    const fake = owning({ funder: true, contact: false });
    const m = await withSeam(fake);
    expect(await m.saveDraft(ctx, draft)).toEqual({ ok: false, error: FOREIGN_CONTACT });
    expect(fake.find("insert into getfunded.messages")).toHaveLength(0);
    expect(fake.find("update getfunded.messages")).toHaveLength(0);
  });

  it("refuses a foreign saved funder before the insert", async () => {
    const fake = owning({ funder: false, contact: true });
    const m = await withSeam(fake);
    expect(await m.saveDraft(ctx, draft)).toEqual({ ok: false, error: FOREIGN_FUNDER });
    expect(fake.find("insert into getfunded.messages")).toHaveLength(0);
  });

  it("inserts when both belong to the workspace, scoping each probe to the caller's workspace id", async () => {
    const fake = owning({ funder: true, contact: true }, (call) => (call.text.includes("insert into getfunded.messages") ? [{ id: "m1", version: 1, status: "draft" }] : []));
    const m = await withSeam(fake);
    expect(await m.saveDraft(ctx, draft)).toEqual({ ok: true, id: "m1", version: 1, status: "draft" });
    const probes = fake.calls.filter((c) => c.text.includes("where id = $1::uuid and workspace_id = $2::uuid"));
    expect(probes.map((p) => p.values)).toEqual([[CONTACT, WS], [FUNDER, WS]]);
  });

  it("a draft with no contact only checks the funder", async () => {
    const fake = owning({ funder: true, contact: false }, (call) => (call.text.includes("insert into getfunded.messages") ? [{ id: "m2", version: 1, status: "draft" }] : []));
    const m = await withSeam(fake);
    expect(await m.saveDraft(ctx, { ...draft, contactId: null })).toMatchObject({ ok: true, id: "m2" });
    expect(fake.find("from getfunded.contacts")).toHaveLength(0);
  });
});

describe("fit and research refuse a foreign saved funder before spending credits", () => {
  it("assertOwnsSavedFunder → 404 saved_funder_not_found when the probe finds nothing", async () => {
    const fake = owning({ funder: false, contact: false });
    const { withUser, users } = makeFakeWithUser(fake);
    const err = (await assertOwnsSavedFunder(withUser, ctx, FUNDER).catch((e: unknown) => e)) as AiFeatureError;
    expect(err).toBeInstanceOf(AiFeatureError);
    expect(err).toMatchObject({ code: "saved_funder_not_found", status: 404, extra: { savedFunderId: FUNDER } });
    expect(users).toEqual([USER]);
    expect(fake.calls[0].values).toEqual([FUNDER, WS]);
    await expect(assertOwnsSavedFunder(makeFakeWithUser(owning({ funder: true, contact: false })).withUser, ctx, FUNDER)).resolves.toBeUndefined();
  });

  it("runFit stops at the ownership check: no evidence build, no reservation", async () => {
    const fake = owning({ funder: false, contact: false });
    const { withUser } = makeFakeWithUser(fake);
    const corpus = vi.fn(async () => {
      throw new Error("corpus must not be read for a foreign funder");
    });
    await expect(runFit(ctx, { orgId: ORG, savedFunderId: FUNDER }, { withUser, corpus, env: { AI_MODE: "mock" } })).rejects.toMatchObject({ code: "saved_funder_not_found" });
    expect(corpus).not.toHaveBeenCalled();
    expect(fake.find("reserve_credits(")).toHaveLength(0);
  });

  it("runResearch stops the same way", async () => {
    const fake = owning({ funder: false, contact: false });
    const { withUser } = makeFakeWithUser(fake);
    const corpus = vi.fn(async () => {
      throw new Error("corpus must not be read for a foreign funder");
    });
    await expect(runResearch(ctx, { orgId: ORG, savedFunderId: FUNDER }, { withUser, corpus, env: { AI_MODE: "mock" } })).rejects.toMatchObject({ code: "saved_funder_not_found" });
    expect(corpus).not.toHaveBeenCalled();
    expect(fake.find("reserve_credits(")).toHaveLength(0);
  });
});

describe("updateSavedFunder ownerId must be a workspace member", () => {
  it("refuses a user who is not a member and never updates", async () => {
    const fake = makeFakeSql((call) => (call.text.includes("from getfunded.members") ? [{ ok: false }] : []));
    const { withUser } = makeFakeWithUser(fake);
    const r = await updateSavedFunder(ctx, { id: FUNDER, version: 3, patch: { ownerId: OTHER_USER } }, { withUser });
    expect(r).toEqual({ ok: false, code: "invalid", message: "Pick an owner from this workspace." });
    expect(fake.find("update getfunded.saved_funders")).toHaveLength(0);
    expect(fake.find("from getfunded.members")[0].values).toEqual([WS, OTHER_USER]);
  });

  it("updates when the owner is a member, and clearing the owner needs no probe", async () => {
    const fake = makeFakeSql((call) => {
      if (call.text.includes("from getfunded.members")) return [{ ok: true }];
      if (call.text.includes("update getfunded.saved_funders")) return [{ version: 4 }];
      return [];
    });
    const { withUser } = makeFakeWithUser(fake);
    expect(await updateSavedFunder(ctx, { id: FUNDER, version: 3, patch: { ownerId: OTHER_USER } }, { withUser })).toEqual({ ok: true, version: 4 });
    const cleared = makeFakeSql((call) => (call.text.includes("update getfunded.saved_funders") ? [{ version: 5 }] : []));
    expect(await updateSavedFunder(ctx, { id: FUNDER, version: 4, patch: { ownerId: null } }, { withUser: makeFakeWithUser(cleared).withUser })).toEqual({ ok: true, version: 5 });
    expect(cleared.find("from getfunded.members")).toHaveLength(0);
  });
});
