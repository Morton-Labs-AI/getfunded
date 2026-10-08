// @vitest-environment node
import { describe, expect, it } from "vitest";

import { isMalformedFunderPath } from "@/proxy";

describe("isMalformedFunderPath", () => {
  it("flags /funder/<id> when the id cannot be a funder", () => {
    expect(isMalformedFunderPath("/funder/not-a-real-funder-id")).toBe(true);
    expect(isMalformedFunderPath("/funder/12-3456789")).toBe(true);
    expect(isMalformedFunderPath("/funder/0000")).toBe(true);
    expect(isMalformedFunderPath("/funder/not-a-real-funder-id/")).toBe(true);
  });

  it("lets a UUID through, in either case, with or without a trailing slash", () => {
    expect(isMalformedFunderPath("/funder/00000000-0000-0000-0000-000000000000")).toBe(false);
    expect(isMalformedFunderPath("/funder/6F9619FF-8B86-D011-B42D-00C04FC964FF")).toBe(false);
    expect(isMalformedFunderPath("/funder/6f9619ff-8b86-d011-b42d-00c04fc964ff/")).toBe(false);
  });

  it("ignores every other path, including the JSON API and the workspace page", () => {
    expect(isMalformedFunderPath("/funder")).toBe(false);
    expect(isMalformedFunderPath("/funder/")).toBe(false);
    expect(isMalformedFunderPath("/funder/x/y")).toBe(false);
    expect(isMalformedFunderPath("/api/funders/not-a-uuid")).toBe(false);
    expect(isMalformedFunderPath("/app/funders/not-a-uuid")).toBe(false);
    expect(isMalformedFunderPath("/search")).toBe(false);
  });
});
