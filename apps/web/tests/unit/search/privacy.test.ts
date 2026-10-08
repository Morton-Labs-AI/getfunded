// @vitest-environment node
/**
 * The Part XV contact-name rule (lib/queries/corpus/privacy.ts): roles and
 * instructions are published, named people are withheld, and an instruction
 * glued onto a person's name does not launder the name into print.
 */
import { describe, expect, it } from "vitest";

import { classifyContactName, publishableContactName } from "@/lib/queries/corpus/privacy";

describe("classifyContactName", () => {
  it("publishes roles and offices", () => {
    for (const s of [
      "GRANTS COMMITTEE",
      "THE FOUNDATION OFFICE",
      "HARTFORD GRANTS COMMITTEE",
      "SCHOLARSHIP SELECTION COMMITTEE",
      "EXECUTIVE DIRECTOR",
      "BOARD OF TRUSTEES",
      "C/O THE TRUST DEPARTMENT",
      "ATTN: GRANTS ADMINISTRATOR",
      "COMMUNITY FOUNDATION",
      "National Charitable Trust",
    ]) {
      expect(classifyContactName(s), s).toBe("role");
      expect(publishableContactName(s), s).toBe(s.replace(/\s+/g, " ").trim());
    }
  });

  it("publishes instructions", () => {
    for (const s of [
      "SEE WEBSITE",
      "APPLY ONLINE AT WWW.FOUNDATION.ORG",
      "N/A",
      "NONE",
      "NOT APPLICABLE",
      "VISIT OUR WEBSITE FOR GUIDELINES",
      "WWW.EXAMPLEFDN.ORG",
      "Applications are not accepted",
      "No applications; preselected only",
    ]) {
      expect(classifyContactName(s), s).toBe("instruction");
      expect(publishableContactName(s), s).not.toBeNull();
    }
  });

  it("withholds named people", () => {
    for (const s of ["JANE DOE", "JANE DOE, TRUSTEE", "Mr. John Q. Public", "MARY SMITH C/O FOUNDATION", "Jane Doe - Executive Director", "MS. DOE"]) {
      expect(classifyContactName(s), s).toBe("person");
      expect(publishableContactName(s), s).toBeNull();
    }
  });

  it("strips the instruction first, so a person with an instruction attached is still a person", () => {
    for (const s of [
      "JANE DOE, SEE WEBSITE",
      "SEE WEBSITE; JANE DOE",
      "JOHN SMITH, APPLY ONLINE AT WWW.SMITHFDN.ORG",
      "Jane Doe (see website)",
      "JANE DOE - VISIT WWW.EXAMPLE.ORG",
    ]) {
      expect(classifyContactName(s), s).toBe("person");
      expect(publishableContactName(s), s).toBeNull();
    }
  });

  it("withholds anything carrying an email address or a phone number, whatever else it says", () => {
    for (const s of ["GRANTS COMMITTEE jane.doe@example.org", "jdoe@example.org", "CALL 555-123-4567", "GRANTS OFFICE (555) 123 4567", "info@examplefdn.org"]) {
      expect(classifyContactName(s), s).toBe("person");
      expect(publishableContactName(s), s).toBeNull();
    }
  });

  it("treats blanks as none", () => {
    expect(classifyContactName("")).toBe("none");
    expect(classifyContactName("   ")).toBe("none");
    expect(classifyContactName(null)).toBe("none");
    expect(classifyContactName(undefined)).toBe("none");
    expect(publishableContactName("")).toBeNull();
  });

  it("is conservative: an organization name made of personal names is withheld rather than guessed", () => {
    expect(classifyContactName("THE JOHN AND MARY SMITH FOUNDATION OFFICE")).toBe("person");
  });
});
