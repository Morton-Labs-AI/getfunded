// @vitest-environment node
/**
 * P1 regression: the steward flag `signup_mode` is enforced where an account
 * is CREATED (ensureProvisioned → assertSignupAllowed), not only in the form.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/app", () => ({
  appDb: undefined,
  withUser: vi.fn(async () => {
    throw new Error("the real withUser must not run here");
  }),
  DbError: class DbError extends Error {},
}));

import type { Flags } from "@/lib/admin/flags";
import { SignupRefusedError, assertSignupAllowed, decideSignup } from "@/lib/auth/signup-gate";

const USER = { id: "7f2d1d5e-5f4c-4b2b-9c1a-2a4e6f8b0c1d", email: "pat@example.org" };
const flags = (signupMode: Flags["signupMode"]): Flags => ({ aiEnabled: true, signupMode, banner: null });

describe("decideSignup", () => {
  it("open admits everyone", () => {
    expect(decideSignup({ mode: "open", exists: false, hasInvite: false })).toBeNull();
    expect(decideSignup({ mode: "open", exists: true, hasInvite: false })).toBeNull();
  });
  it("existing accounts always pass: the gate is about creation, never a lockout", () => {
    expect(decideSignup({ mode: "closed", exists: true, hasInvite: false })).toBeNull();
    expect(decideSignup({ mode: "invite", exists: true, hasInvite: false })).toBeNull();
  });
  it("closed refuses every new account", () => {
    expect(decideSignup({ mode: "closed", exists: false, hasInvite: true })).toBe("signups_closed");
    expect(decideSignup({ mode: "closed", exists: false, hasInvite: false })).toBe("signups_closed");
  });
  it("invite admits a new account only with a pending invitation", () => {
    expect(decideSignup({ mode: "invite", exists: false, hasInvite: true })).toBeNull();
    expect(decideSignup({ mode: "invite", exists: false, hasInvite: false })).toBe("invite_required");
  });
});

describe("assertSignupAllowed", () => {
  it("in open mode reads the flags and nothing else", async () => {
    const userExists = vi.fn(async () => false);
    const hasPendingInvite = vi.fn(async () => false);
    await expect(assertSignupAllowed(USER, { getFlags: async () => flags("open"), userExists, hasPendingInvite })).resolves.toBeUndefined();
    expect(userExists).not.toHaveBeenCalled();
    expect(hasPendingInvite).not.toHaveBeenCalled();
  });

  it("closed: an existing account passes, a new one is refused with signups_closed", async () => {
    await expect(assertSignupAllowed(USER, { getFlags: async () => flags("closed"), userExists: async () => true })).resolves.toBeUndefined();
    const err = (await assertSignupAllowed(USER, { getFlags: async () => flags("closed"), userExists: async () => false }).catch((e: unknown) => e)) as SignupRefusedError;
    expect(err).toBeInstanceOf(SignupRefusedError);
    expect(err).toMatchObject({ code: "signups_closed", status: 403 });
    expect(SignupRefusedError.is(err)).toBe(true);
  });

  it("invite: a new account needs a pending invitation for its email; existing accounts never consult the door", async () => {
    const hasPendingInvite = vi.fn(async (email: string) => email === USER.email);
    await expect(assertSignupAllowed(USER, { getFlags: async () => flags("invite"), userExists: async () => false, hasPendingInvite })).resolves.toBeUndefined();
    expect(hasPendingInvite).toHaveBeenCalledWith(USER.email);

    const err = (await assertSignupAllowed({ ...USER, email: "nobody@example.org" }, { getFlags: async () => flags("invite"), userExists: async () => false, hasPendingInvite }).catch((e: unknown) => e)) as SignupRefusedError;
    expect(err).toMatchObject({ code: "invite_required" });

    hasPendingInvite.mockClear();
    await expect(assertSignupAllowed(USER, { getFlags: async () => flags("invite"), userExists: async () => true, hasPendingInvite })).resolves.toBeUndefined();
    expect(hasPendingInvite).not.toHaveBeenCalled();
  });

  it("the default collaborators query the users row as the user and the 0011 door anonymously", async () => {
    const { withUser } = await import("@/lib/db/app");
    const calls: Array<{ userId: string | null; text: string; values: unknown[] }> = [];
    vi.mocked(withUser).mockImplementation(async (userId, fn) => {
      const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
        const text = strings.join("$").replace(/\s+/g, " ").trim();
        calls.push({ userId, text, values });
        if (text.includes("from getfunded.users")) return Promise.resolve([]);
        if (text.includes("has_pending_invite(")) return Promise.resolve([{ ok: true }]);
        return Promise.resolve([]);
      };
      return fn(sql as never);
    });
    await expect(assertSignupAllowed({ id: USER.id, email: "Pat@Example.org" }, { getFlags: async () => flags("invite") })).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ userId: USER.id, values: [USER.id] });
    expect(calls[0].text).toContain("from getfunded.users where id =");
    expect(calls[1]).toMatchObject({ userId: null, values: ["pat@example.org"] });
    expect(calls[1].text).toContain("getfunded.has_pending_invite(");
  });
});
