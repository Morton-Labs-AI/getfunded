// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));

const dbState: { mode: "ok" | "throw" | "hang" } = { mode: "ok" };
vi.mock("@/lib/billing/db", () => ({
  withUser: async () => { throw new Error("real withUser"); },
  appDb: () => {
    if (dbState.mode === "throw") return Promise.reject(new Error("connection refused"));
    if (dbState.mode === "hang") return new Promise(() => undefined);
    return Promise.resolve([{ ok: 1 }]);
  },
}));

import { GET } from "@/app/api/health/route";
import { dbStatus } from "@/lib/billing/health";
import pkg from "@/package.json";

describe("GET /api/health", () => {
  const saved = { AI_MODE: process.env.AI_MODE, AI_ENABLED: process.env.AI_ENABLED };
  afterEach(() => {
    process.env.AI_MODE = saved.AI_MODE;
    process.env.AI_ENABLED = saved.AI_ENABLED;
    if (saved.AI_MODE === undefined) delete process.env.AI_MODE;
    if (saved.AI_ENABLED === undefined) delete process.env.AI_ENABLED;
    dbState.mode = "ok";
  });

  it("reports ok, version, db and ai mode", async () => {
    delete process.env.AI_MODE;
    delete process.env.AI_ENABLED;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, version: pkg.version, db: "ok", ai: "enabled" });
  });

  it("reports mock and disabled AI modes", async () => {
    process.env.AI_MODE = "mock";
    expect((await (await GET()).json()).ai).toBe("mock");
    delete process.env.AI_MODE;
    process.env.AI_ENABLED = "false";
    expect((await (await GET()).json()).ai).toBe("disabled");
  });

  it("is 503 with db: down when the database fails or hangs past the timeout", async () => {
    dbState.mode = "throw";
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, db: "down" });
    dbState.mode = "hang";
    expect(await dbStatus(20)).toBe("down");
  });
});
