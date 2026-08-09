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
  "Person records are merged across sources where the people entity-resolution " +
  "precision gate certifies (95% Wilson lower bound > 0.90 on human labels); " +
  "sub-gate candidates stay per-source.";

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

export const FILING_AS_FILED_NOTE =
  "Figures are as reported on the e-filed return (Form 990-PF), extracted " +
  "from the IRS bulk XML — no restatements or normalization. Fiscal years " +
  "are each foundation's own tax year, labeled by the calendar year the " +
  "period ends in.";

export const AMENDED_RULE_NOTE =
  "When an amended return supersedes an original, charts, stats, and grant " +
  "rows use the amended figures; the original filing remains viewable and " +
  "is marked superseded.";

export const BMF_SNAPSHOT_NOTE =
  "Asset/income/revenue snapshot from the IRS Business Master File — a " +
  "coarse annual extract; per-year as-filed figures appear once this " +
  "organization's e-filed returns are ingested.";

export const SCHEDULE_B_NOTE =
  "Schedule B contributor lists are public information for private " +
  "foundations (unlike public charities, whose donor lists are redacted). " +
  "24% of the 990-PF e-filings parsed so far carry one.";

export const HOW_TO_APPLY_NOTE =
  "Application guidance from Form 990-PF Part XV, as filed — the " +
  "foundation's own words to would-be applicants, distinct from " +
  "website-derived info. 23% of parsed filings give an actual route in " +
  "(contact, materials, or deadlines); most of the rest state only that the " +
  "foundation funds preselected organizations and takes no unsolicited " +
  "requests, which is itself a useful answer.";

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
  "Enriched website facts (focus areas, giving priorities, application info) " +
    "exist for only a handful of foundations, are extracted from the " +
    "foundation's own site by a language model and human-confirmed, and are " +
    "internal-only — never filing-sourced and never republished.",
  "Filing financials cover 990-PF e-filings (2020–2026 tax periods); public-" +
    "charity 990 core-form financials are a later phase, so charity profiles " +
    "show only the BMF snapshot for now. A NULL line means the element is " +
    "absent from the return; a $0 means the foundation filed a zero.",
  AMENDED_RULE_NOTE,
  SCHEDULE_B_NOTE,
];
