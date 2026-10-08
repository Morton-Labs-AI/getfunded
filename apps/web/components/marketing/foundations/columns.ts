import { POSTURE_LABELS } from "@/components/data/posture";

/**
 * The column dictionary of the Open Foundation List, in ONE place.
 *
 * The /foundations page renders its tables from this constant, and the docs
 * guide links to that table instead of repeating it, so the two cannot
 * drift. When the export gains, loses or renames a column, change it here
 * and nowhere else. Order is the order of the columns in the file.
 *
 * Meanings are written for nonprofit staff: one line, plain words, no
 * database terms.
 */

export type ListColumn = {
  /** The column header exactly as it appears in the file. */
  name: string;
  /** One plain line. */
  meaning: string;
  /** For a column with a fixed set of values: each value and what it means. */
  values?: Array<{ value: string; meaning: string }>;
};

export type ListFile = {
  /** File name as published in the release. */
  name: string;
  /** What one row is. */
  rowIs: string;
  /** One plain sentence, also used on a download card when the release gives no description. */
  summary: string;
  columns: ListColumn[];
};

/**
 * The three values of `application_posture` in the files, with the same
 * words the site uses for them (components/data/posture.tsx).
 */
export const LIST_POSTURE_VALUES: Array<{ value: string; meaning: string }> = [
  { value: "accepts_applications", meaning: POSTURE_LABELS.open },
  { value: "preselected_only", meaning: POSTURE_LABELS.preselected },
  { value: "not_stated", meaning: POSTURE_LABELS.unknown },
];

export const FOUNDATION_LIST_FILES: ListFile[] = [
  {
    name: "foundations.csv.gz",
    rowIs: "One row per foundation",
    summary: "One row per foundation: who it is, where it is, its latest numbers, and what it says about applications.",
    columns: [
      { name: "getfunded_id", meaning: "Our own id for the foundation. Use it to match rows between the two files." },
      { name: "ein", meaning: "The Employer Identification Number: the nine-digit number the IRS gives each organization." },
      { name: "name", meaning: "The foundation’s name on IRS records." },
      { name: "city", meaning: "The city of its mailing address." },
      { name: "state", meaning: "The two-letter state of its mailing address." },
      { name: "zip", meaning: "The ZIP code of its mailing address." },
      { name: "ntee_code", meaning: "The NTEE code: a short code for the foundation’s field of work." },
      { name: "ruling_year", meaning: "The year the IRS recognized it as tax-exempt." },
      { name: "website", meaning: "The website the foundation wrote on its own return." },
      { name: "first_fiscal_year", meaning: "The earliest fiscal year we hold a return for." },
      { name: "latest_fiscal_year", meaning: "The newest fiscal year we hold a return for." },
      { name: "years_on_file", meaning: "How many fiscal years of returns we hold." },
      { name: "latest_total_assets", meaning: "Total assets at the end of the latest fiscal year, in U.S. dollars." },
      { name: "latest_grants_paid", meaning: "What it gave in the latest fiscal year, in U.S. dollars." },
      {
        name: "latest_grants_paid_basis",
        meaning: "Which line of the return the giving figure was read from, so you compare like with like.",
      },
      { name: "latest_revenue", meaning: "Total revenue in the latest fiscal year, in U.S. dollars." },
      { name: "latest_expenses", meaning: "Total expenses in the latest fiscal year, in U.S. dollars." },
      { name: "grants_on_file", meaning: "How many separate grant records we hold for the foundation." },
      { name: "grants_total_on_file", meaning: "The sum of those grant records, in U.S. dollars." },
      {
        name: "application_posture",
        meaning: "What the latest return says about applications. It is always one of three values.",
        values: LIST_POSTURE_VALUES,
      },
      { name: "has_application_instructions", meaning: "Whether the return tells you how to apply." },
      { name: "application_deadline_text", meaning: "The deadline, in the foundation’s own words from the return." },
      { name: "public_contact_email", meaning: "A shared inbox, such as grants@, when the return lists one." },
      { name: "public_contact_phone", meaning: "An office phone number, when the return lists one." },
      { name: "latest_filing_object_id", meaning: "The IRS id of the latest return, so you can find the exact filing." },
      { name: "latest_filing_tax_period", meaning: "The tax period that the latest return covers." },
      { name: "source_dataset", meaning: "The public dataset the row was built from." },
      { name: "profile_url", meaning: "The link to the foundation’s page on GetFunded." },
    ],
  },
  {
    name: "foundation_years.csv.gz",
    rowIs: "One row per foundation per fiscal year",
    summary: "One row per foundation per fiscal year: revenue, expenses, assets and giving, so you can see change over time.",
    columns: [
      { name: "ein", meaning: "The foundation’s Employer Identification Number. Use it to match rows to the other file." },
      { name: "getfunded_id", meaning: "Our own id for the foundation, the same as in the other file." },
      { name: "fiscal_year", meaning: "The fiscal year the return covers." },
      { name: "tax_period_end", meaning: "When that fiscal year ended." },
      { name: "return_type", meaning: "The form that was filed. For a private foundation this is Form 990-PF." },
      { name: "total_revenue", meaning: "Total revenue for the year, in U.S. dollars." },
      { name: "total_expenses", meaning: "Total expenses for the year, in U.S. dollars." },
      { name: "total_assets_eoy", meaning: "Total assets at the end of the year, in U.S. dollars." },
      { name: "net_assets_eoy", meaning: "Total assets minus what it owes, at the end of the year, in U.S. dollars." },
      { name: "grants_paid", meaning: "What it gave during the year, in U.S. dollars." },
      { name: "n_grants_on_file", meaning: "How many separate grant records we hold for that year." },
      { name: "filing_object_id", meaning: "The IRS id of the return, so you can find the exact filing." },
    ],
  },
];

/** The dictionary entry for a published file, by name. */
export function listFile(name: string): ListFile | null {
  return FOUNDATION_LIST_FILES.find((file) => file.name === name) ?? null;
}

/** "How to read it honestly": the four rules, in plain words. */
export const READING_RULES: Array<{ title: string; body: string }> = [
  {
    title: "“not_stated” does not mean closed.",
    body: "It means the latest return says nothing about applications. That is a missing statement, not a refusal. Do not remove these foundations from your list as if they had said no.",
  },
  {
    title: "An empty cell means not available, never zero.",
    body: "When a line is missing from the return, the cell is empty. A 0 in the file is a real zero that the foundation reported. Do not fill empty cells with 0 before you add numbers up.",
  },
  {
    title: "Amended returns replace the originals.",
    body: "When a foundation files a corrected return for the same year, the list uses the newer one. Nothing is counted twice.",
  },
  {
    title: "Contact details are for shared inboxes and office phones only.",
    body: "An email or a phone number appears only when the filing lists a shared inbox, such as grants@, or an office phone. A named person’s address is left out.",
  },
];

/** The commands that rebuild the files from the IRS records. */
export const REBUILD_STEPS: Array<{ title: string; code: string }> = [
  {
    title: "Load the earlier years of returns.",
    code: "uv run funderdb backfill --years 2020,2019,2018,2017 --discard-zips",
  },
  {
    title: "Write the list files.",
    code: "uv run funderdb export foundations --out data/export",
  },
];

/** Where the full rebuild guide lives in the repository. */
export const REBUILD_GUIDE_PATH = "corpus/docs/OPEN-FOUNDATION-LIST.md";
