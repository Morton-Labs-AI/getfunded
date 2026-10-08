// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ACCEPT_INVITE_COPY,
  INVITE_TOKEN_LENGTH,
  INVITE_TOKEN_PATTERN,
  INVITE_TTL_DAYS,
  acceptInviteFailure,
  generateInviteToken,
  hashInviteToken,
  inviteExpiry,
  inviteStatus,
  inviteUrl,
  parseInviteToken,
} from "@/lib/settings/invites";

describe("invite tokens", () => {
  it("mints 43-character base64url tokens with a sha256 hex hash", () => {
    const t = generateInviteToken();
    expect(t.token).toHaveLength(INVITE_TOKEN_LENGTH);
    expect(t.token).toMatch(INVITE_TOKEN_PATTERN);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).toBe(createHash("sha256").update(t.token, "utf8").digest("hex"));
    expect(hashInviteToken(t.token)).toBe(t.hash);
  });

  it("hashes exactly like getfunded.hash_token (sha256 of UTF-8 bytes, hex)", () => {
    // encode(sha256(convert_to('abc', 'UTF8')), 'hex')
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("never repeats", () => {
    const seen = new Set(Array.from({ length: 500 }, () => generateInviteToken().token));
    expect(seen.size).toBe(500);
  });
});

describe("parseInviteToken", () => {
  const token = generateInviteToken().token;
  it("accepts a well-formed token, with whitespace or URL encoding around it", () => {
    expect(parseInviteToken(token)).toBe(token);
    expect(parseInviteToken(`  ${token} `)).toBe(token);
    expect(parseInviteToken(encodeURIComponent(token))).toBe(token);
    expect(parseInviteToken([token, "other"])).toBe(token);
  });
  it("rejects anything else", () => {
    expect(parseInviteToken(null)).toBeNull();
    expect(parseInviteToken(undefined)).toBeNull();
    expect(parseInviteToken("")).toBeNull();
    expect(parseInviteToken(token.slice(0, 42))).toBeNull();
    expect(parseInviteToken(`${token}x`)).toBeNull();
    expect(parseInviteToken(token.replace(/^./, "+"))).toBeNull();
    expect(parseInviteToken("%E0%A4%A")).toBeNull();
    expect(parseInviteToken("' or 1=1 --")).toBeNull();
  });
});

describe("expiry", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  it("expires 7 days after creation by default", () => {
    expect(INVITE_TTL_DAYS).toBe(7);
    expect(inviteExpiry(now).toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(inviteExpiry(now, 1).toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(inviteExpiry(now, 0).toISOString()).toBe("2026-10-14T12:00:00.000Z");
    expect(inviteExpiry(now, Number.NaN).toISOString()).toBe("2026-10-14T12:00:00.000Z");
  });
  it("reports pending, accepted and expired", () => {
    const expires_at = inviteExpiry(now);
    expect(inviteStatus({ expires_at }, now)).toBe("pending");
    expect(inviteStatus({ expires_at: expires_at.toISOString() }, now)).toBe("pending");
    expect(inviteStatus({ expires_at, accepted_at: now }, now)).toBe("accepted");
    expect(inviteStatus({ expires_at }, new Date(expires_at.getTime()))).toBe("expired");
    expect(inviteStatus({ expires_at }, new Date(expires_at.getTime() + 1))).toBe("expired");
    expect(inviteStatus({ expires_at: "not a date" }, now)).toBe("expired");
  });
});

describe("inviteUrl", () => {
  const token = generateInviteToken().token;
  it("joins the app origin and the token, trimming slashes", () => {
    expect(inviteUrl("https://getfunded.ai", token)).toBe(`https://getfunded.ai/invite/${token}`);
    expect(inviteUrl("https://getfunded.ai/", token)).toBe(`https://getfunded.ai/invite/${token}`);
    expect(inviteUrl("", token)).toBe(`/invite/${token}`);
    expect(inviteUrl(null, token)).toBe(`/invite/${token}`);
  });
});

describe("acceptInviteFailure", () => {
  it("maps the door's errors to reasons with copy", () => {
    expect(acceptInviteFailure(new Error("invite_invalid"))).toBe("invalid");
    expect(acceptInviteFailure(new Error("invite_used"))).toBe("used");
    expect(acceptInviteFailure(new Error("invite_expired"))).toBe("expired");
    expect(acceptInviteFailure({ code: "28000", message: "accept_invite: not signed in" })).toBe("not_signed_in");
    expect(acceptInviteFailure({ message: "wrapped", cause: { code: "28000", message: "x" } })).toBe("not_signed_in");
    expect(acceptInviteFailure({ message: "unknown", cause: { message: "invite_used" } })).toBe("used");
    expect(acceptInviteFailure(new Error("connection reset"))).toBe("unknown");
    expect(acceptInviteFailure(null)).toBe("unknown");
    for (const reason of ["invalid", "used", "expired", "not_signed_in", "unknown"] as const) {
      expect(ACCEPT_INVITE_COPY[reason].length).toBeGreaterThan(10);
      expect(ACCEPT_INVITE_COPY[reason]).not.toMatch(/closed/i);
    }
  });
});
