import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FEATURE_COPY, PLAN_COPY, PRICING_FAQ } from "@/components/marketing/copy";
import { PlanCards, PlanCompareTable, UPGRADE_HREF } from "@/components/marketing/pricing-cards";
import { PLANS } from "@/lib/plans";

/**
 * The pricing surfaces promise only what is built and say it in plain words.
 * docs/PLANS.md is the source of truth for numbers (tests/unit/billing); this
 * file guards the sentences around them.
 */
describe("pricing copy", () => {
  it("compare table: no 'Sequences', no 'soft cap', knowledge base on every plan with its seat count", () => {
    const { container } = render(<PlanCompareTable />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/sequences/i);
    expect(text).not.toMatch(/soft cap/i);
    expect(text).toContain("Follow-ups that stop when a funder replies");
    expect(text).toContain("Most AI credits you can use in one day");
    expect(text).toContain("Fit analysis, research and Ask the analyst");
    const row = screen.getByRole("row", { name: /^Knowledge base/ });
    const cells = within(row).getAllByRole("cell").map((c) => c.textContent);
    expect(cells).toEqual(["Knowledge base", "Included", "Included", `Shared across ${PLANS.pro.members} seats`, `Shared across ${PLANS.team.members} seats`, "Shared across every seat"]);
  });

  it("plan cards: paid plans start free and land on Billing; Enterprise goes to /contact only", () => {
    render(<PlanCards />);
    expect(screen.getByRole("link", { name: "Start free" })).toHaveAttribute("href", "/signin");
    for (const id of ["starter", "pro", "team"] as const) {
      expect(screen.getByRole("link", { name: `Start free, then upgrade to ${PLANS[id].name}` })).toHaveAttribute("href", UPGRADE_HREF);
    }
    expect(screen.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/contact");
    expect(screen.queryByText(/sequences/i)).toBeNull();
    expect(screen.getByText(/follow-ups that stop when a funder replies/i)).toBeInTheDocument();
  });

  it("explains tokens in words and never claims proration or that a funder is interested", () => {
    const all = [
      ...PRICING_FAQ.map((f) => `${f.q} ${f.a}`),
      ...Object.values(FEATURE_COPY).map((f) => `${f.name} ${f.body}`),
      ...Object.values(PLAN_COPY).map((p) => `${p.tagline} ${p.audience}`),
    ].join("\n");
    expect(all).toContain("A token is about three quarters of a word");
    expect(all).not.toMatch(/prorat/i);
    expect(all).not.toMatch(/\bcompute\b/);
    expect(all).not.toMatch(/funder is interested/i);
  });
});
