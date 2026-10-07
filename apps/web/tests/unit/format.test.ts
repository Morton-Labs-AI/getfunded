import { describe, expect, it } from "vitest";
import {
  MDASH,
  formatCompact,
  formatDate,
  formatEin,
  formatFiscalYear,
  formatMoney,
  formatMoneyCompact,
  formatNumber,
  formatPercent,
  shaPrefix,
  toNumber,
} from "@/lib/format";

describe("toNumber", () => {
  it("accepts numbers, numeric strings and bigints", () => {
    expect(toNumber(12)).toBe(12);
    expect(toNumber("12.5")).toBe(12.5);
    expect(toNumber("$1,200")).toBe(1200);
    expect(toNumber(BigInt(10))).toBe(10);
  });
  it("returns null for missing or unparseable input", () => {
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("")).toBeNull();
    expect(toNumber("abc")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
  });
});

describe("formatMoney", () => {
  it("renders an em dash for missing values, never $0", () => {
    expect(formatMoney(null)).toBe(MDASH);
    expect(formatMoney(undefined)).toBe(MDASH);
    expect(formatMoney("")).toBe(MDASH);
  });
  it("renders a real zero as $0", () => {
    expect(formatMoney(0)).toBe("$0");
  });
  it("groups thousands and rounds to whole dollars", () => {
    expect(formatMoney(1234567.89)).toBe("$1,234,568");
    expect(formatMoney("48215930")).toBe("$48,215,930");
  });
  it("shows cents when asked", () => {
    expect(formatMoney(1234.5, { cents: true })).toBe("$1,234.50");
  });
  it("uses a true minus sign for negatives", () => {
    expect(formatMoney(-50)).toBe("−$50");
  });
});

describe("formatMoneyCompact", () => {
  it("compacts into K / M / B", () => {
    expect(formatMoneyCompact(48_215_930)).toBe("$48.2M");
    expect(formatMoneyCompact(1_500_000_000)).toBe("$1.5B");
    expect(formatMoneyCompact(250_000)).toBe("$250K");
    expect(formatMoneyCompact(12_500)).toBe("$12.5K");
    expect(formatMoneyCompact(999)).toBe("$999");
    expect(formatMoneyCompact(2_000_000)).toBe("$2M");
  });
  it("handles missing and negative", () => {
    expect(formatMoneyCompact(null)).toBe(MDASH);
    expect(formatMoneyCompact(-1_200_000)).toBe("−$1.2M");
  });
});

describe("formatNumber / formatCompact", () => {
  it("groups counts", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatNumber(null)).toBe(MDASH);
  });
  it("compacts counts", () => {
    expect(formatCompact(1_200_000)).toBe("1.2M");
    expect(formatCompact(48_000)).toBe("48K");
    expect(formatCompact(1_500)).toBe("1.5K");
    expect(formatCompact(42)).toBe("42");
  });
});

describe("formatPercent", () => {
  it("takes a ratio", () => {
    expect(formatPercent(0.1234)).toBe("12%");
    expect(formatPercent(0.1234, 1)).toBe("12.3%");
    expect(formatPercent(1)).toBe("100%");
  });
  it("em dash for missing", () => {
    expect(formatPercent(null)).toBe(MDASH);
  });
});

describe("formatDate", () => {
  it("formats date-only strings without a timezone shift", () => {
    expect(formatDate("2024-03-01")).toBe("Mar 1, 2024");
  });
  it("supports long, month and year styles", () => {
    expect(formatDate("2024-03-01", "long")).toBe("March 1, 2024");
    expect(formatDate("2024-03-01", "month")).toBe("Mar 2024");
    expect(formatDate("2024-03-01", "year")).toBe("2024");
  });
  it("em dash for missing or invalid", () => {
    expect(formatDate(null)).toBe(MDASH);
    expect(formatDate("not a date")).toBe(MDASH);
  });
});

describe("formatEin", () => {
  it("formats 9 digits as 12-3456789", () => {
    expect(formatEin("123456789")).toBe("12-3456789");
    expect(formatEin(123456789)).toBe("12-3456789");
    expect(formatEin("12-3456789")).toBe("12-3456789");
    expect(formatEin(" 12 3456789 ")).toBe("12-3456789");
  });
  it("returns non-9-digit input unchanged and em dash for missing", () => {
    expect(formatEin("1234")).toBe("1234");
    expect(formatEin(null)).toBe(MDASH);
    expect(formatEin("")).toBe(MDASH);
  });
});

describe("shaPrefix / formatFiscalYear", () => {
  it("takes the first 8 hex chars by default", () => {
    expect(shaPrefix("abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789")).toBe("abcdef01");
    expect(shaPrefix("abc", 8)).toBe("abc");
    expect(shaPrefix(null)).toBe(MDASH);
  });
  it("labels fiscal years", () => {
    expect(formatFiscalYear(2023)).toBe("FY2023");
    expect(formatFiscalYear("2023-12-31")).toBe("FY2023");
    expect(formatFiscalYear(null)).toBe(MDASH);
  });
});
