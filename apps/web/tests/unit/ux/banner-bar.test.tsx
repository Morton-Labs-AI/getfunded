import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BannerBar } from "@/components/admin/banner-bar";

describe("BannerBar accepts a banner without a link", () => {
  it("renders no link for an absent, null or blank href and defaults the tone to info", () => {
    for (const href of [undefined, null, "", "   "]) {
      const { container, unmount } = render(<BannerBar banner={{ text: "Plain notice", href }} />);
      expect(screen.getByText("Plain notice")).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      expect(container.querySelector("[data-slot='site-banner']")).toHaveAttribute("data-tone", "info");
      unmount();
    }
  });

  it("still links when a href is present", () => {
    render(<BannerBar banner={{ text: "Read-only tonight", href: "/changelog", tone: "warning" }} />);
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "/changelog");
    expect(screen.getByText("Warning:")).toBeInTheDocument();
  });
});
