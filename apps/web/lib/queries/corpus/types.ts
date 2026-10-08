/**
 * Shapes returned by the corpus read layer. Everything here is serializable
 * (strings for Postgres numerics, no Dates) so it can cross the server /
 * client boundary and be returned from the JSON API unchanged.
 */
import type { PostureValue } from "@/components/data/posture";
import type { SearchParams } from "@/lib/search/params";
import type { RanMode, SearchNotice } from "@/lib/search/sql";

/** The soft corpus reference a workspace stores next to an org id. */
export type FunderSnapshot = {
  orgId: string;
  name: string;
  ein: string | null;
  orgType: string;
  city: string | null;
  state: string | null;
  website: string | null;
};

/* ---------------------------------------------------------------- search */

export type MatchKind = "ein" | "name" | "keyword" | "semantic" | "browse";

export type GivingToEvidence = {
  /** Matching grant rows on this funder's filings. */
  n: number;
  total: string | null;
  /** Up to three recipient names, as reported. */
  samples: string[];
};

export type SearchHit = {
  orgId: string;
  name: string;
  orgType: string;
  orgTypeLabel: string;
  ein: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  nteeCode: string | null;
  nteeLabel: string | null;
  /** Program areas: NTEE group plus any registry focus areas. */
  programAreas: string[];
  posture: PostureValue | null;
  postureFy: number | null;
  /** Latest parsed filing, when one exists. */
  filing: { fy: number; returnType: string; objectId: string } | null;
  /** Money paid out in the latest filing (positive only; absent otherwise). */
  distributions: string | null;
  /** Assets: latest filing, else the BMF snapshot (positive only). */
  assets: string | null;
  assetsSource: "filing" | "bmf" | null;
  grantsOnFile: number | null;
  grantsTotal: string | null;
  grantsLastFy: number | null;
  /** Label for the SourceChip: "IRS 990-PF · FY2023" or "IRS master file". */
  sourceLabel: string;
  match: {
    kind: MatchKind;
    /** One line that says why this row is here, in plain words. */
    reason: string | null;
    /** A snippet of the giving summary when the match came from it. */
    snippet: string | null;
    givingTo: GivingToEvidence | null;
  };
  snapshot: FunderSnapshot;
};

export type SearchResult = {
  params: SearchParams;
  hits: SearchHit[];
  page: number;
  pageSize: number;
  /** Matches inside the candidate pool after every filter. */
  total: number;
  /** How many candidates the pool could hold, and whether it filled up. */
  poolLimit: number;
  truncated: boolean;
  ran: RanMode | null;
  notices: SearchNotice[];
  /** Seconds to wait when `notices` includes "rate_limited". */
  retryAfterSec?: number;
};

/* --------------------------------------------------------------- profile */

export type Provenance = {
  /** Human dataset name. */
  source: string;
  filingYear: number | null;
  /** Filing object id (IRS e-file) or record locator. */
  objectId: string | null;
  /**
   * sha256 of the file the fact was parsed from. Null when the row has no raw
   * file (BMF-only identity, contact channels) or the app role cannot read
   * internal.raw_files yet (migration getfunded_0010); the seal then leaves
   * the fingerprint out rather than showing a blank.
   */
  sha256: string | null;
  href: string | null;
  license: string | null;
};

export type ApplicationInfo = {
  posture: PostureValue;
  fy: number | null;
  objectId: string;
  taxPeriodEnd: string | null;
  hasPartXv: boolean;
  onlyPreselected: boolean | null;
  howToApply: string | null;
  deadlines: string | null;
  restrictions: string | null;
  /** Shown only when role-based (a committee, an office, an instruction). */
  contactName: string | null;
  contactNameWithheld: boolean;
  contactLocation: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  provenance: Provenance;
};

export type LatestFinancials = {
  fy: number | null;
  returnType: string;
  objectId: string;
  taxPeriodEnd: string | null;
  revenue: string | null;
  expenses: string | null;
  /** Qualifying distributions (990-PF) or charitable disbursements. */
  giving: string | null;
  assets: string | null;
  fmvAssets: string | null;
  liabilities: string | null;
  netAssets: string | null;
  nFilings: number;
};

export type FunderRecord = {
  orgId: string;
  canonicalOrgId: string | null;
  name: string;
  legalName: string | null;
  orgType: string;
  orgTypeLabel: string;
  ein: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
  websiteSource: "filing" | "registry" | null;
  websiteFy: number | null;
  websiteReturnType: string | null;
  nteeCode: string | null;
  nteeLabel: string | null;
  rulingDate: string | null;
  focusAreas: string[];
  bmf: {
    assets: string | null;
    income: string | null;
    revenue: string | null;
    lastVerifiedAt: string | null;
    provenance: Provenance;
  };
  posture: PostureValue | null;
  application: ApplicationInfo | null;
  latest: LatestFinancials | null;
  grants: { n: number | null; total: string | null; firstFy: number | null; lastFy: number | null };
  snapshot: FunderSnapshot;
};

export type FinancialYear = {
  fy: number | null;
  objectId: string;
  returnType: string;
  taxPeriod: string | null;
  taxPeriodEnd: string | null;
  amended: boolean | null;
  revenue: string | null;
  expenses: string | null;
  giving: string | null;
  contributionsPaid: string | null;
  totalGrantsPaid: string | null;
  contributionsReceived: string | null;
  assets: string | null;
  fmvAssets: string | null;
  netAssets: string | null;
  liabilities: string | null;
  programServices: string | null;
  management: string | null;
  fundraising: string | null;
  officerComp: string | null;
  operatingExpenses: string | null;
  employees: number | null;
  volunteers: number | null;
  provenance: Provenance;
};

export type GrantRow = {
  id: string;
  recipientName: string | null;
  recipientOrgId: string | null;
  recipientCity: string | null;
  recipientState: string | null;
  amount: string | null;
  fiscalYear: number | null;
  eventDate: string | null;
  purpose: string | null;
  relationship: string | null;
  provenance: Provenance;
};

export type GrantsPage = {
  rows: GrantRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  q: string | null;
};

export type Officer = {
  seq: number;
  personName: string | null;
  businessName: string | null;
  title: string | null;
  hoursPerWeek: string | null;
  compensation: string | null;
  objectId: string;
};

export type ContactChannel = {
  id: string;
  channelType: string;
  /** Public by construction (public.contact_channels). */
  value: string;
  isRoleBased: boolean;
  lastVerifiedAt: string | null;
  sourceDataset: string | null;
  sourceUrl: string | null;
};

export type SimilarFunder = {
  orgId: string;
  name: string;
  orgType: string;
  state: string | null;
  sizeAmount: string | null;
  dist: number;
};

export type FilingSummary = {
  objectId: string;
  returnType: string;
  taxPeriod: string | null;
  taxPeriodEnd: string | null;
  fy: number | null;
  amended: boolean | null;
  provenance: Provenance;
  xmlZipUrl: string | null;
};

export type GivingProfile = {
  focus: { major: string; label: string; n: number; total: string | null }[];
  geography: { state: string; n: number; total: string | null }[];
  /** Share of grant rows matched to an organization record, 0-100. */
  resolvedPct: number | null;
};

export type CorpusCounts = {
  byType: Record<string, number>;
  byPosture: Record<string, number>;
  events: number | null;
  refreshedAt: string | null;
};
