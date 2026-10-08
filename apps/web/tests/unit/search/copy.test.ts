// @vitest-environment node
/**
 * The honesty rules for the shared product copy (lib/content/copy.ts).
 * Every exported string and every string a copy function returns is checked:
 * "closed" never describes a posture, "$0" and "N/A" never stand in for a
 * missing value, and no drifting number is hard-coded.
 */
import { describe, expect, it } from "vitest";

import * as copy from "@/lib/content/copy";

/** Every string the module exports, including what its functions return for a sample input. */
function allStrings(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [name, value] of Object.entries(copy)) {
    if (typeof value === "string") out.push([name, value]);
    else if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      for (const args of [[400], [400, 1200, true], [12], [null], [45], [2023, "990-PF"], [0, 0, false]]) {
        try {
          const r = fn(...args);
          if (typeof r === "string") out.push([`${name}(${args.join(",")})`, r]);
        } catch {
          /* a signature this sample does not fit */
        }
      }
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "string") out.push([`${name}.${k}`, v]);
      }
    }
  }
  return out;
}

describe("lib/content/copy honesty invariants", () => {
  const strings = allStrings();

  it("exports something to check", () => {
    expect(strings.length).toBeGreaterThan(30);
  });

  it('never calls a funder "closed" (the word may only appear in a denial of it)', () => {
    for (const [name, s] of strings) {
      if (!/closed/i.test(s)) continue;
      // Allowed: "not closed", "not the same as closed", "never ... closed".
      const sentences = s.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        if (!/closed/i.test(sentence)) continue;
        expect(sentence, `${name}: "${sentence}"`).toMatch(/\b(not|never)\b[^.]*\bclosed\b/i);
      }
    }
  });

  it('never writes "$0" or "N/A" for a missing value', () => {
    for (const [name, s] of strings) {
      expect(s, name).not.toMatch(/\bN\/A\b/);
      if (/\$0\b/.test(s)) {
        // The one legitimate "$0" is the sentence that says a REAL zero shows as $0.
        expect(s, name).toMatch(/real zero/i);
      }
    }
  });

  it("never hard-codes a corpus count or percentage", () => {
    for (const [name, s] of strings) {
      if (name.includes("(")) continue; // function output echoes its sample arguments
      expect(s, name).not.toMatch(/\b\d{1,3}(,\d{3})+\b/); // 2,300,000-style counts
      expect(s, name).not.toMatch(/\b\d+(\.\d+)?\s?(million|thousand|M|k)\b/i);
      expect(s, name).not.toMatch(/\b\d+\s?%/);
    }
  });

  it("explains the search modes and the short-name rule in plain words", () => {
    expect(copy.NAME_TOO_SHORT_NOTE).toBe("Type at least three letters of the name so we can match it.");
    expect(copy.NAME_TOO_SHORT_NOTE).not.toMatch(/index/i);
    expect(copy.SEARCH_MODE_LABELS.thesis).toBe("Describe the work");
  });

  it("names the IRS master file in plain words with the full name available once", () => {
    expect(copy.IRS_MASTER_FILE_LABEL).toBe("IRS master file");
    expect(copy.IRS_MASTER_FILE_FULL_NAME).toMatch(/Business Master File/);
    expect(copy.BMF_SNAPSHOT_NOTE).toMatch(/IRS master file/);
  });

  it("explains Part XV once and keeps the posture explainers honest about absence", () => {
    expect(copy.HOW_TO_APPLY_NOTE).toMatch(/Part XV \(the section where/);
    expect(copy.PART_XV_FREE_TEXT_NOTE).not.toMatch(/Part XV/);
    expect(copy.POSTURE_EXPLAINERS.unknown).toMatch(/not the same as closed/i);
    expect(copy.POSTURE_EXPLAINERS.unknown).not.toMatch(/\bis closed\b/i);
  });

  it("formats pool and count notes with grouped numbers", () => {
    expect(copy.POOL_BOUNDED_NOTE(1200)).toContain("1,200");
    expect(copy.SORTED_WITHIN_POOL_NOTE(400)).toBe("Sorted within the top 400 matches.");
    expect(copy.RESULT_COUNT(20, 1200, true)).toBe("20 of 1,200+ funders");
    expect(copy.RESULT_COUNT(0, 0, false)).toBe("No results");
    expect(copy.RATE_LIMITED_NOTE(1)).toMatch(/1 second and/);
    expect(copy.RATE_LIMITED_NOTE(12)).toMatch(/12 seconds/);
  });

  it("does not claim Schedule I grants are absent", () => {
    expect(copy.GRANTS_EMPTY_NOTE).not.toMatch(/not in the database/i);
    expect(copy.GRANTS_EMPTY_NOTE).toMatch(/Schedule I/);
  });
});
