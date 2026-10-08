import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";

describe("CardTitle", () => {
  it("renders a div by default so cards inside a page keep the page's heading order", () => {
    const { container } = render(
      <Card>
        <CardHeader>
          <CardTitle>Plans</CardTitle>
        </CardHeader>
      </Card>,
    );
    const title = container.querySelector("[data-slot='card-title']");
    expect(title?.tagName).toBe("DIV");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders a real heading when the card is the page (sign-in, welcome, invite)", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="text-2xl">
            Welcome.
          </CardTitle>
        </CardHeader>
      </Card>,
    );
    const h1 = screen.getByRole("heading", { level: 1, name: "Welcome." });
    expect(h1).toHaveAttribute("data-slot", "card-title");
    expect(h1.className).toContain("text-2xl");
  });
});
