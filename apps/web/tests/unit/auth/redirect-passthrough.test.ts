// @vitest-environment node
/**
 * P1 regressions for Next.js control flow:
 *   - every outreach Server Action lets requireWorkspace()'s redirect() reach
 *     Next (it used to be caught and shown as "Something went wrong");
 *   - /api/outreach/send, /api/outreach/sync and /api/integrations/gmail/disconnect
 *     answer 401 JSON to a signed-out caller instead of turning the redirect
 *     into a 500.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/session", () => ({ getUserOrNull: vi.fn() }));
vi.mock("@/lib/workspace/context", () => ({ requireWorkspace: vi.fn() }));
vi.mock("@/lib/db/app", () => ({
  appDb: undefined,
  withUser: vi.fn(),
  DbError: class DbError extends Error {
    code = "unknown";
    static is() {
      return false;
    }
  },
}));
vi.mock("@/lib/billing/meter", () => ({
  AiDisabledError: class AiDisabledError extends Error {},
  QuotaExceededError: class QuotaExceededError extends Error {},
  aiMode: () => "mock",
}));
vi.mock("@/lib/ratelimit", () => ({ withRateLimit: vi.fn(async () => null), userSubject: (id: string) => `user:${id}` }));
vi.mock("@/lib/outreach/contacts", () => ({ copyFilingContact: vi.fn(), createContact: vi.fn(), deleteContact: vi.fn(), updateContact: vi.fn() }));
vi.mock("@/lib/outreach/boilerplate", () => ({ deleteWorkspaceTemplate: vi.fn(), saveWorkspaceTemplate: vi.fn() }));
vi.mock("@/lib/outreach/deps", () => ({ getFilingChannels: vi.fn(), getFunder: vi.fn(), polishDraft: vi.fn() }));
vi.mock("@/lib/outreach/funders", () => ({ getSavedFunderOption: vi.fn() }));
vi.mock("@/lib/outreach/gate", () => ({ outreachAbilities: vi.fn(() => ({ sendGmail: false })) }));
vi.mock("@/lib/outreach/messages", () => ({
  approveMessage: vi.fn(),
  cancelMessage: vi.fn(),
  createFollowUp: vi.fn(),
  latestDossier: vi.fn(),
  recordByHand: vi.fn(),
  recordReplyByHand: vi.fn(),
  reopenMessage: vi.fn(),
  retryMessage: vi.fn(),
  saveDraft: vi.fn(),
}));
vi.mock("@/lib/outreach/senders", () => ({
  sendableIdentities: vi.fn(),
  updateDailyCap: vi.fn(),
  disconnectGmail: vi.fn(),
  getSenderIdentity: vi.fn(),
  mySenderIdentity: vi.fn(),
}));
vi.mock("@/lib/outreach/suppressions", () => ({ addSuppression: vi.fn(), removeSuppression: vi.fn() }));
vi.mock("@/lib/outreach/run", () => ({
  OutreachRunError: class OutreachRunError extends Error {
    code = "x";
    status = 400;
  },
  runSendForCaller: vi.fn(async () => ({ reports: [] })),
  runSyncForCaller: vi.fn(async () => ({ reports: [] })),
}));

import { redirect } from "next/navigation";

import * as actions from "@/app/(app)/app/outreach/actions";
import { POST as disconnectPost } from "@/app/api/integrations/gmail/disconnect/route";
import { POST as sendPost } from "@/app/api/outreach/send/route";
import { POST as syncPost } from "@/app/api/outreach/sync/route";
import { getUserOrNull } from "@/lib/auth/session";
import { saveDraft } from "@/lib/outreach/messages";
import { requireWorkspace } from "@/lib/workspace/context";

const USER = { id: "22222222-2222-4222-8222-222222222222", email: "pat@example.org", displayName: "Pat" };
const WS = { id: "11111111-1111-4111-8111-111111111111", slug: "ws", name: "Food Bank", plan: "pro", profile: {}, settings: {}, role: "owner", version: 1 };
const FUNDER = "55555555-5555-4555-8555-555555555555";
const MSG = "66666666-6666-4666-8666-666666666666";

/** The very error Next's redirect() throws (digest NEXT_REDIRECT;...). */
function redirectError(path = "/signin"): Error & { digest: string } {
  try {
    redirect(path);
  } catch (err) {
    return err as Error & { digest: string };
  }
  throw new Error("redirect() did not throw");
}

const isRedirect = (err: unknown) => typeof (err as { digest?: unknown })?.digest === "string" && /^NEXT_REDIRECT/.test((err as { digest: string }).digest);

describe("outreach Server Actions let redirect() through", () => {
  const cases: Array<[string, (input: unknown) => Promise<unknown>, unknown]> = [
    ["saveDraftAction", actions.saveDraftAction, { savedFunderId: FUNDER, body: "Hello" }],
    ["polishDraftAction", actions.polishDraftAction, { savedFunderId: FUNDER, subject: "Hi", body: "Hello there" }],
    ["approveMessageAction", actions.approveMessageAction, { id: MSG, version: 1 }],
    ["cancelMessageAction", actions.cancelMessageAction, { id: MSG, version: 1 }],
    ["reopenMessageAction", actions.reopenMessageAction, { id: MSG, version: 1 }],
    ["retryMessageAction", actions.retryMessageAction, { id: MSG, version: 1 }],
    ["recordReplyAction", actions.recordReplyAction, { id: MSG }],
    ["createFollowUpAction", actions.createFollowUpAction, { parentId: MSG }],
    ["createContactAction", actions.createContactAction, { savedFunderId: FUNDER, fullName: "Program Officer" }],
    ["deleteContactAction", actions.deleteContactAction, { id: MSG }],
    ["copyFilingContactAction", actions.copyFilingContactAction, { savedFunderId: FUNDER, channelId: "c1" }],
    ["addSuppressionAction", actions.addSuppressionAction, { kind: "email", value: "no@example.org" }],
    ["removeSuppressionAction", actions.removeSuppressionAction, { kind: "email", value: "no@example.org" }],
    ["saveTemplateAction", actions.saveTemplateAction, { name: "Intro", subject: "Hi", body: "Hello" }],
    ["deleteTemplateAction", actions.deleteTemplateAction, { id: MSG }],
  ];

  for (const [name, action, input] of cases) {
    it(`${name}: a signed-out caller is redirected, not shown "Something went wrong"`, async () => {
      vi.mocked(requireWorkspace).mockRejectedValueOnce(redirectError());
      const out = await action(input).then(
        (v) => ({ resolved: v }),
        (e: unknown) => ({ rejected: e }),
      );
      if ("resolved" in out) {
        // Only an input-validation refusal may resolve before the caller check.
        expect(out.resolved).toMatchObject({ ok: false });
        expect((out.resolved as { error: string }).error).not.toMatch(/something went wrong/i);
        expect(requireWorkspace).not.toHaveBeenCalled();
      } else {
        expect(isRedirect(out.rejected), `${name} swallowed the redirect`).toBe(true);
      }
      vi.mocked(requireWorkspace).mockReset();
    });
  }

  it("a redirect thrown INSIDE the try (by the data layer) is rethrown too, while ordinary errors become copy", async () => {
    vi.mocked(requireWorkspace).mockResolvedValue({ user: USER, workspace: WS } as never);
    vi.mocked(saveDraft).mockRejectedValueOnce(redirectError("/app"));
    await expect(actions.saveDraftAction({ savedFunderId: FUNDER, body: "Hello" })).rejects.toSatisfy(isRedirect);

    vi.mocked(saveDraft).mockRejectedValueOnce(new Error("connection reset"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(actions.saveDraftAction({ savedFunderId: FUNDER, body: "Hello" })).resolves.toEqual({
      ok: false,
      error: "Something went wrong. Try again in a moment.",
    });
    spy.mockRestore();
  });
});

describe("outreach and Gmail route handlers answer 401 to a signed-out caller", () => {
  const post = (path: string, body: unknown = {}) =>
    new Request(`https://getfunded.test${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://getfunded.test" },
      body: JSON.stringify(body),
    });

  for (const [name, handler, path] of [
    ["send", sendPost, "/api/outreach/send"],
    ["sync", syncPost, "/api/outreach/sync"],
    ["gmail disconnect", disconnectPost, "/api/integrations/gmail/disconnect"],
  ] as const) {
    it(`${name}: 401 sign_in_required, requireWorkspace never called`, async () => {
      vi.mocked(getUserOrNull).mockResolvedValueOnce(null);
      vi.mocked(requireWorkspace).mockReset();
      const res = await handler(post(path));
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: "sign_in_required" } });
      expect(requireWorkspace).not.toHaveBeenCalled();
    });

    it(`${name}: a redirect from requireWorkspace propagates instead of becoming a 500`, async () => {
      vi.mocked(getUserOrNull).mockResolvedValueOnce(USER);
      vi.mocked(requireWorkspace).mockRejectedValueOnce(redirectError());
      await expect(handler(post(path))).rejects.toSatisfy(isRedirect);
    });

    it(`${name}: a cross-site request is still refused with 403 before anything else`, async () => {
      vi.mocked(getUserOrNull).mockReset();
      const res = await handler(
        new Request(`https://getfunded.test${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" }),
      );
      expect(res.status).toBe(403);
      expect(getUserOrNull).not.toHaveBeenCalled();
    });
  }

  it("send: a signed-in owner gets through to the runner", async () => {
    vi.mocked(getUserOrNull).mockResolvedValueOnce(USER);
    vi.mocked(requireWorkspace).mockResolvedValueOnce({ user: USER, workspace: WS } as never);
    const res = await sendPost(post("/api/outreach/send", { limit: 5 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
