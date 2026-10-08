// @vitest-environment node
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { OTHER_USER, USER, WS, makeFakeSql, type SqlCall } from "../billing/fake-sql";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/db", () => ({ appDb: undefined, withUser: async () => { throw new Error("real withUser"); } }));

import { hashInviteToken } from "@/lib/settings/invites";
import {
  SettingsError,
  createApiKey,
  createInvite,
  leaveWorkspace,
  listInvites,
  removeMember,
  revokeApiKey,
  softDeleteWorkspace,
  updateOrganization,
} from "@/lib/settings/service";

const ENV = { SELF_HOSTED: "" } as Record<string, string | undefined>;

type Answers = {
  isAdmin?: boolean;
  plan?: string;
  members?: number;
  pendingInvites?: number;
  alreadyMember?: boolean;
  targetRole?: string | null;
  updateReturns?: Record<string, unknown>[];
};

/** A fake database that answers the queries the service makes, by shape. */
function fakeDb(a: Answers = {}) {
  return makeFakeSql((call: SqlCall) => {
    const t = call.text;
    if (t.includes("getfunded.is_admin(")) return [{ ok: a.isAdmin ?? true }];
    if (t.includes("from getfunded.workspaces") && t.includes("plan, settings, billing_anchor_day")) {
      return [{ plan: a.plan ?? "free", settings: {}, billing_anchor_day: 1 }];
    }
    if (t.includes("from getfunded.plan_overrides")) return [];
    if (t.includes("count(*)::int as n from getfunded.members")) return [{ n: a.members ?? 1 }];
    if (t.includes("count(*)::int as n from getfunded.invites")) return [{ n: a.pendingInvites ?? 0 }];
    if (t.includes("join getfunded.users u on u.id = m.user_id") && t.includes("u.email = $")) return a.alreadyMember ? [{ "?column?": 1 }] : [];
    if (t.startsWith("delete from getfunded.invites") && t.includes("email = $")) return [];
    if (t.startsWith("insert into getfunded.invites")) return [{ id: "99999999-9999-4999-8999-999999999999" }];
    if (t.includes("select role from getfunded.members")) return a.targetRole === null ? [] : [{ role: a.targetRole ?? "member" }];
    if (t.startsWith("delete from getfunded.members")) return [{ user_id: call.values[1] }];
    if (t.startsWith("insert into getfunded.api_keys")) return [{ id: "88888888-8888-4888-8888-888888888888" }];
    if (t.startsWith("update")) return a.updateReturns ?? [{ version: 2, id: WS }];
    return [];
  });
}

describe("createInvite", () => {
  it("stores only the sha256 hash of the token, with the role, inviter and a 7-day expiry", async () => {
    const fake = fakeDb({ plan: "pro", members: 1 });
    const now = new Date("2026-10-07T00:00:00Z");
    const created = await createInvite(
      fake.tx,
      { workspaceId: WS, email: "New.Person@Example.org", role: "admin", invitedBy: USER },
      { now, env: ENV },
    );
    expect(created.email).toBe("new.person@example.org");
    expect(created.role).toBe("admin");
    expect(created.expiresAt.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    const insert = fake.find("insert into getfunded.invites")[0];
    expect(insert).toBeDefined();
    expect(insert.values).toContain(hashInviteToken(created.token));
    expect(insert.values).not.toContain(created.token);
    expect(insert.values).toContain("admin");
    expect(insert.values).toContain(USER);
    // The is_admin SQL check ran before any write.
    expect(fake.texts()[0]).toContain("getfunded.is_admin(");
  });

  it("refuses when the plan's seats are full (pending invites count)", async () => {
    const fake = fakeDb({ plan: "pro", members: 2, pendingInvites: 1 });
    await expect(
      createInvite(fake.tx, { workspaceId: WS, email: "x@example.org", role: "member", invitedBy: USER }, { env: ENV }),
    ).rejects.toMatchObject({ code: "seat_limit" });
    expect(fake.find("insert into getfunded.invites")).toHaveLength(0);
  });

  it("refuses on the Free plan's single seat", async () => {
    const fake = fakeDb({ plan: "free", members: 1 });
    const err = await createInvite(fake.tx, { workspaceId: WS, email: "x@example.org", role: "member", invitedBy: USER }, { env: ENV }).catch((e) => e);
    expect(SettingsError.is(err, "seat_limit")).toBe(true);
    expect(String(err.message)).toMatch(/one seat/);
  });

  it("is unlimited on a self-hosted install", async () => {
    const fake = fakeDb({ plan: "free", members: 40 });
    const created = await createInvite(
      fake.tx,
      { workspaceId: WS, email: "x@example.org", role: "member", invitedBy: USER },
      { env: { SELF_HOSTED: "true" } },
    );
    expect(created.id).toBeTruthy();
  });

  it("refuses an email that already belongs to a member, and non-admins", async () => {
    await expect(
      createInvite(fakeDb({ plan: "team", alreadyMember: true }).tx, { workspaceId: WS, email: "x@example.org", role: "member", invitedBy: USER }, { env: ENV }),
    ).rejects.toMatchObject({ code: "already_member" });
    const fake = fakeDb({ isAdmin: false });
    await expect(
      createInvite(fake.tx, { workspaceId: WS, email: "x@example.org", role: "member", invitedBy: USER }, { env: ENV }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(fake.calls).toHaveLength(1);
  });
});

describe("listInvites", () => {
  it("asks only for pending, unexpired invites of the workspace", async () => {
    const fake = fakeDb();
    await listInvites(fake.tx, WS);
    const q = fake.texts()[0];
    expect(q).toContain("accepted_at is null");
    expect(q).toContain("expires_at > now()");
    expect(q).not.toContain("token_hash");
  });
});

describe("removeMember / leaveWorkspace", () => {
  it("removes a member and never the owner", async () => {
    const fake = fakeDb({ targetRole: "member" });
    expect(await removeMember(fake.tx, { workspaceId: WS, actorId: USER, actorRole: "admin", targetId: OTHER_USER })).toBe(true);
    expect(fake.find("delete from getfunded.members")[0].text).toContain("role <> 'owner'");

    await expect(
      removeMember(fakeDb({ targetRole: "owner" }).tx, { workspaceId: WS, actorId: USER, actorRole: "admin", targetId: OTHER_USER }),
    ).rejects.toMatchObject({ code: "owner_protected" });
    await expect(
      removeMember(fakeDb({ targetRole: "admin" }).tx, { workspaceId: WS, actorId: USER, actorRole: "admin", targetId: USER }),
    ).rejects.toMatchObject({ code: "self_remove" });
    await expect(
      removeMember(fakeDb({ targetRole: null }).tx, { workspaceId: WS, actorId: USER, actorRole: "owner", targetId: OTHER_USER }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("the owner cannot leave; others can", async () => {
    await expect(leaveWorkspace(fakeDb({ targetRole: "owner" }).tx, { workspaceId: WS, userId: USER })).rejects.toMatchObject({ code: "owner_protected" });
    expect(await leaveWorkspace(fakeDb({ targetRole: "member" }).tx, { workspaceId: WS, userId: USER })).toBe(true);
  });
});

describe("createApiKey / revokeApiKey", () => {
  it("is refused below Team and never touches the table", async () => {
    const fake = fakeDb({ plan: "pro" });
    await expect(
      createApiKey(fake.tx, { workspaceId: WS, name: "CI", scopes: ["read"], createdBy: USER }, { env: ENV }),
    ).rejects.toMatchObject({ code: "plan_required" });
    expect(fake.find("insert into getfunded.api_keys")).toHaveLength(0);
  });

  it("stores prefix and hash, returns the plaintext once", async () => {
    const fake = fakeDb({ plan: "team" });
    const key = await createApiKey(fake.tx, { workspaceId: WS, name: "CI", scopes: ["read", "write"], createdBy: USER }, { env: ENV });
    expect(key.plaintext).toMatch(/^gf_live_[0-9A-Za-z]{32}$/);
    expect(key.prefix).toBe(key.plaintext.slice(0, 16));
    const insert = fake.find("insert into getfunded.api_keys")[0];
    expect(insert.values).toContain(key.prefix);
    expect(insert.values).not.toContain(key.plaintext);
    expect(insert.values.some((v) => typeof v === "string" && /^[0-9a-f]{64}$/.test(v))).toBe(true);
    expect(insert.values).toContainEqual(["read", "write"]);
  });

  it("revokes by setting revoked_at, scoped to the workspace", async () => {
    const fake = fakeDb({ updateReturns: [{ id: "k" }] });
    expect(await revokeApiKey(fake.tx, { workspaceId: WS, keyId: "88888888-8888-4888-8888-888888888888" })).toBe(true);
    const u = fake.find("update getfunded.api_keys")[0].text;
    expect(u).toContain("revoked_at = now()");
    expect(u).toContain("revoked_at is null");
    expect(fake.texts().some((t) => t.startsWith("delete"))).toBe(false);
  });
});

describe("compare-and-swap updates", () => {
  it("updateOrganization returns the new version, or null when the row moved on", async () => {
    const ok = fakeDb({ updateReturns: [{ version: 5 }] });
    expect(await updateOrganization(ok.tx, { workspaceId: WS, version: 4, name: "Food Bank", profile: { state: "OR" } })).toBe(5);
    const u = ok.find("update getfunded.workspaces")[0];
    expect(u.text).toContain("version = $");
    expect(u.text).toContain("deleted_at is null");
    expect(u.values).toContain(4);

    const stale = fakeDb({ updateReturns: [] });
    expect(await updateOrganization(stale.tx, { workspaceId: WS, version: 3, name: "x", profile: {} })).toBeNull();
  });

  it("softDeleteWorkspace sets deleted_at under CAS and never deletes rows", async () => {
    const fake = fakeDb({ updateReturns: [{ id: WS }] });
    expect(await softDeleteWorkspace(fake.tx, { workspaceId: WS, version: 7 })).toBe(true);
    const u = fake.find("update getfunded.workspaces")[0].text;
    expect(u).toContain("deleted_at = now()");
    expect(u).toContain("deleted_at is null");
    expect(fake.texts().some((t) => t.startsWith("delete"))).toBe(false);
  });
});
