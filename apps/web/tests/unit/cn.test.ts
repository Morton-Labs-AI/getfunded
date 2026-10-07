import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });

  it("resolves Tailwind conflicts with the last class winning", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-ink", "text-primary")).toBe("text-primary");
  });
});
