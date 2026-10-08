// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  assignableInviteRoles,
  canDeleteWorkspace,
  canEditOrganization,
  canInvite,
  canLeave,
  canManageApiKeys,
  canManageBilling,
  canRemoveMember,
  isAdminRole,
  isMemberRole,
  lowestPlanWith,
  lowestPlanWithSeats,
  seatCheck,
} from "@/lib/settings/roles";

const ME = "22222222-2222-4222-8222-222222222222";
const THEM = "33333333-3333-4333-8333-333333333333";

describe("role predicates", () => {
  it("owners and admins are admins; members and junk are not", () => {
    expect(isAdminRole("owner")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("member")).toBe(false);
    expect(isAdminRole("steward")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isMemberRole("member")).toBe(true);
    expect(isMemberRole("")).toBe(false);
  });

  it("admin-gated capabilities follow isAdminRole", () => {
    for (const fn of [canEditOrganization, canInvite, canManageBilling, canManageApiKeys]) {
      expect(fn("owner")).toBe(true);
      expect(fn("admin")).toBe(true);
      expect(fn("member")).toBe(false);
    }
  });

  it("only the owner deletes; the owner never leaves", () => {
    expect(canDeleteWorkspace("owner")).toBe(true);
    expect(canDeleteWorkspace("admin")).toBe(false);
    expect(canLeave("owner")).toBe(false);
    expect(canLeave("admin")).toBe(true);
    expect(canLeave("member")).toBe(true);
    expect(canLeave("x")).toBe(false);
  });

  it("invites can hand out member or admin, never owner", () => {
    expect(assignableInviteRoles("owner")).toEqual(["member", "admin"]);
    expect(assignableInviteRoles("admin")).toEqual(["member", "admin"]);
    expect(assignableInviteRoles("member")).toEqual([]);
  });
});

describe("canRemoveMember", () => {
  it("an admin removes a member or another admin", () => {
    expect(canRemoveMember({ actorRole: "admin", actorId: ME, targetRole: "member", targetId: THEM })).toEqual({ ok: true });
    expect(canRemoveMember({ actorRole: "owner", actorId: ME, targetRole: "admin", targetId: THEM })).toEqual({ ok: true });
  });
  it("refuses members, self-removal and the owner", () => {
    const member = canRemoveMember({ actorRole: "member", actorId: ME, targetRole: "member", targetId: THEM });
    expect(member.ok).toBe(false);
    const self = canRemoveMember({ actorRole: "admin", actorId: ME, targetRole: "admin", targetId: ME });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.reason).toMatch(/Leave workspace/);
    const owner = canRemoveMember({ actorRole: "admin", actorId: ME, targetRole: "owner", targetId: THEM });
    expect(owner.ok).toBe(false);
    if (!owner.ok) expect(owner.reason).toMatch(/owner/i);
  });
});

describe("seatCheck", () => {
  it("counts members plus pending invites against the plan", () => {
    expect(seatCheck({ limit: 1, members: 1, pendingInvites: 0 })).toEqual({ limit: 1, used: 1, remaining: 0, full: true });
    expect(seatCheck({ limit: 3, members: 1, pendingInvites: 1 })).toEqual({ limit: 3, used: 2, remaining: 1, full: false });
    expect(seatCheck({ limit: 3, members: 2, pendingInvites: 1 })).toEqual({ limit: 3, used: 3, remaining: 0, full: true });
    expect(seatCheck({ limit: 10, members: 12, pendingInvites: 0 }).full).toBe(true);
  });
  it("null is unlimited", () => {
    expect(seatCheck({ limit: null, members: 40, pendingInvites: 5 })).toEqual({ limit: null, used: 45, remaining: null, full: false });
  });
});

describe("plan lookups (from lib/plans.ts, not re-typed here)", () => {
  it("finds the cheapest plan with a feature", () => {
    expect(lowestPlanWith("fit")).toBe("free");
    expect(lowestPlanWith("send_gmail")).toBe("pro");
    expect(lowestPlanWith("api")).toBe("team");
    expect(lowestPlanWith("dedicated_outreach")).toBe("enterprise");
  });
  it("finds the cheapest plan with enough seats", () => {
    expect(lowestPlanWithSeats(1)).toBe("free");
    expect(lowestPlanWithSeats(2)).toBe("pro");
    expect(lowestPlanWithSeats(3)).toBe("pro");
    expect(lowestPlanWithSeats(4)).toBe("team");
    expect(lowestPlanWithSeats(11)).toBe("enterprise");
  });
});
