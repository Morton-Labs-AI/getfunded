/**
 * Honest product copy, stated once and imported everywhere (UI, API notices,
 * tests). Plain language for a nonprofit audience.
 *
 * Rules these strings must keep (tests/unit/search/copy.test.ts checks them):
 *  - the word "closed" never describes a funder's application posture;
 *  - "$0" and "N/A" never stand in for a missing value;
 *  - a number that drifts (counts, percentages) is never hard-coded here.
 */

/* ----------------------------------------------------------------- search */

export const SEARCH_TITLE = "Search funders";

export const SEARCH_TAGLINE =
  "Every U.S. foundation and charity, straight from public IRS filings. No account needed.";

export const SEARCH_PLACEHOLDER = "A funder's name, an EIN, or describe the work you do";

export const SEARCH_MODE_LABELS = {
  name: "By name or EIN",
  keyword: "By keyword",
  thesis: "Describe the work",
} as const;

export const SEARCH_MODE_HINTS = {
  name: "Matches the organization's name as the IRS records it. Paste a nine-digit EIN for an exact match.",
  keyword: "Matches words in the funder's name, location and giving summary.",
  thesis: "Finds funders whose giving summary reads like what you described.",
} as const;

export const SEMANTIC_UNAVAILABLE_NOTICE =
  "Describe-the-work search is not available right now, so we matched your words as keywords instead. " +
  "Results may be narrower than a meaning-based search would give.";

export const NAME_TOO_SHORT_NOTE = "Type at least three letters of the name so we can match it.";

export const POOL_BOUNDED_NOTE = (limit: number) =>
  `More funders matched than we can rank at once. You are seeing the top ${limit.toLocaleString("en-US")}; add a filter to narrow the list.`;

export const SORTED_WITHIN_POOL_NOTE = (limit: number) =>
  `Sorted within the top ${limit.toLocaleString("en-US")} matches.`;

export const POSTURE_FILTER_NOTE =
  "Filtering by application status keeps only funders that file Form 990-PF. Grantmaking public charities " +
  "file Form 990, which has no place to state this, so they drop out of the list. They are not closed; they simply have not said.";

export const GIVING_TO_NOTE =
  "\"Funds organizations like\" reads the grant lists on each funder's filings. It is checked within the funders " +
  "that matched your other filters, so a wider search may surface more.";

export const GIVING_TO_PLACEHOLDER = "e.g. food bank, community college, animal shelter";

export const RATE_LIMITED_NOTE = (seconds: number) =>
  `You have searched a lot in the last minute. Please wait ${seconds} second${seconds === 1 ? "" : "s"} and try again.`;

export const TIMED_OUT_NOTE =
  "That search took too long, so we stopped it. A very common word matches a large share of all funders. " +
  "Add a state or a type, use more of the name, or try describe-the-work search.";

export const NO_RESULTS_TITLE = "No funders matched";
export const NO_RESULTS_HINT =
  "Try fewer words, remove a filter, or switch the search mode. A funder that is not here may still exist; " +
  "we only know what the IRS has published.";

export const EMPTY_SEARCH_TITLE = "Find the funders who already fund work like yours";
export const EMPTY_SEARCH_HINT =
  "Start with a name or EIN, or describe your work in a sentence. Everything you see comes from public filings, " +
  "and anything a model adds is labelled.";

export const EXAMPLE_QUERIES = [
  "youth mental health in Oregon",
  "rural health clinics",
  "arts education for children",
  "food security",
] as const;

export const RESULT_COUNT = (shown: number, total: number, truncated: boolean) =>
  total === 0
    ? "No results"
    : `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}${truncated ? "+" : ""} funders`;

/* --------------------------------------------------------------- posture */

/** Posture labels live in components/data/posture.tsx (POSTURE_LABELS). These
 *  are the longer explanations that sit next to them. */
export const POSTURE_EXPLAINERS = {
  open: "The funder's latest Form 990-PF says it accepts applications. Read the instructions below before you write.",
  preselected:
    "The funder's latest Form 990-PF says it gives only to organizations it has already chosen and does not accept unsolicited requests. " +
    "An introduction is usually the only route.",
  unknown:
    "These filings carry no statement about applications. That is not the same as closed: public-charity Form 990s have no field for it, " +
    "and many foundations leave the section blank.",
} as const;

export const CAN_I_APPLY_TITLE = "Can I apply?";

/** The one place "Part XV" is explained; every other mention can say "this section". */
export const HOW_TO_APPLY_NOTE =
  "Application guidance comes from the funder's own Form 990-PF, Part XV (the section where a private foundation says how to apply), shown as filed. It is the funder's words, not ours.";

export const PART_XV_FREE_TEXT_NOTE =
  "These fields are free text and the IRS form cuts them short. Filers sometimes put whole sentences in the contact-name box. Shown exactly as filed.";

export const CONTACT_NAME_WITHHELD = "Not published";

export const CONTACT_NAME_WITHHELD_NOTE =
  "The filing names a person as the application contact. We publish role-based contacts (a committee, an office, a shared inbox) but not named individuals.";

export const CONTACT_TIER_NOTE =
  "Only shared inboxes and organization phone lines that appear in public filings are shown here. " +
  "Contact details for named individuals are never published, even though the filing itself is public.";

export const CONTACT_ON_FILE_NOT_PUBLISHED = "On the filing, not published";

/* ------------------------------------------------------------ financials */

export const FILING_AS_FILED_NOTE =
  "Figures are as reported on the e-filed return, with no restatement. Fiscal years are the funder's own tax year, " +
  "labelled by the calendar year the period ends in. A blank line means the return does not carry that figure; a real zero shows as $0.";

export const AMENDED_RULE_NOTE =
  "When an amended return replaces an original, every figure here uses the amended return. The original is not shown.";

/** The IRS Exempt Organizations Business Master File, in the words the UI uses. */
export const IRS_MASTER_FILE_LABEL = "IRS master file";
export const IRS_MASTER_FILE_FULL_NAME = "IRS Exempt Organizations Business Master File: the IRS's list of every tax-exempt organization, updated monthly";

export const BMF_SNAPSHOT_NOTE =
  "Asset, income and revenue figures come from the IRS master file (the IRS Exempt Organizations Business Master File), a coarse annual extract. " +
  "Year-by-year figures appear once the organization's e-filed returns are in the database.";

export const DISTRIBUTIONS_NOTE =
  "Giving is what the funder actually paid out toward its charitable purpose in the year (qualifying distributions on Form 990-PF, " +
  "charitable disbursements otherwise). Assets are what it holds; giving is what moves.";

export const EXPENSE_SPLIT_NOTE =
  "Form 990 splits expenses into program services, management and fundraising. The split is self-reported, " +
  "and a grantmaker, a research institute and a direct-service nonprofit book the same work differently. " +
  "A line the return does not carry reads \"not available\"; it is never counted as zero.";

export const NO_FINANCIALS_NOTE =
  "No parsed e-filed return is on record for this organization yet, so year-by-year financials are not available.";

/* ---------------------------------------------------------------- grants */

export const GRANTS_PAID_TITLE = "Grants paid";

export const GRANTS_EMPTY_NOTE =
  "No grant rows from public filings are on record for this funder. Grant lists come from Form 990-PF and from Schedule I of Form 990; " +
  "a return the IRS has not yet published, or one with no grant list, has no rows here.";

export const GRANTS_AS_REPORTED_NOTE =
  "Recipients are shown as the funder wrote them on the return. A recipient with a link was matched to an organization record; " +
  "the rest stay as reported and are never guessed.";

export const GIVING_FOCUS_NOTE = (resolvedPct: number | null) =>
  resolvedPct === null
    ? "Based on the grant recipients we could match to an organization record."
    : `Based on the ${resolvedPct}% of grant rows we could match to an organization record. The rest stay as reported.`;

export const NTEE_CAVEAT =
  "The IRS assigns the NTEE category when it grants exemption. It often reflects the original filing, not today's giving.";

/* ---------------------------------------------------------- other panels */

export const OFFICERS_TITLE = "Officers and directors";
export const OFFICERS_NOTE =
  "From the officer list on the latest e-filed return. Compensation is as reported there; a blank means the return carries no figure.";

export const SIMILAR_FUNDERS_TITLE = "Funders like this one";
export const SIMILAR_FUNDERS_NOTE =
  "Nearest by size, location and giving pattern in the database. Geography weighs heavily. Treat it as a starting list, not a ranking of fit.";

export const SOURCES_TITLE = "Where this came from";
export const SOURCES_NOTE =
  "IRS filings are the source for every fact on this page. Nothing a model writes is ever a source; it can only point at a row here.";

export const WEBSITE_FROM_FILING = (fy: number | null, returnType: string) =>
  fy ? `Stated by the funder on its FY${fy} ${returnType} return` : `Stated by the funder on its ${returnType} return`;

export const WEBSITE_FROM_REGISTRY = "From a registry source";

export const NOT_FOUND_TITLE = "We could not find that funder";
export const NOT_FOUND_HINT =
  "The link may be old, or the record may have been merged into another. Try searching by name or EIN.";

/** Any other missing page (app/not-found.tsx), including a /funder/<id> whose id cannot be a funder. */
export const PAGE_NOT_FOUND_TITLE = "We could not find that page";
export const PAGE_NOT_FOUND_HINT = "The link may be old or mistyped. Search for a funder, or start from the home page.";
