// @vitest-environment node
import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT, firstParam, isSafeNextPath, safeNextPath, signInPath } from "@/lib/auth/next-path";

describe("safeNextPath", () => {
  it("accepts a relative path, with a query string", () => {
    expect(safeNextPath("/app")).toBe("/app");
    expect(safeNextPath("/app/saved?stage=qualified&x=1")).toBe("/app/saved?stage=qualified&x=1");
    expect(safeNextPath("/funder/abc-123")).toBe("/funder/abc-123");
  });

  it("drops the fragment and trims whitespace", () => {
    expect(safeNextPath("  /app/pipeline#board ")).toBe("/app/pipeline");
  });

  it("falls back for missing or empty input", () => {
    expect(safeNextPath(null)).toBe(DEFAULT_NEXT);
    expect(safeNextPath(undefined)).toBe(DEFAULT_NEXT);
    expect(safeNextPath("")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("   ", "/x")).toBe("/x");
  });

  it("rejects absolute URLs", () => {
    expect(safeNextPath("https://evil.example/app")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("http://evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("javascript:alert(1)")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("mailto:someone@example.org")).toBe(DEFAULT_NEXT);
  });

  it("rejects protocol-relative and backslash tricks", () => {
    expect(safeNextPath("//evil.example/app")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\\evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/\\/evil.example")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("\\\\evil.example")).toBe(DEFAULT_NEXT);
  });

  it("rejects control characters and embedded whitespace", () => {
    expect(safeNextPath("/app\r\nSet-Cookie: x=1")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/app saved")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/app\u0000")).toBe(DEFAULT_NEXT);
  });

  it("rejects paths that would loop back into the auth flow", () => {
    expect(safeNextPath("/signin")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/signin?next=/app")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/signup")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/auth/callback?code=x")).toBe(DEFAULT_NEXT);
    expect(safeNextPath("/auth/signout")).toBe(DEFAULT_NEXT);
    // but not unrelated paths that merely share a prefix
    expect(safeNextPath("/signin-help")).toBe("/signin-help");
    expect(safeNextPath("/authors")).toBe("/authors");
  });

  it("rejects over-long values", () => {
    expect(safeNextPath(`/${"a".repeat(3000)}`)).toBe(DEFAULT_NEXT);
  });

  it("keeps percent-encoded slashes as a plain path", () => {
    expect(safeNextPath("/%2F%2Fevil.example")).toBe("/%2F%2Fevil.example");
  });
});

describe("isSafeNextPath", () => {
  it("mirrors safeNextPath", () => {
    expect(isSafeNextPath("/app/tasks")).toBe(true);
    expect(isSafeNextPath("//evil.example")).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
    expect(isSafeNextPath("/signin")).toBe(false);
  });
});

describe("signInPath", () => {
  it("omits next for the default destination", () => {
    expect(signInPath("/app")).toBe("/signin");
    expect(signInPath(null)).toBe("/signin");
    expect(signInPath("https://evil.example")).toBe("/signin");
  });

  it("encodes a custom destination", () => {
    expect(signInPath("/app/saved?x=1")).toBe("/signin?next=%2Fapp%2Fsaved%3Fx%3D1");
  });
});

describe("firstParam", () => {
  it("returns the first of a repeated param, or null", () => {
    expect(firstParam(["/a", "/b"])).toBe("/a");
    expect(firstParam("/a")).toBe("/a");
    expect(firstParam(undefined)).toBeNull();
    expect(firstParam([])).toBeNull();
  });
});
