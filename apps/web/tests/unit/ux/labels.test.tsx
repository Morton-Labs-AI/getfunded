import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/search",
}));

import { FilterControls } from "@/components/search/filter-controls";
import { SavedFiltersBar } from "@/components/workspace/saved-filters";
import { DEFAULT_SEARCH_PARAMS } from "@/lib/search/params";

/** Every form control has a visible label (not only an aria-label). */
describe("visible labels", () => {
  it("search filters: one visible label per select, in plain words", () => {
    render(<FilterControls current={DEFAULT_SEARCH_PARAMS} base="/search" />);
    for (const label of ["Type", "State", "Applications", "Gives per year", "Assets", "Focus area", "Sort", "Funds organizations like"]) {
      const control = screen.getByLabelText(label);
      expect(control, label).toBeInTheDocument();
      expect(control.getAttribute("aria-label"), label).toBeNull();
    }
    expect(screen.queryByText(/NTEE/)).toBeNull();
  });

  it("saved funders filter bar: search and every select carry a visible label", () => {
    render(
      <SavedFiltersBar
        base="/app/saved"
        current={{}}
        members={[{ id: "u1", name: "Dana", email: "dana@example.org", role: "member" }]}
        collections={[{ id: "c1", name: "Board picks", description: null, isShared: true, itemCount: 2, createdBy: null, version: 1 }]}
      />,
    );
    for (const label of ["Search", "Stage", "Owner", "Tier", "List", "Sort by"]) {
      expect(screen.getByLabelText(label), label).toBeInTheDocument();
    }
  });
});
