/**
 * A search the database stopped at its statement timeout (SQLSTATE 57014)
 * renders as an empty result with a plain-language notice, not as the error
 * page: timedOutResult (lib/queries/corpus/search.ts) + SearchNotices.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SearchNotices } from "@/components/search/notices";
import { TIMED_OUT_NOTE } from "@/lib/content/copy";
import { timedOutResult } from "@/lib/queries/corpus/search";
import { parseSearchParams } from "@/lib/search/params";

/** The shape postgres.js throws: an Error named PostgresError with a SQLSTATE code. */
function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { name: "PostgresError", code });
}

describe("timedOutResult", () => {
  const params = parseSearchParams({ q: "foundation" });

  it("turns a statement timeout into an empty result with the timed_out notice", () => {
    const out = timedOutResult(pgError("57014", "canceling statement due to statement timeout"), params);
    expect(out).not.toBeNull();
    expect(out?.hits).toEqual([]);
    expect(out?.total).toBe(0);
    expect(out?.notices).toEqual(["timed_out"]);
    expect(out?.params).toBe(params);
  });

  it("returns null for every other failure so the caller rethrows it", () => {
    expect(timedOutResult(pgError("42501", "permission denied"), params)).toBeNull();
    expect(timedOutResult(new Error("connect ECONNREFUSED"), params)).toBeNull();
    expect(timedOutResult("not even an error", params)).toBeNull();
  });
});

describe("SearchNotices", () => {
  it("renders the timed-out notice as a warning with the plain-language copy", () => {
    render(<SearchNotices result={{ notices: ["timed_out"], poolLimit: 0 }} />);
    expect(screen.getByText(TIMED_OUT_NOTE)).toBeInTheDocument();
    expect(TIMED_OUT_NOTE).not.toMatch(/\bclosed\b/i);
    expect(TIMED_OUT_NOTE).not.toMatch(/SQL|statement|57014/);
  });
});
