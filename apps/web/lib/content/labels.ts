/**
 * Decode tables for corpus codes. Pure data; safe to import anywhere.
 */
import { IRS_PUB78_NAME, IRS_REVOCATION_LIST_FULL_NAME } from "./irs-standing-copy";
import { RECIPIENT_ALIAS_DATASET_LABEL } from "./recipient-alias-copy";

export const ORG_TYPE_LABELS: Record<string, string> = {
  private_foundation: "Private foundation",
  public_charity: "Public charity",
  company: "Company",
  gov_agency: "Federal agency",
  fund: "Fund",
  investment_adviser: "Investment adviser",
  vc: "Venture capital",
  pe: "Private equity",
};

export function orgTypeLabel(orgType: string | null | undefined): string {
  if (!orgType) return "Organization";
  return ORG_TYPE_LABELS[orgType] ?? orgType.replace(/_/g, " ");
}

/** NTEE major group (first letter of the code). */
export const NTEE_MAJOR: Record<string, string> = {
  A: "Arts and culture",
  B: "Education",
  C: "Environment",
  D: "Animal welfare",
  E: "Health care",
  F: "Mental health",
  G: "Disease research",
  H: "Medical research",
  I: "Crime and legal",
  J: "Employment",
  K: "Food and agriculture",
  L: "Housing",
  M: "Public safety",
  N: "Recreation and sports",
  O: "Youth development",
  P: "Human services",
  Q: "International affairs",
  R: "Civil rights",
  S: "Community improvement",
  T: "Philanthropy and grantmaking",
  U: "Science and technology",
  V: "Social science",
  W: "Public and societal benefit",
  X: "Religion",
  Y: "Mutual benefit",
  Z: "Unknown",
};

/** The groups offered in the search filter, in display order. */
export const NTEE_FILTER_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "N", "O", "P", "Q", "R", "S", "T", "U", "W", "X"] as const;

export function nteeMajorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return NTEE_MAJOR[code.charAt(0).toUpperCase()] ?? null;
}

/** IRS return type codes as printed on the form. */
export const RETURN_TYPE_LABELS: Record<string, string> = {
  "990PF": "990-PF",
  "990": "990",
  "990EZ": "990-EZ",
  "990T": "990-T",
};

export function returnTypeLabel(code: string | null | undefined): string {
  if (!code) return "990";
  return RETURN_TYPE_LABELS[code] ?? code;
}

/** Dataset names as the corpus records them, in plain words. */
export const DATASET_LABELS: Record<string, string> = {
  irs_990_xml: "IRS 990 e-file",
  irs_eo_bmf: "IRS master file (Exempt Organizations BMF)",
  sbir_awards: "SBIR/STTR awards",
  sec_form_adv: "SEC Form ADV",
  sec_form_adv_filings: "SEC Form ADV",
  sec_form_d: "SEC Form D",
  seed_federal_agencies: "Federal agency list",
  seed_federal_programs: "Federal program list",
  resolve_funds: "Fund matching",
  resolve_recipients: "Recipient matching",
  resolve_aliases: RECIPIENT_ALIAS_DATASET_LABEL,
  irs_auto_revocation: IRS_REVOCATION_LIST_FULL_NAME,
  irs_pub78: IRS_PUB78_NAME,
};

export function datasetLabel(name: string | null | undefined, fallback = "Public filing"): string {
  if (!name) return fallback;
  return DATASET_LABELS[name] ?? name.replace(/_/g, " ");
}

/** "IRS 990-PF · FY2023" style label for a SourceChip. */
export function filingSourceLabel(returnType: string | null | undefined, fy: number | null | undefined): string {
  const form = `IRS ${returnTypeLabel(returnType)}`;
  return fy ? `${form} · FY${fy}` : form;
}

export const US_STATES: readonly string[] = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA",
  "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR",
  "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI", "GU", "AS", "MP",
];
