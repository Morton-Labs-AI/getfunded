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

export const SIGNALS_NOTE =
  "Signals are the funder's own announcements, found on its newsroom or sent " +
  "in by a person, snapshotted and classified by a language model whose " +
  "every field is backed by a passage quoted from the page, then published " +
  "by a human. The headline, date, amount and chips are the page's statements; " +
  "the paraphrase is the classifier's. A signal never says a funder is " +
  "interested in you, and it is not a filing.";

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

export const APPLICATION_POSTURE_NOTE =
  "Whether the foundation accepts unsolicited applications, read from Part XV " +
  "of its latest parsed Form 990-PF. This is the foundation's own answer on " +
  "its own return — not our inference — and a foundation that changes policy " +
  "shows the newest one filed.";

export const POSTURE_UNSTATED_NOTE =
  "“Not stated” means the return carries no Part XV application block. It is " +
  "neither an open door nor a closed one: 16,563 foundations with a parsed " +
  "return say nothing either way, and grantmaking public charities file " +
  "Form 990, which has no Part XV at all.";

export const POSTURE_SCOPE_NOTE =
  "Application posture and distributions are known only for the 145,200 " +
  "organizations with a parsed Form 990-PF, so screening on them narrows the " +
  "list to those. A foundation absent from this screen has not told the IRS " +
  "either way.";

export const PART_XV_FREE_TEXT_NOTE =
  "Part XV fields are free text, truncated at the IRS schema's element " +
  "lengths. Filers routinely put whole sentences in the contact-name element. " +
  "Shown exactly as filed.";

export const CONTACT_TIER_NOTE =
  "Application contacts printed on the return are shown when they are role " +
  "inboxes (grants@, info@) — the desks the foundation published for " +
  "applicants. Addresses belonging to a named individual are held internally " +
  "and never republished, even though the filing itself is public.";

export const DISTRIBUTIONS_NOTE =
  "Qualifying distributions (Part XII) are what the foundation actually paid " +
  "out toward its charitable purpose. Assets are a stock; this is the flow — " +
  "and screening on assets alone misses 8,880 foundations that distributed " +
  "over $500,000 in their latest filing.";

export const CHARITY_VETTING_LIMIT_NOTE =
  "This organization has Form 990 filings on record but none of them are " +
  "parsed yet, so revenue, expenses, net assets and the expense split are " +
  "not available here. The raw XML is linked on each filing if you need them " +
  "today.";

export const EXPENSE_SPLIT_NOTE =
  "Form 990 Part IX splits total expenses three ways. The program-services " +
  "share is the ratio most funders look at first — but read it with the " +
  "organization's model in mind: a grantmaker, a research institute and a " +
  "direct-service nonprofit book the same work differently, and the split is " +
  "self-reported.";

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
  "Filing financials cover 990-PF returns (Parts I/II/X–XIII) and Form 990 " +
    "core-form returns (Parts I/VII–X), both 2020–2026, extracted from the " +
    "IRS bulk XML. A NULL line means the element is absent from that return; " +
    "a $0 means the filer reported zero — never conflate them. Not parsed: " +
    "Schedule J compensation detail, Schedule A public-support tests, and " +
    "Schedule O narratives.",
  "Funder signals (press releases and newsroom posts) exist only for funders " +
    "on the watch list or sent in by a person; they are classified by a " +
    "language model with evidence checks and published by a human. Their " +
    "facts are republished as our CC BY compilation; the publisher's page " +
    "snapshot is internal and never republished.",
  AMENDED_RULE_NOTE,
  SCHEDULE_B_NOTE,
  POSTURE_UNSTATED_NOTE,
  CONTACT_TIER_NOTE,
  CHARITY_VETTING_LIMIT_NOTE,
];
