/**
 * Single source for hand-written claims that appear in more than one surface
 * (/data, org pages, chat tables, the analyst system prompt). Fix a stale
 * fact here, and every surface follows.
 */

export const BACKLOG_990PF =
  "35,648 indexed 2025–26 990-PF filings (~18%) are not yet packaged into " +
  "IRS bulk zips; future re-ingests pick them up automatically.";

export const AS_REPORTED_NOTE =
  "As reported in the filing; no resolved org record (unmatched recipients " +
  "stay as-reported — never stubbed)";

export const PERSON_CAVEAT =
  "Person records are resolved across sources only where the entity-resolution " +
  "precision gate certifies; otherwise they stay per-source.";

export const NTEE_CAVEAT =
  "IRS-classified NTEE category from the Business Master File. Assigned at " +
  "exemption; often reflects the original filing, not current giving.";

export const WEB_FACTS_NOTE =
  "Extracted from the foundation's own website by a language model and " +
  "human-confirmed; internal research data — not from an IRS filing and " +
  "never republished.";

export const SIMILAR_PROFILES_NOTE =
  "Nearest by size, location, and giving pattern in the semantic corpus — " +
  "geography weighs heavily. Ordering is the signal; treat it as a starting " +
  "list, not a ranking of fit.";

export const RESOLVED_COVERAGE_NOTE = (rowsPct: number, dollarsPct: number) =>
  `${rowsPct}% of this foundation's grant rows (${dollarsPct}% of dollars) ` +
  "are resolved to organization records by precision-gated matching; the " +
  "rest stay as-reported text, never stubbed.";

export const KNOWN_LIMITS = [
  "Semantic search runs over aggregated giving-behavior documents, one per " +
    "funder — a funder whose few on-topic grants are buried under hundreds of " +
    "unrelated ones may not surface semantically (aggregate dilution). " +
    "Grant-level evidence queries still find them; the analyst pairs both.",
  "Grant recipients are resolved to organization records by precision-gated " +
    "matching (~38% of grant rows; ~43% of resolvable dollars). Unmatched " +
    "recipients stay as-reported text, never stubbed; placeholder entries " +
    "like “various individuals” are unresolvable by design.",
  PERSON_CAVEAT,
  "ADV-reported funds and Form D filings for the same fund remain separate " +
    "records until the fund-linkage precision gate certifies and the " +
    "canonical map is applied; linkage candidates are staged, not merged.",
  BACKLOG_990PF,
  "Reg D offerings with a first sale “yet to occur” carry no event date; a " +
    "handful of filer-entered amount absurdities survive in the tail.",
  "Curated federal-program award figures are estimates pending founder review.",
];
