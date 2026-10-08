import { POSTURE_LABELS } from "@/components/data/posture";

/**
 * The column dictionary of the Open Foundation List, in ONE place.
 *
 * The /foundations page renders its tables from this constant, and the docs
 * guide links to that table instead of repeating it, so the two cannot
 * drift. When the export gains, loses or renames a column, change it here
 * and nowhere else. Order is the order of the columns in the file.
 *
 * The export is `corpus/src/funderdb/export_foundations.py`. Its column
 * lists (FOUNDATION_COLUMNS, IRS_STANDING_SOURCE, YEAR_COLUMNS,
 * GRANT_COLUMNS) are the source of truth for names, order and values.
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
  /**
   * True for a column that a release has only when its source was loaded.
   * The meaning already says so in words; the flag lets a page mark it.
   */
  optional?: boolean;
};

export type ListFile = {
  /** File name as published in the release. For a set of files, the pattern. */
  name: string;
  /** What one row is. */
  rowIs: string;
  /** One plain sentence, also used on a download card when the release gives no description. */
  summary: string;
  columns: ListColumn[];
  /** For a set of files (one per fiscal year): matches each published name. */
  pattern?: RegExp;
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

/** The two lines of the return a giving figure can come from. Empty when the return has neither. */
export const LIST_GRANTS_PAID_BASIS_VALUES: Array<{ value: string; meaning: string }> = [
  {
    value: "qualifying_distributions",
    meaning: "The “qualifying distributions” line: grants, plus other spending that counts toward the amount a foundation must pay out.",
  },
  {
    value: "charitable_disbursements",
    meaning: "The “disbursements for charitable purposes” line. It is used when the return has no qualifying distributions line.",
  },
];

/** The values of `irs_standing`. The words follow the export's README. */
export const LIST_IRS_STANDING_VALUES: Array<{ value: string; meaning: string }> = [
  { value: "listed", meaning: "In the IRS master file or in Publication 78, and not on the automatic revocation list." },
  {
    value: "not_listed",
    meaning:
      "Not in the IRS master file and not in Publication 78. The automatic revocation list has no entry for it, or shows a reinstatement after the revocation. This does not mean that the foundation has shut down.",
  },
  {
    value: "revoked",
    meaning:
      "Automatically revoked: on the IRS Automatic Revocation of Exemption List with no reinstatement after it, and on neither of the other two lists.",
  },
  {
    value: "revoked_then_relisted",
    meaning: "Was on the automatic revocation list, and is in the IRS master file or Publication 78 again.",
  },
  {
    value: "lists_disagree",
    meaning:
      "On the automatic revocation list with no reinstatement after it, and also in the IRS master file or Publication 78. The lists do not agree, and we do not choose between them.",
  },
];

/** The sentence every optional column ends with. */
const NOT_IN_EVERY_RELEASE = "This column is not in every release.";

/**
 * The three IRS standing columns of `foundations.csv.gz`. A release has them
 * only when the two IRS lists were loaded before the export ran
 * (`optional_columns` in the release's manifest.json says so).
 */
export const IRS_STANDING_LIST_COLUMNS: ListColumn[] = [
  {
    name: "irs_standing",
    meaning: `What three IRS lists say about the foundation’s tax-exempt status, on the dates in the release’s manifest. The revocation list holds automatic revocations only: no annual return or notice filed for three years in a row. Empty when the lists were not available for it. ${NOT_IN_EVERY_RELEASE}`,
    values: LIST_IRS_STANDING_VALUES,
    optional: true,
  },
  {
    name: "irs_revocation_date",
    meaning: `The date of its latest automatic revocation, when the IRS list has one. A foundation that was reinstated later still has a date here, so read irs_standing with it. ${NOT_IN_EVERY_RELEASE}`,
    optional: true,
  },
  {
    name: "irs_on_pub78",
    meaning: `Whether it is in IRS Publication 78 data, the IRS list of organizations that can receive tax-deductible gifts. ${NOT_IN_EVERY_RELEASE}`,
    values: [
      { value: "t", meaning: "It is in Publication 78 data." },
      { value: "f", meaning: "It is not. This alone does not mean that it lost its status." },
    ],
    optional: true,
  },
];

/**
 * The `link_basis` column of the grants files. It is NOT in
 * FOUNDATION_LIST_FILES, because no release has it yet: the database does
 * not show on a public view how a recipient was matched. Add it to the end
 * of the grants columns when a release's manifest.json says it is present.
 */
export const GRANTS_LINK_BASIS_COLUMN: ListColumn = {
  name: "link_basis",
  meaning: "How we matched the recipient to an organization record.",
  values: [
    { value: "ein_on_return", meaning: "The return gives the recipient’s EIN." },
    { value: "name_and_state_match", meaning: "The name and state on the return match one organization." },
    { value: "filer_consensus", meaning: "Other filers wrote this name and state with one EIN." },
  ],
  optional: true,
};

/** The pattern of the grants file names, for example `foundation_grants_2023.csv.gz`. */
export const GRANTS_FILE_PATTERN = /^foundation_grants_(\d{4})\.csv\.gz$/;

export const FOUNDATION_LIST_FILES: ListFile[] = [
  {
    name: "foundations.csv.gz",
    rowIs: "One row per foundation",
    summary: "One row per foundation: who it is, where it is, its latest numbers, and what it says about applications.",
    columns: [
      { name: "getfunded_id", meaning: "Our own id for the foundation. The other files use the same id." },
      {
        name: "ein",
        meaning: "The Employer Identification Number: the nine-digit number the IRS gives each organization. It can start with a zero.",
      },
      { name: "name", meaning: "The foundation’s name on IRS records." },
      { name: "city", meaning: "The city of its mailing address." },
      { name: "state", meaning: "The two-letter state of its mailing address." },
      { name: "zip", meaning: "The ZIP code of its mailing address." },
      {
        name: "ntee_code",
        meaning: "The NTEE code: a short code for the foundation’s field of work. It is empty for many foundations.",
      },
      { name: "ruling_year", meaning: "The year the IRS recognized it as tax-exempt." },
      { name: "website", meaning: "The website the foundation wrote on its own return. It comes from the newest return that gives one." },
      { name: "first_fiscal_year", meaning: "The earliest fiscal year we hold a return for." },
      { name: "latest_fiscal_year", meaning: "The newest fiscal year we hold a return for." },
      { name: "years_on_file", meaning: "How many fiscal years of returns we hold." },
      {
        name: "latest_total_assets",
        meaning: "Total assets at the end of the latest fiscal year, at book value, in U.S. dollars.",
      },
      {
        name: "latest_grants_paid",
        meaning: "What it paid out for charitable purposes in the latest fiscal year, in U.S. dollars. The next column says which line of the return this is.",
      },
      {
        name: "latest_grants_paid_basis",
        meaning: "The line of the return that latest_grants_paid was read from. The two lines are not the same measure, so do not compare one with the other. Empty when the return has neither line.",
        values: LIST_GRANTS_PAID_BASIS_VALUES,
      },
      { name: "latest_revenue", meaning: "Total revenue in the latest fiscal year, in U.S. dollars." },
      { name: "latest_expenses", meaning: "Total expenses in the latest fiscal year, in U.S. dollars." },
      {
        name: "grants_on_file",
        meaning: "How many separate grant records we hold for the foundation, in all years. It is not the number of grants it made. Empty when we hold none.",
      },
      { name: "grants_total_on_file", meaning: "The sum of those grant records, in U.S. dollars." },
      {
        name: "application_posture",
        meaning: "What the latest return says about applications. It is always one of three values.",
        values: LIST_POSTURE_VALUES,
      },
      {
        name: "has_application_instructions",
        meaning: "Whether the application section of that return tells you how to apply. Empty when the return has no application section.",
        values: [
          { value: "t", meaning: "The return says how to apply." },
          { value: "f", meaning: "The return has an application section, but it does not say how to apply." },
        ],
      },
      { name: "application_deadline_text", meaning: "The deadline, in the foundation’s own words from the return." },
      { name: "public_contact_email", meaning: "A shared inbox, such as grants@, when the return lists one." },
      { name: "public_contact_phone", meaning: "An office phone number, when the return lists one." },
      { name: "latest_filing_object_id", meaning: "The IRS id of the latest return, so you can find the exact filing." },
      {
        name: "latest_filing_tax_period",
        meaning: "The year and month in which the fiscal year of the latest return ended, written YYYYMM. For example, 202312 is December 2023.",
      },
      {
        name: "source_dataset",
        meaning: "The public datasets the row was built from. When there is more than one, a semicolon is between the names.",
      },
      { name: "profile_url", meaning: "The link to the foundation’s page on GetFunded." },
      ...IRS_STANDING_LIST_COLUMNS,
    ],
  },
  {
    name: "foundation_years.csv.gz",
    rowIs: "One row per foundation per fiscal year",
    summary:
      "One row per foundation per fiscal year: revenue, expenses, assets and giving, so you can see change over time, and how many of its grants are in the grants files.",
    columns: [
      { name: "ein", meaning: "The foundation’s Employer Identification Number. Use it to match rows to the other files." },
      { name: "getfunded_id", meaning: "Our own id for the foundation, the same as in the other files." },
      { name: "fiscal_year", meaning: "The calendar year in which the fiscal year ended." },
      { name: "tax_period_end", meaning: "The last day of that fiscal year, written YYYY-MM-DD." },
      {
        name: "return_type",
        meaning: "The form that was filed for the year.",
        values: [
          { value: "990PF", meaning: "Form 990-PF, the return for private foundations." },
          {
            value: "990",
            meaning: "Form 990. A few organizations that the IRS lists as private foundations filed it for a year. grants_paid is empty for that year.",
          },
        ],
      },
      { name: "total_revenue", meaning: "Total revenue for the year, in U.S. dollars." },
      { name: "total_expenses", meaning: "Total expenses for the year, in U.S. dollars." },
      { name: "total_assets_eoy", meaning: "Total assets at the end of the year, at book value, in U.S. dollars." },
      { name: "net_assets_eoy", meaning: "Total assets minus what it owes, at the end of the year, in U.S. dollars." },
      {
        name: "grants_paid",
        meaning: "What it paid out for charitable purposes during the year, in U.S. dollars. The next column says which line of the return this is.",
      },
      {
        name: "grants_paid_basis",
        meaning: "The line of the return that grants_paid was read from. Empty when the return has neither line.",
        values: LIST_GRANTS_PAID_BASIS_VALUES,
      },
      {
        name: "n_grants_on_file",
        meaning: "How many separate grant records we hold for that year. Empty when we hold none.",
      },
      {
        name: "grants_linked_on_file",
        meaning: "How many of those grant records are in the grants file for that year. These are the grants whose recipient we matched to an organization record.",
      },
      {
        name: "grants_not_linked_on_file",
        meaning: "How many of those grant records are not in the grants file. We could not match the recipient to an organization record, so we count the grant and do not name the recipient.",
      },
      {
        name: "amount_not_linked_on_file",
        meaning: "The sum of the grant records that are not in the grants file, in U.S. dollars. Empty when there are none.",
      },
      { name: "filing_object_id", meaning: "The IRS id of the return, so you can find the exact filing." },
    ],
  },
  {
    name: "foundation_grants_<fiscal_year>.csv.gz",
    pattern: GRANTS_FILE_PATTERN,
    rowIs:
      "One file per fiscal year. One row per grant whose recipient we matched to an organization record. Other grants are counted in foundation_years.csv.gz and are not listed",
    summary:
      "One row per grant whose recipient we matched to an organization record. Other grants are counted in foundation_years.csv.gz and are not listed.",
    columns: [
      { name: "funder_ein", meaning: "The EIN of the foundation that made the grant. It is the same as ein in the other files." },
      { name: "funder_getfunded_id", meaning: "Our own id for that foundation, the same as getfunded_id in the other files." },
      { name: "funder_name", meaning: "The name of that foundation on IRS records." },
      {
        name: "recipient_ein",
        meaning: "The EIN of the organization record we matched the recipient to. Empty when that record has no EIN.",
      },
      { name: "recipient_getfunded_id", meaning: "Our own id for that organization record." },
      {
        name: "recipient_name",
        meaning: "The name on that organization record. It is not the text the foundation typed on its return.",
      },
      { name: "recipient_city", meaning: "The city on that organization record." },
      { name: "recipient_state", meaning: "The two-letter state on that organization record." },
      { name: "amount", meaning: "The amount of the grant as the foundation reported it, in U.S. dollars." },
      { name: "purpose_text", meaning: "The purpose of the grant, in the foundation’s own words from the return." },
      { name: "fiscal_year", meaning: "The calendar year in which the foundation’s fiscal year ended." },
      { name: "filing_object_id", meaning: "The IRS id of the return the grant comes from, so you can find the exact filing." },
    ],
  },
];

/**
 * The dictionary entry for a published file, by name. A grants file such as
 * `foundation_grants_2023.csv.gz` gets the one entry all grants files share.
 */
export function listFile(name: string): ListFile | null {
  return FOUNDATION_LIST_FILES.find((file) => file.name === name || file.pattern?.test(name) === true) ?? null;
}

/**
 * The dictionary columns that one published file really has, in the file's
 * own order. `published` is the list of column names the release recorded
 * for the file (`files[].columns` in content/data-release.json). Optional
 * columns that the release does not have are left out. With no list, the
 * whole dictionary entry is returned.
 */
export function columnsInRelease(file: ListFile, published?: readonly string[] | null): ListColumn[] {
  if (!published || published.length === 0) return file.columns;
  const known = new Map<string, ListColumn>(
    (file.pattern ? [...file.columns, GRANTS_LINK_BASIS_COLUMN] : file.columns).map((column) => [column.name, column]),
  );
  return published.flatMap((name) => {
    const column = known.get(name);
    return column ? [column] : [];
  });
}

/** The fiscal year in a grants file name, or null for any other file. */
export function grantsFileYear(name: string): number | null {
  const match = GRANTS_FILE_PATTERN.exec(name);
  return match ? Number(match[1]) : null;
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

/**
 * The rules for the grants files, in plain words. They are kept apart from
 * READING_RULES so a page that says "four rules" stays true; show them next
 * to the grants files.
 */
export const GRANTS_READING_RULES: Array<{ title: string; body: string }> = [
  {
    title: "The grants files do not list every grant.",
    body: "A foundation types the name of each recipient on its return, and some recipients are private people, such as a student with a scholarship. So a grant is listed only when we matched its recipient to an organization record. Every other grant is counted in foundation_years.csv.gz and is not named.",
  },
  {
    title: "Do not use a grants file as a total of giving.",
    body: "The sum of a grants file is less than what the foundations gave. Use grants_paid in foundation_years.csv.gz for the total. The columns grants_linked_on_file and grants_not_linked_on_file show how much of each year is in the grants file.",
  },
  {
    title: "A match can be wrong.",
    body: "The recipient name, city and state come from the organization record we matched, not from the text on the return. Check the return (filing_object_id) before you rely on a row. The purpose is in the foundation’s own words.",
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
