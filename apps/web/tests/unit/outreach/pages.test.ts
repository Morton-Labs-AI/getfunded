// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  canRunSend,
  composerInitial,
  describeOutcome,
  gmailNotice,
  messageTitle,
  parseQueueTab,
  pickSender,
  toComposerFunder,
  toPanelIdentity,
  uuidParam,
} from "@/app/(app)/app/outreach/helpers";
import type { SenderIdentity } from "@/lib/outreach/types";

const ME = "22222222-2222-4222-8222-222222222222";
const THEM = "33333333-3333-4333-8333-333333333333";
const WS = "44444444-4444-4444-8444-444444444444";

function identity(over: Partial<SenderIdentity>): SenderIdentity {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    workspaceId: WS,
    userId: ME,
    email: "me@example.org",
    displayName: "Me",
    provider: "gmail",
    status: "connected",
    dailyCap: 50,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...over,
  };
}

describe("parseQueueTab", () => {
  it("accepts the four tabs and falls back to drafts", () => {
    expect(parseQueueTab("drafts")).toBe("drafts");
    expect(parseQueueTab("approved")).toBe("approved");
    expect(parseQueueTab("sent")).toBe("sent");
    expect(parseQueueTab("replied")).toBe("replied");
    expect(parseQueueTab("Sent")).toBe("drafts");
    expect(parseQueueTab("")).toBe("drafts");
    expect(parseQueueTab(null)).toBe("drafts");
    expect(parseQueueTab(undefined)).toBe("drafts");
  });
});

describe("uuidParam", () => {
  it("returns a lowercased uuid, or null for anything else", () => {
    expect(uuidParam(ME)).toBe(ME);
    expect(uuidParam(ME.toUpperCase())).toBe(ME);
    expect(uuidParam(` ${ME} `)).toBe(ME);
    expect(uuidParam("not-a-uuid")).toBeNull();
    expect(uuidParam("")).toBeNull();
    expect(uuidParam(null)).toBeNull();
    expect(uuidParam(undefined)).toBeNull();
    expect(uuidParam(`${ME}; drop table`)).toBeNull();
  });
});

describe("composerInitial", () => {
  it("keeps valid values and drops the rest without guessing", () => {
    expect(composerInitial({ contact: ME, template: "introduction", channel: "letter" })).toEqual({
      contactId: ME,
      templateKey: "introduction",
      channel: "letter",
    });
    expect(composerInitial({ contact: "x", template: "", channel: "fax" })).toEqual({ contactId: null, templateKey: null, channel: null });
    expect(composerInitial({})).toEqual({ contactId: null, templateKey: null, channel: null });
  });

  it("accepts a workspace template key and bounds its length", () => {
    expect(composerInitial({ template: `ws:${ME}` }).templateKey).toBe(`ws:${ME}`);
    expect(composerInitial({ template: "a".repeat(121) }).templateKey).toBeNull();
  });
});

describe("canRunSend", () => {
  it("needs the plan gate and at least one connected mailbox", () => {
    expect(canRunSend(false, [identity({})])).toBe(false);
    expect(canRunSend(true, [])).toBe(false);
    expect(canRunSend(true, [identity({ status: "disconnected" })])).toBe(false);
    expect(canRunSend(true, [identity({ status: "error" })])).toBe(false);
    expect(canRunSend(true, [identity({ status: "error" }), identity({ status: "connected" })])).toBe(true);
  });
});

describe("pickSender", () => {
  it("prefers the caller's own connected mailbox, then any connected one", () => {
    const mine = identity({ id: "a", userId: ME });
    const theirs = identity({ id: "b", userId: THEM });
    expect(pickSender([theirs, mine], ME)?.id).toBe("a");
    expect(pickSender([theirs], ME)?.id).toBe("b");
    expect(pickSender([identity({ userId: ME, status: "disconnected" })], ME)).toBeNull();
    expect(pickSender([], ME)).toBeNull();
  });
});

describe("gmailNotice", () => {
  it("says nothing when the URL carries no result", () => {
    expect(gmailNotice(null, null)).toBeNull();
    expect(gmailNotice(undefined, "plan")).toBeNull();
    expect(gmailNotice("something", "plan")).toBeNull();
  });

  it("celebrates a connection and explains each error code in plain words", () => {
    expect(gmailNotice("connected", null)?.tone).toBe("success");
    for (const code of ["plan", "unconfigured", "secrets_key", "denied", "google", "missing_code", "bad_state", "wrong_user", "no_refresh_token", "scope", "reconnect", "upstream", "rate", "not_connected"]) {
      const n = gmailNotice("error", code);
      expect(n?.tone).toBe("error");
      expect(n?.text.length ?? 0).toBeGreaterThan(20);
    }
  });

  it("falls back to the unknown sentence for a code it does not know, and never echoes the code", () => {
    const n = gmailNotice("error", "<script>alert(1)</script>");
    expect(n?.tone).toBe("error");
    expect(n?.text).not.toContain("<script>");
    expect(n?.text).toBe(gmailNotice("error", "unknown")?.text);
    expect(gmailNotice("error", "  PLAN ")?.text).toBe(gmailNotice("error", "plan")?.text);
  });
});

describe("describeOutcome", () => {
  it("reads an accepted outcome, with the reconcile note when set", () => {
    expect(describeOutcome({ outcome: "accepted", providerPayload: {} })).toMatchObject({ tone: "success", title: "Gmail accepted the email" });
    expect(describeOutcome({ outcome: "accepted", providerPayload: { reconciled: true } }).title).toContain("interrupted run");
  });

  it("reads a reply from Gmail and a reply recorded by hand", () => {
    const auto = describeOutcome({ outcome: "replied", providerPayload: { manual: false, from: "Grants <grants@example.org>" } });
    expect(auto.title).toBe("The contact replied");
    expect(auto.detail).toBe("From Grants <grants@example.org>");
    const manual = describeOutcome({ outcome: "replied", providerPayload: { manual: true, via: "call", note: "Asked for a budget", from: "should-not-show" } });
    expect(manual.title).toBe("Reply recorded by hand (call)");
    expect(manual.detail).toBe("Asked for a budget");
    expect(manual.detail).not.toContain("should-not-show");
  });

  it("marks bounces and failures as problems and keeps the failure reason", () => {
    expect(describeOutcome({ outcome: "bounced", providerPayload: {} }).tone).toBe("danger");
    const failed = describeOutcome({ outcome: "failed", providerPayload: { error: "Gmail error: quota" } });
    expect(failed.tone).toBe("danger");
    expect(failed.detail).toBe("Gmail error: quota");
  });

  it("never leaks a token-like payload key", () => {
    const line = describeOutcome({ outcome: "accepted", providerPayload: { access_token: "ya29.secret", provider_message_id: "abc" } });
    expect(JSON.stringify(line)).not.toContain("ya29");
    expect(JSON.stringify(line)).not.toContain("abc");
  });
});

describe("row shaping", () => {
  it("toComposerFunder reads city and state from the snapshot", () => {
    expect(toComposerFunder({ id: "f", orgId: "o", name: "Example Fund", snapshot: { city: "Austin", state: "TX" } })).toEqual({
      id: "f",
      orgId: "o",
      name: "Example Fund",
      city: "Austin",
      state: "TX",
    });
    expect(toComposerFunder({ id: "f", orgId: "o", name: "Example Fund", snapshot: {} })).toMatchObject({ city: null, state: null });
  });

  it("toPanelIdentity flags the caller's own mailbox and carries no token fields", () => {
    const mine = toPanelIdentity(identity({ userId: ME }), ME);
    const theirs = toPanelIdentity(identity({ userId: THEM }), ME);
    expect(mine.isMine).toBe(true);
    expect(theirs.isMine).toBe(false);
    expect(Object.keys(mine).sort()).toEqual(["createdAt", "dailyCap", "displayName", "email", "id", "isMine", "status", "userId", "version"]);
  });

  it("messageTitle prefers the funder, then the subject, then the channel", () => {
    expect(messageTitle({ funderName: "Example Fund", subject: "Hello", channel: "email" }, "Email")).toBe("Example Fund");
    expect(messageTitle({ funderName: "  ", subject: "Hello", channel: "email" }, "Email")).toBe("Hello");
    expect(messageTitle({ funderName: null, subject: null, channel: "letter" }, "Letter")).toBe("Letter");
  });
});
