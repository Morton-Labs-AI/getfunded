// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/db/app.ts imports "server-only", which Vite cannot resolve in a test, so
 * the module is replaced wholesale. `ensureProvisioned` also accepts an
 * injected runner, which is what these tests exercise.
 */
vi.mock("@/lib/db/app", () => ({
  withUser: vi.fn(),
  DbError: class DbError extends Error {},
}));

import { ensureProvisioned, type UserRunner } from "@/lib/auth/provision";
import { SignupRefusedError } from "@/lib/auth/signup-gate";

type Call = { strings: string[]; values: unknown[] };

/** The sign-up gate that always admits; the gate itself is tested in signup-gate.test.ts. */
const openGate = async () => {};

/**
 * A fake `sql` tagged template: records every call and returns the rows the
 * test queued. Shaped like postgres.TransactionSql as far as the code under
 * test is concerned.
 */
function fakeRunner(rows: unknown[]) {
  const calls: Call[] = [];
  const setUserIds: (string | null)[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ strings: [...strings], values });
    return Promise.resolve(rows);
  };
  const withUser: UserRunner = async (userId, fn) => {
    setUserIds.push(userId);
    return fn(sql as unknown as Parameters<typeof fn>[0]);
  };
  return { withUser, calls, setUserIds };
}

const USER_ID = "7f2d1d5e-5f4c-4b2b-9c1a-2a4e6f8b0c1d";

describe("ensureProvisioned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the sign-up gate with the normalised email BEFORE touching the database, and refuses when it throws", async () => {
    const runner = fakeRunner([{ user_id: USER_ID, workspace_id: "ws-1", is_new: true }]);
    const gate = vi.fn(async () => {
      throw new SignupRefusedError("invite_required");
    });
    await expect(
      ensureProvisioned({ id: USER_ID, email: "Pat@Example.org", displayName: "Pat" }, { withUser: runner.withUser, gate }),
    ).rejects.toBeInstanceOf(SignupRefusedError);
    expect(gate).toHaveBeenCalledWith({ id: USER_ID, email: "pat@example.org" });
    // provision_user was never called: no account, no workspace, no membership.
    expect(runner.calls).toHaveLength(0);
    expect(runner.setUserIds).toEqual([]);
  });

  it("calls getfunded.provision_user as the user and maps the row", async () => {
    const runner = fakeRunner([{ user_id: USER_ID, workspace_id: "ws-1", is_new: true }]);
    const out = await ensureProvisioned(
      { id: USER_ID, email: "Pat@Example.org", displayName: "  Pat Doe " },
      { withUser: runner.withUser, gate: openGate },
    );

    expect(out).toEqual({ userId: USER_ID, workspaceId: "ws-1", isNew: true });
    expect(runner.setUserIds).toEqual([USER_ID]);
    expect(runner.calls).toHaveLength(1);

    const [call] = runner.calls;
    expect(call!.strings.join("?")).toMatch(/select user_id, workspace_id, is_new\s+from getfunded\.provision_user\(\?::uuid, \?, \?\)/);
    expect(call!.values).toEqual([USER_ID, "pat@example.org", "Pat Doe"]);
  });

  it("passes null for a missing display name and coerces is_new", async () => {
    const runner = fakeRunner([{ user_id: USER_ID, workspace_id: "ws-1", is_new: "f" }]);
    const out = await ensureProvisioned({ id: USER_ID, email: "pat@example.org" }, { withUser: runner.withUser });
    expect(out.isNew).toBe(true); // any non-empty string is truthy; the driver returns real booleans
    expect(runner.calls[0]!.values[2]).toBeNull();

    const runner2 = fakeRunner([{ user_id: USER_ID, workspace_id: "ws-1", is_new: false }]);
    const out2 = await ensureProvisioned(
      { id: USER_ID, email: "pat@example.org", displayName: "" },
      { withUser: runner2.withUser },
    );
    expect(out2.isNew).toBe(false);
    expect(runner2.calls[0]!.values[2]).toBeNull();
  });

  it("throws when the function returns no row", async () => {
    const runner = fakeRunner([]);
    await expect(
      ensureProvisioned({ id: USER_ID, email: "pat@example.org" }, { withUser: runner.withUser }),
    ).rejects.toThrow(/provision_user returned no row/);
  });

  it("validates its input before touching the database", async () => {
    const runner = fakeRunner([{ user_id: USER_ID, workspace_id: "ws-1", is_new: false }]);
    await expect(
      ensureProvisioned({ id: "not-a-uuid", email: "pat@example.org" }, { withUser: runner.withUser }),
    ).rejects.toThrow();
    await expect(
      ensureProvisioned({ id: USER_ID, email: "not an email" }, { withUser: runner.withUser }),
    ).rejects.toThrow();
    expect(runner.calls).toHaveLength(0);
  });

  it("uses the real withUser when no runner is injected", async () => {
    const { withUser } = await import("@/lib/db/app");
    vi.mocked(withUser).mockImplementation(async (_userId, fn) => {
      const sql = () => Promise.resolve([{ user_id: USER_ID, workspace_id: "ws-9", is_new: false }]);
      return fn(sql as unknown as Parameters<typeof fn>[0]);
    });
    const out = await ensureProvisioned({ id: USER_ID, email: "pat@example.org" });
    expect(out.workspaceId).toBe("ws-9");
    expect(withUser).toHaveBeenCalledWith(USER_ID, expect.any(Function));
  });
});
