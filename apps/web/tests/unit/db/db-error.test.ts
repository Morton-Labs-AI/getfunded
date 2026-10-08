// @vitest-environment node
/**
 * DbError maps raw postgres.js errors into codes a route can act on. The
 * module is server-only; vitest resolves `server-only` to Next's empty stub
 * (vitest.config.mts), and the pool is created lazily, so importing it here
 * reads no environment and opens no sockets.
 */
import { describe, expect, it } from "vitest";
import { DbError } from "@/lib/db/app";

function pgError(code: string, message: string, extra: Record<string, unknown> = {}): Error {
  const err = new Error(message) as Error & Record<string, unknown>;
  err.name = "PostgresError";
  err.code = code;
  Object.assign(err, extra);
  return err;
}

describe("DbError.from", () => {
  it("returns non-Postgres errors unchanged (Next.js redirect() must pass through)", () => {
    const plain = new Error("NEXT_REDIRECT");
    expect(DbError.from(plain)).toBe(plain);
    expect(DbError.from("string")).toBe("string");
  });

  it("returns an existing DbError unchanged", () => {
    const e = new DbError("forbidden", "no");
    expect(DbError.from(e)).toBe(e);
  });

  it("maps unique_violation to conflict with the constraint name", () => {
    const e = DbError.from(pgError("23505", "duplicate key", { constraint_name: "ux_saved_funders" }));
    expect(DbError.is(e, "conflict")).toBe(true);
    expect((e as DbError).constraint).toBe("ux_saved_funders");
    expect((e as DbError).pgCode).toBe("23505");
  });

  it("maps insufficient_privilege to forbidden and query_canceled to timeout", () => {
    expect(DbError.is(DbError.from(pgError("42501", "permission denied")), "forbidden")).toBe(true);
    expect(DbError.is(DbError.from(pgError("57014", "canceling statement")), "timeout")).toBe(true);
  });

  it("maps quota_exceeded (P0001) and parses the JSON detail from DETAIL", () => {
    const detail = { scope: "monthly", used: 25, limit: 25, requested: 5, period_end: "2026-11-01" };
    const e = DbError.from(pgError("P0001", "quota_exceeded", { detail: JSON.stringify(detail) }));
    expect(DbError.is(e, "quota_exceeded")).toBe(true);
    expect((e as DbError).detail).toEqual(detail);
  });

  it("also parses the 'quota_exceeded: {json}' message form", () => {
    const e = DbError.from(pgError("P0001", 'quota_exceeded: {"used":3,"limit":3}'));
    expect(DbError.is(e, "quota_exceeded")).toBe(true);
    expect((e as DbError).detail).toEqual({ used: 3, limit: 3 });
  });

  it("maps every other P0001 and unknown SQLSTATE to unknown, keeping the message", () => {
    const stale = DbError.from(pgError("P0001", "stale_version"));
    expect(DbError.is(stale, "unknown")).toBe(true);
    expect((stale as DbError).message).toBe("stale_version");
    const other = DbError.from(pgError("22P02", "invalid input syntax for type uuid"));
    expect((other as DbError).pgCode).toBe("22P02");
  });
});
