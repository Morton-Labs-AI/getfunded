// @vitest-environment node
/**
 * requireWorkspace() (lib/workspace/context.ts): a live session with no
 * account behind it (the sign-up gate refused to create one) is sent to
 * /signin?error=<code>, where the page explains and offers sign-out, instead
 * of surfacing as an error page. Other provisioning failures still throw.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() })),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/auth/provision", () => ({ ensureProvisioned: vi.fn() }));
vi.mock("@/lib/db/app", () => ({
  appDb: undefined,
  withUser: vi.fn(),
  DbError: class DbError extends Error {},
}));

import { ensureProvisioned } from "@/lib/auth/provision";
import { requireUser } from "@/lib/auth/session";
import { SignupRefusedError } from "@/lib/auth/signup-gate";
import { withUser } from "@/lib/db/app";
import { requireWorkspace, signupRefusedPath } from "@/lib/workspace/context";

const USER = { id: "22222222-2222-4222-8222-222222222222", email: "pat@example.org", displayName: "Pat" };
const WS_ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "food-bank",
  name: "Food Bank",
  plan: "free",
  profile: {},
  settings: {},
  role: "owner",
  version: 1,
};

type RedirectError = Error & { digest?: string };

const redirectDigest = (err: unknown): string => {
  const digest = (err as RedirectError)?.digest;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT")) throw new Error(`not a redirect: ${String(err)}`);
  return digest;
};

/** A `withUser` whose `sql` tag resolves every statement to `rows` (nested fragments are never awaited). */
function fakeWithUser(rows: unknown[]) {
  const sql = (() => Promise.resolve(rows)) as unknown;
  return vi.fn(async (_userId: string | null, fn: (sql: never) => Promise<unknown>) => fn(sql as never));
}

describe("requireWorkspace and the sign-up gate", () => {
  it("redirects to /signin?error=<code> when the account was refused (signups_closed)", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(USER);
    vi.mocked(ensureProvisioned).mockRejectedValueOnce(new SignupRefusedError("signups_closed"));
    vi.mocked(withUser).mockReset();

    const err = await requireWorkspace().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect(redirectDigest(err)).toContain("/signin?error=signups_closed");
    expect(withUser).not.toHaveBeenCalled();
  });

  it("carries the invite_required code too", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(USER);
    vi.mocked(ensureProvisioned).mockRejectedValueOnce(new SignupRefusedError("invite_required"));
    const err = await requireWorkspace().then(
      () => null,
      (e: unknown) => e,
    );
    expect(redirectDigest(err)).toContain(signupRefusedPath("invite_required"));
    expect(signupRefusedPath("invite_required")).toBe("/signin?error=invite_required");
  });

  it("lets any other provisioning failure through unchanged", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(USER);
    const boom = new Error("getfunded.provision_user returned no row");
    vi.mocked(ensureProvisioned).mockRejectedValueOnce(boom);
    await expect(requireWorkspace()).rejects.toBe(boom);
  });

  it("returns the user and their first workspace when provisioning succeeds", async () => {
    vi.mocked(requireUser).mockResolvedValueOnce(USER);
    vi.mocked(ensureProvisioned).mockResolvedValueOnce({ userId: USER.id, workspaceId: WS_ROW.id, isNew: false });
    vi.mocked(withUser).mockImplementation(fakeWithUser([WS_ROW]) as never);

    const out = await requireWorkspace();
    expect(out.user).toEqual(USER);
    expect(out.workspace).toMatchObject({ id: WS_ROW.id, slug: "food-bank", plan: "free", role: "owner", version: 1 });
    expect(withUser).toHaveBeenCalledWith(USER.id, expect.any(Function));
  });
});
