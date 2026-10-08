import { describe, expect, it } from "vitest";

import {
  DEFAULT_FLAGS,
  flagsFormSchema,
  flagsFromRows,
  flagsToRows,
  parseAiEnabled,
  parseBanner,
  parseSignupMode,
} from "@/lib/admin/flags";

describe("flags parsing", () => {
  it("ai_enabled accepts the shapes meter() accepts", () => {
    expect(parseAiEnabled(true)).toBe(true);
    expect(parseAiEnabled(false)).toBe(false);
    expect(parseAiEnabled("false")).toBe(false);
    expect(parseAiEnabled(0)).toBe(false);
    expect(parseAiEnabled({ enabled: false })).toBe(false);
    expect(parseAiEnabled({ enabled: true })).toBe(true);
    expect(parseAiEnabled(undefined)).toBe(true);
  });

  it("signup_mode falls back to open for anything outside the vocabulary", () => {
    expect(parseSignupMode("invite")).toBe("invite");
    expect(parseSignupMode("closed")).toBe("closed");
    expect(parseSignupMode("CLOSED")).toBe("open");
    expect(parseSignupMode(null)).toBe("open");
  });

  it("banner accepts an object or a bare string, rejects junk, limits length", () => {
    expect(parseBanner(null)).toBeNull();
    expect(parseBanner("")).toBeNull();
    expect(parseBanner("  Maintenance at 9pm UTC ")).toEqual({ text: "Maintenance at 9pm UTC", tone: "info", href: undefined });
    expect(parseBanner({ text: "New: CSV import", href: "/docs/import", tone: "info" })).toEqual({ text: "New: CSV import", href: "/docs/import", tone: "info" });
    expect(parseBanner({ text: "x", href: "javascript:alert(1)" })).toBeNull();
    expect(parseBanner({ text: "x", tone: "danger" })).toBeNull();
    expect(parseBanner({ text: "" })).toBeNull();
    expect(parseBanner({ text: "a".repeat(241) })).toBeNull();
    expect(parseBanner({ text: "ok", href: "", tone: "warning" })).toEqual({ text: "ok", href: undefined, tone: "warning" });
  });

  it("flagsFromRows applies defaults for missing keys", () => {
    expect(flagsFromRows([])).toEqual(DEFAULT_FLAGS);
    expect(
      flagsFromRows([
        { key: "ai_enabled", value: false },
        { key: "signup_mode", value: "invite" },
        { key: "banner", value: { text: "Hi", tone: "warning" } },
        { key: "unrelated", value: 1 },
      ]),
    ).toEqual({ aiEnabled: false, signupMode: "invite", banner: { text: "Hi", tone: "warning", href: undefined } });
  });
});

describe("flags form", () => {
  it("validates the form and turns it into rows, with an empty banner stored as null", () => {
    const form = flagsFormSchema.parse({ ai_enabled: true, signup_mode: "open", banner_text: "", banner_href: "", banner_tone: "info" });
    expect(flagsToRows(form)).toEqual([
      { key: "ai_enabled", value: true },
      { key: "signup_mode", value: "open" },
      { key: "banner", value: null },
    ]);
    const withBanner = flagsFormSchema.parse({ ai_enabled: false, signup_mode: "closed", banner_text: " Read-only tonight ", banner_href: "https://status.example.org", banner_tone: "warning" });
    expect(flagsToRows(withBanner)[2]).toEqual({
      key: "banner",
      value: { text: "Read-only tonight", href: "https://status.example.org", tone: "warning" },
    });
  });

  it("rejects a bad link or an unknown mode", () => {
    expect(flagsFormSchema.safeParse({ ai_enabled: true, signup_mode: "open", banner_text: "x", banner_href: "ftp://x" }).success).toBe(false);
    expect(flagsFormSchema.safeParse({ ai_enabled: true, signup_mode: "whenever" }).success).toBe(false);
  });
});
