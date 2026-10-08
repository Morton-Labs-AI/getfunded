import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BarChart, Delta, Donut, FunnelBars, Sparkline, StackedBars } from "@/components/admin/charts";
import { BannerBar } from "@/components/admin/banner-bar";

describe("admin charts", () => {
  it("BarChart carries every value in its aria-label and draws a stub for zero", () => {
    const { container } = render(
      <BarChart data={[{ label: "2026-01-01", value: 3, caption: "Jan 1" }, { label: "2026-01-02", value: 0, caption: "Jan 2" }]} ariaLabel="Sign-ups" />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("aria-label", "Sign-ups. 2026-01-01: 3, 2026-01-02: 0");
    const bars = container.querySelectorAll("[data-slot='bar-chart'] .rounded-t-\\[4px\\]");
    expect(bars).toHaveLength(2);
    expect((bars[1] as HTMLElement).style.height).toBe("2%");
    expect((bars[1] as HTMLElement).style.background).toContain("--border");
  });

  it("BarChart with no data renders the missing vocabulary, never 0", () => {
    render(<BarChart data={[]} ariaLabel="Empty" />);
    expect(screen.getByText("No public data found")).toBeInTheDocument();
  });

  it("StackedBars totals per day and lists a legend with series totals", () => {
    render(
      <StackedBars
        labels={["Mon", "Tue"]}
        series={[
          { key: "fit", label: "Fit analysis", values: [5, 0] },
          { key: "ask", label: "Ask the analyst", values: [2, 2] },
        ]}
        ariaLabel="Credits"
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", "Credits. Mon: 7, Tue: 2");
    const legend = screen.getByRole("list", { name: "Legend" });
    expect(legend).toHaveTextContent("Fit analysis5");
    expect(legend).toHaveTextContent("Ask the analyst4");
  });

  it("FunnelBars prints the value inside the bar and links when given a href", () => {
    render(<FunnelBars data={[{ label: "Food Bank", value: 40, href: "/admin/workspaces/x", note: "3 calls" }, { label: "Shelter", value: 0 }]} />);
    expect(screen.getByRole("link", { name: "Food Bank" })).toHaveAttribute("href", "/admin/workspaces/x");
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("3 calls")).toBeInTheDocument();
  });

  it("Sparkline needs two points; Donut names each segment; Delta never relies on colour alone", () => {
    const { container: s1 } = render(<Sparkline values={[1]} ariaLabel="x" />);
    expect(s1.querySelector("svg")).toBeNull();
    const { container: s2 } = render(<Sparkline values={[1, 3, 2]} ariaLabel="Trend" />);
    expect(s2.querySelector("svg")).toHaveAttribute("aria-label", "Trend");

    render(<Donut segments={[{ label: "Fit", value: 5 }, { label: "Ask", value: 5 }]} ariaLabel="Share" centerValue="10" />);
    expect(screen.getByRole("img", { name: /Share\. Fit: 5, Ask: 5/ })).toBeInTheDocument();

    const { container: d } = render(<Delta value={-12} suffix="%" />);
    expect(d.textContent).toContain("down");
    expect(d.textContent).toContain("−12%");
    const { container: flat } = render(<Delta value={0} />);
    expect(flat.textContent).toBe("No change");
  });
});

describe("BannerBar", () => {
  it("announces the tone for assistive tech and renders an internal link", () => {
    render(<BannerBar banner={{ text: "Maintenance tonight", href: "/docs/status", tone: "warning" }} />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-tone", "warning");
    expect(status).toHaveTextContent("Warning:");
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("href", "/docs/status");
  });

  it("opens an external link in a new tab and renders no link without a href", () => {
    render(<BannerBar banner={{ text: "See the status page", href: "https://status.example.org", tone: "info" }} />);
    expect(screen.getByRole("link", { name: "Learn more" })).toHaveAttribute("target", "_blank");
    const { container } = render(<BannerBar banner={{ text: "Plain notice", href: undefined, tone: "info" }} />);
    expect(container.querySelector("a")).toBeNull();
  });
});
