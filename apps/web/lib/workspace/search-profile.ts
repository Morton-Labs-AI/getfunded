/**
 * The organization-profile fields that tune funder search (lib/search/context.ts),
 * shared by onboarding (/welcome) and Settings › Organization so both forms
 * parse, store and explain them the same way. Pure; safe on client and server.
 *
 * Multi-choice fields travel as one hidden input holding a comma-separated
 * list (the forms read FormData last-value-wins).
 */
import { z } from "zod";

import { CAUSE_KEYS, CAUSE_WORDS } from "@/lib/search/context";

export const SERVICE_AREAS = ["local", "state", "regional", "national", "international"] as const;
export type ServiceArea = (typeof SERVICE_AREAS)[number];

export const SERVICE_AREA_LABELS: Record<ServiceArea, string> = {
  local: "A city or a few counties",
  state: "One whole state",
  regional: "Several states",
  national: "Across the country",
  international: "Outside the U.S.",
};

export const FUNDING_NEEDS = ["operating", "program", "capital", "capacity", "scholarships", "events"] as const;
export type FundingNeed = (typeof FUNDING_NEEDS)[number];

export const FUNDING_NEED_LABELS: Record<FundingNeed, string> = {
  operating: "General operating support",
  program: "A specific program or project",
  capital: "Buildings or equipment",
  capacity: "Staff, systems or training",
  scholarships: "Scholarships or direct aid",
  events: "Events or sponsorships",
};

/** Up to three causes, most central first. */
export const MAX_CAUSE_AREAS = 3;

export function causeLabel(key: string): string {
  const label = CAUSE_WORDS[key]?.label ?? key;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const csv = <T extends string>(allowed: readonly T[], max: number) =>
  z
    .string()
    .trim()
    .max(400)
    .transform((value) =>
      Array.from(new Set(value.split(",").map((v) => v.trim()).filter((v): v is T => (allowed as readonly string[]).includes(v)))).slice(0, max),
    );

const moneyField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (cleaned.length === 0) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000_000) {
      ctx.addIssue({ code: "custom", message: "Enter a whole-dollar amount, like 25000." });
      return z.NEVER;
    }
    return Math.round(n);
  });

/** Zod shape to spread into a form schema. Every field is optional on the form. */
export const searchProfileFields = {
  city: z.string().trim().max(120, "Keep the city under 120 characters.").optional().default(""),
  cause_areas: csv(CAUSE_KEYS, MAX_CAUSE_AREAS).optional().default([]),
  service_area: z
    .string()
    .trim()
    .transform((v) => ((SERVICE_AREAS as readonly string[]).includes(v) ? (v as ServiceArea) : ""))
    .optional()
    .default(""),
  funding_needs: csv(FUNDING_NEEDS, FUNDING_NEEDS.length).optional().default([]),
  typical_ask: moneyField.optional().default(null),
};

export type SearchProfileForm = {
  city: string;
  cause_areas: string[];
  service_area: ServiceArea | "";
  funding_needs: FundingNeed[];
  typical_ask: number | null;
};

/** Write the fields into a profile object; a cleared field removes its key. */
export function mergeSearchProfile(next: Record<string, unknown>, form: SearchProfileForm): void {
  const values: Record<string, unknown> = {
    city: form.city,
    cause_areas: form.cause_areas,
    service_area: form.service_area,
    funding_needs: form.funding_needs,
    typical_ask: form.typical_ask,
  };
  for (const [key, value] of Object.entries(values)) {
    const empty = value === null || value === "" || (Array.isArray(value) && value.length === 0);
    if (empty) delete next[key];
    else next[key] = value;
  }
}

/** An organization's own IRS record, for filling blank profile fields. */
export type ApplicantRecord = {
  name: string;
  city: string | null;
  state: string | null;
  nteeCode: string | null;
  /** Total revenue from the IRS master file, whole dollars. */
  revenue: number | null;
};

/**
 * Fill the profile's blank fields from the organization's own IRS record:
 * city, state, a cause from its NTEE code, and a budget from its revenue.
 * Never overwrites what the person typed. Returns the keys it filled.
 */
export function fillFromRecord(next: Record<string, unknown>, record: ApplicantRecord | null): string[] {
  if (!record) return [];
  const filled: string[] = [];
  const blank = (key: string) => next[key] === undefined || next[key] === "" || (Array.isArray(next[key]) && (next[key] as unknown[]).length === 0);
  if (blank("state") && record.state && /^[A-Z]{2}$/.test(record.state)) {
    next.state = record.state;
    filled.push("state");
  }
  if (blank("city") && record.city) {
    next.city = record.city.replace(/\w\S*/g, (w) => w.charAt(0) + w.slice(1).toLowerCase());
    filled.push("city");
  }
  const major = record.nteeCode?.charAt(0).toUpperCase();
  if (blank("cause_areas") && major && CAUSE_WORDS[major]) {
    next.cause_areas = [major];
    filled.push("cause_areas");
  }
  if (blank("annual_budget") && record.revenue && record.revenue > 0) {
    next.annual_budget = Math.round(record.revenue);
    filled.push("annual_budget");
  }
  return filled;
}
