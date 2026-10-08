/**
 * Honesty rules in the funder-page primitives: the provenance seal leaves the
 * fingerprint out when there is none, the expense split never shows a missing
 * line as 0%, the withheld-contact sentence does not assert why, and the Ask
 * result table never renders a count as dollars.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { cellFormatFor, creditsUsed } from "@/components/ai/ask-chat";
import { ProvenanceSeal } from "@/components/data/provenance-seal";
import { ContactsSection } from "@/components/funder/contacts-section";
import { SplitBar, splitSegmentText } from "@/components/funder/fy-bars";
import type { ApplicationInfo } from "@/lib/queries/corpus/types";

describe("ProvenanceSeal", () => {
  it("shows a file fingerprint with the full hash on hover", () => {
    render(<ProvenanceSeal source="IRS 990-PF e-file" filingYear={2023} sha256="abcdef0123456789abcdef" />);
    const fp = screen.getByText(/file fingerprint abcdef01/);
    expect(fp).toHaveAttribute("title", expect.stringContaining("abcdef0123456789abcdef"));
    expect(screen.queryByText(/sha256 —/)).toBeNull();
  });

  it("leaves the fingerprint out when there is no hash", () => {
    render(<ProvenanceSeal source="IRS Exempt Organizations BMF" filingYear={null} sha256={null} />);
    expect(screen.queryByText(/fingerprint/)).toBeNull();
    expect(screen.queryByText(/sha256/)).toBeNull();
    expect(screen.getByText("IRS Exempt Organizations BMF")).toBeInTheDocument();
  });
});

describe("SplitBar", () => {
  const segments = [
    { label: "Program services", value: 750_000, color: "var(--chart-1)" },
    { label: "Management and general", value: 250_000, color: "var(--chart-3)" },
    { label: "Fundraising", value: null, color: "var(--chart-4)" },
  ];

  it("says a missing line is not available instead of 0%", () => {
    render(<SplitBar segments={segments} ariaLabel="Expense split for FY2023" />);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    expect(screen.getByText("not available")).toBeInTheDocument();
    expect(screen.queryByText("0%")).toBeNull();
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Expense split for FY2023: Program services 75%, Management and general 25%, Fundraising not available");
    expect(splitSegmentText(segments[2], 1_000_000)).toBe("Fundraising not available");
  });

  it("renders nothing when every line is missing", () => {
    const { container } = render(<SplitBar segments={segments.map((s) => ({ ...s, value: null }))} ariaLabel="x" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ContactsSection", () => {
  const application: ApplicationInfo = {
    posture: "open",
    fy: 2023,
    objectId: "202300000000000001",
    taxPeriodEnd: "2023-12-31",
    hasPartXv: true,
    onlyPreselected: false,
    howToApply: null,
    deadlines: null,
    restrictions: null,
    contactName: null,
    contactNameWithheld: false,
    contactLocation: null,
    hasEmail: true,
    hasPhone: true,
    provenance: { source: "IRS 990-PF e-file", filingYear: 2023, objectId: "202300000000000001", sha256: null, href: null, license: null },
  };

  it("says a withheld channel is on the filing without asserting who it belongs to", () => {
    render(<ContactsSection channels={[]} application={application} />);
    const note = screen.getByText(/lists an email address and a phone number for applications/);
    expect(note.textContent).toContain("It is on the filing but not published here.");
    expect(note.textContent).not.toMatch(/named person/);
  });
});

describe("Ask result table formatting", () => {
  it("formats counts before money, and a bare total as a plain number", () => {
    expect(cellFormatFor("n")).toBe("count");
    expect(cellFormatFor("grants")).toBe("count");
    expect(cellFormatFor("grant_count")).toBe("count");
    expect(cellFormatFor("total")).toBe("number");
    expect(cellFormatFor("sum")).toBe("number");
    expect(cellFormatFor("amount")).toBe("money");
    expect(cellFormatFor("total_amount")).toBe("money");
    expect(cellFormatFor("grants_total")).toBe("money");
    expect(cellFormatFor("qualifying_distributions")).toBe("money");
    expect(cellFormatFor("recipient_name")).toBe("text");
    expect(cellFormatFor("fiscal_year")).toBe("text");
  });

  it("prefers the Postgres column type when the rows event carries one", () => {
    // An integer is never dollars, whatever the name says.
    expect(cellFormatFor("grants_paid", "int")).toBe("count");
    expect(cellFormatFor("foundations_in_oregon", "int")).toBe("count");
    expect(cellFormatFor("total", "int")).toBe("number");
    // A numeric is money only when the name is money-like.
    expect(cellFormatFor("amount_given", "numeric")).toBe("money");
    expect(cellFormatFor("total_given", "numeric")).toBe("number");
    expect(cellFormatFor("n", "numeric")).toBe("count");
    expect(cellFormatFor("share", "float")).toBe("number");
    // Text-like types render as text even with a money-like name (an EIN, a label).
    expect(cellFormatFor("amount_label", "text")).toBe("text");
    expect(cellFormatFor("event_date", "date")).toBe("text");
    // Years keep their digits together.
    expect(cellFormatFor("fiscal_year", "int")).toBe("text");
    expect(cellFormatFor("last_fy", "int")).toBe("text");
    // Unknown or absent type: the name decides, as before.
    expect(cellFormatFor("amount", "unknown")).toBe("money");
    expect(cellFormatFor("amount", undefined)).toBe("money");
  });

  it("leads with the credits used", () => {
    expect(creditsUsed(2)).toBe("2 credits used");
    expect(creditsUsed(1)).toBe("1 credit used");
  });
});
