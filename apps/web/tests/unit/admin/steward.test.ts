// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { decideSteward, resolveSteward } from "@/lib/admin/steward";

const ENV = { ADMIN_EMAILS: "Steward@Example.org, ops@example.org" };
const user = (email: string) => ({ id: "22222222-2222-4222-8222-222222222222", email, displayName: null });

describe("decideSteward", () => {
  it("allows a listed email even before the database flag is set, and asks for the claim", () => {
    const d = decideSteward({ email: "steward@example.org", flagged: false }, ENV);
    expect(d).toEqual({
      allowed: true,
      listed: true,
      flagged: false,
      needsClaim: true,
      claimEmails: ["steward@example.org", "ops@example.org"],
    });
  });

  it("refuses a flagged user who is NOT listed while ADMIN_EMAILS is set (the list is the source of truth; no sticky access)", () => {
    const d = decideSteward({ email: "nobody@example.org", flagged: true }, ENV);
    expect(d).toMatchObject({ allowed: false, listed: false, flagged: true, needsClaim: false, claimEmails: [] });
  });

  it("allows a flagged user only when the operator keeps no ADMIN_EMAILS list at all", () => {
    expect(decideSteward({ email: "nobody@example.org", flagged: true }, { ADMIN_EMAILS: "" })).toMatchObject({ allowed: true, listed: false, flagged: true });
    expect(decideSteward({ email: "nobody@example.org", flagged: true }, {})).toMatchObject({ allowed: true });
    expect(decideSteward({ email: "nobody@example.org", flagged: true }, { ADMIN_EMAILS: " , " })).toMatchObject({ allowed: true });
  });

  it("someone removed from ADMIN_EMAILS loses access even though claim_steward left their flag set", async () => {
    const claim = vi.fn(async () => true);
    const s = await resolveSteward(user("former@example.org"), { readFlag: async () => true, claim, env: ENV });
    expect(s).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });

  it("refuses an unlisted, unflagged user and a user with no row", () => {
    expect(decideSteward({ email: "nobody@example.org", flagged: false }, ENV).allowed).toBe(false);
    expect(decideSteward({ email: "nobody@example.org", flagged: null }, ENV).allowed).toBe(false);
  });

  it("matches emails case-insensitively and ignores whitespace in ADMIN_EMAILS", () => {
    expect(decideSteward({ email: "OPS@example.org", flagged: null }, ENV).listed).toBe(true);
    expect(decideSteward({ email: "ops@example.org", flagged: null }, { ADMIN_EMAILS: "" }).allowed).toBe(false);
    expect(decideSteward({ email: "ops@example.org", flagged: null }, {}).allowed).toBe(false);
  });
});

describe("resolveSteward", () => {
  it("runs the claim once for a listed user whose flag is false and reports the result", async () => {
    const readFlag = vi.fn(async () => false);
    const claim = vi.fn(async () => true);
    const s = await resolveSteward(user("steward@example.org"), { readFlag, claim, env: ENV });
    expect(s).toEqual({ user: user("steward@example.org"), listed: true, flagged: true });
    expect(claim).toHaveBeenCalledWith(user("x").id, ["steward@example.org", "ops@example.org"]);
  });

  it("does not claim when the flag is already true", async () => {
    const claim = vi.fn(async () => true);
    const s = await resolveSteward(user("steward@example.org"), { readFlag: async () => true, claim, env: ENV });
    expect(s?.flagged).toBe(true);
    expect(claim).not.toHaveBeenCalled();
  });

  it("returns null for a non-steward without touching the claim door", async () => {
    const claim = vi.fn(async () => true);
    const s = await resolveSteward(user("member@example.org"), { readFlag: async () => false, claim, env: ENV });
    expect(s).toBeNull();
    expect(claim).not.toHaveBeenCalled();
  });

  it("still admits a listed steward when the flag read or the claim throws, with flagged=false", async () => {
    const s = await resolveSteward(user("ops@example.org"), {
      readFlag: async () => {
        throw new Error("db down");
      },
      claim: async () => {
        throw new Error("db down");
      },
      env: ENV,
    });
    expect(s).toEqual({ user: user("ops@example.org"), listed: true, flagged: false });
  });
});
