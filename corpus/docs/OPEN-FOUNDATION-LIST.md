# Open Foundation List

The Open Foundation List is a small public download. It lists every U.S.
private foundation in the Open Funder Database, with a few facts about each
one, and the grants that can be named safely. It is made for people who want
a list, not a database.

It is built only from public IRS records. Anyone can use it and share it.

## What you get

One folder for each build, named by its date and time (the "vintage"), for
example `20261008T175342Z`. A text file named `LATEST` holds the name of the
newest folder. Each folder holds:

| File | What it is |
|---|---|
| `foundations.csv.gz` | One row for each private foundation. |
| `foundation_years.csv.gz` | One row for each foundation and fiscal year. |
| `foundation_grants_<fiscal_year>.csv.gz` | One file for each fiscal year. One row for each grant whose recipient is linked to an organization record. |
| `README.md` | The same rules and column lists, for the person who downloads the files. |
| `LICENSE.txt` | The licence and the credit line. |
| `manifest.json` | Row counts, the sha256 of each file, the sources, the checks, the git commit. |

The CSV files are gzip files with UTF-8 text. The first line has the column
names. `foundations.csv.gz` and `foundation_years.csv.gz` are sorted by
`ein`. A grants file is sorted by `funder_ein`, then `filing_object_id`, then
`recipient_ein`, then `amount`.

## What the grants files hold, and what they leave out

A Form 990-PF grant row gives the recipient's name as free text. Some
recipients are private persons, for example a student with a scholarship or a
person who got a hardship grant. A public bulk file must not name them. The
rule is:

1. A grant row is in a grants file only when its recipient is linked to an
   organization record (`recipient_org_id` is not null, and the record is in
   `public.organizations`).
2. `recipient_name`, `recipient_city`, `recipient_state` and `recipient_ein`
   in the file come from that organization record. The text that the
   foundation typed is never read.
3. Every other grant row is counted and is not named. The counts are in
   `foundation_years.csv.gz`: `grants_linked_on_file`,
   `grants_not_linked_on_file` and `amount_not_linked_on_file`.
   `manifest.json` has the same counts for each fiscal year under
   `grants_coverage`.

"Not linked" does not mean that the recipient is a person. The recipient can
be an organization that the database could not link. The sum of a grants
file is less than what the foundations gave. Use `grants_paid` in
`foundation_years.csv.gz` for a total of giving.

Two things stay as the foundation wrote them: `amount` and `purpose_text`.
A purpose can name a person (for example a gift in memory of someone). In a
sample of 6,226 linked grant rows read on 2026-10-08, 33 purposes had words
such as "in memory of" or "scholarship for" followed by more text. This is
0.5%. Whether `purpose_text` stays in the public release as it is, is an
open question for the maintainers.

## How to build it

You need a loaded database and `DATABASE_URL` in `.env`.

```
uv run funderdb export foundations --out data/open-foundation-list
```

Options:

| Option | What it does |
|---|---|
| `--out DIR` | Where to publish. Required. Each run writes `DIR/<vintage>/` and updates `DIR/LATEST`. |
| `--limit N` | Write only the first N foundations by EIN. Use it to check the output fast. Each query must finish in 20 seconds. Each grants file holds at most 5,000 rows in a sample. |
| `--no-ledger` | Do not record the run in the database. Use it with a read-only role. |
| `--statement-timeout TEXT` | The time limit for each query. The default is `20s` with `--limit` and `60min` without. |
| `--tag NAME` | The name of the data release, for example `data-2026-10-08`. Needed with `--release-json`. |
| `--release-json FILE` | After everything else succeeded, write the JSON file that the website reads. See "The release file" below. |

A quick check that writes nothing to the database:

```
uv run funderdb export foundations --out /tmp/ofl-check --limit 300 --no-ledger
```

The full list needs more than 20 seconds per query. Run it with the pipeline
connection, not with the read-only connection of the web app.

Measured on 2026-10-08 with the read-only role, while a backfill job was
writing to the database: the 300-foundation sample ran 11 statements (two
list files, the coverage query and eight grants files) and took 18 to 26
seconds in all. In these runs each statement stayed under the 20 second
limit. Two other runs stopped at the limit on their first statement, when the
data was not in memory yet. A run that was started again right away passed.

The full list was not run with this code. In the full list, the query for
each fiscal year reads the whole grants table once (about 7 GB on
2026-10-08), so plan for some minutes for each fiscal year.

## How it is published

1. All queries run in one read-only transaction (REPEATABLE READ). Every
   file shows the database at the same moment, also when a loader is writing.
2. The files are written into a temporary folder `DIR/.tmp-<vintage>/`.
3. `manifest.json` is written last.
4. The folder is renamed to `DIR/<vintage>/`. A reader never sees a folder
   without its manifest.
5. `DIR/LATEST` is updated.

If a run stops early, only a `.tmp-` folder is left. The next run deletes it.

The same database gives the same bytes. Two runs on 2026-10-08, 32 seconds
apart, gave the same sha256 for all ten CSV files of the 300-foundation
sample. To check a copy, compare its sha256 with the value in
`manifest.json`.

The run does three more checks on the files it wrote, and it stops without
publishing when one fails:

- `foundations.csv.gz` has one row for each foundation, no more.
- Every row of a grants file has a recipient organization record, and its
  fiscal year is the year of the file.
- The number of rows in each grants file is the number of linked grant rows
  that the database holds for that fiscal year.

## The release file

`--release-json FILE` writes the small JSON file that the website reads
(`apps/web/content/data-release.json`). It needs `--tag`.

```
uv run funderdb export foundations --out data/open-foundation-list \
  --tag data-2026-10-08 --release-json ../apps/web/content/data-release.json
```

The file holds the tag, the vintage, the time of the build, the IRS index
years, the licence, the credit line, the link to the release page, and one
entry for each CSV file: its name, download link, size in bytes, sha256, row
count and one sentence about it. The links point to
`https://github.com/Morton-Labs-AI/getfunded/releases/download/<tag>/<file>`.
The command does not make the release. Upload the files of the vintage
folder to a release with the same tag.

With `--limit` the file gets one more key, `sample_limit`, and the command
prints a warning. A sample is not a release. Do not publish that file.

## The rules the files obey

1. **`not_stated` is not closed.** `application_posture` has three values:
   `accepts_applications`, `preselected_only` and `not_stated`. `not_stated`
   means the latest return says nothing about applications, or no return is
   on file. It never means "no".
2. **Empty means not available.** A missing value is an empty cell. It is
   never written as 0. A `0` in a money column is a zero that the foundation
   filed.
3. **Counts are empty when nothing is on file.** `grants_on_file`,
   `n_grants_on_file` and `years_on_file` count what this database holds.
   They are empty, not 0, when it holds nothing. `grants_linked_on_file` and
   `grants_not_linked_on_file` are empty in the same case. When the database
   holds grant rows for the year, one of these two can be `0`: none of the
   rows is of that kind.
4. **Latest means latest parsed.** The `latest_*` columns come from the
   newest return whose data the IRS has published and this database has
   parsed. An amended return replaces the original.
5. **One of two lines for giving.** `latest_grants_paid` is the qualifying
   distributions line when the return has it. If not, it is the charitable
   disbursements line. `latest_grants_paid_basis` names the line. The two
   lines are not the same measure, so do not add them or compare them.
6. **Contacts come from one place.** `public_contact_email` and
   `public_contact_phone` come only from `public.contact_channels`. That view
   holds only contacts that are marked public. An email is public only when
   it is a role inbox such as `grants@`. The address of a named person is
   never in this file.
7. **Grants are named only through an organization record.** See "What the
   grants files hold, and what they leave out".

## The licence boundary

The export reads only seven views:

- `public.organizations`
- `public.org_identifiers`
- `public.org_application_posture`
- `public.org_financial_series`
- `public.filings`
- `public.funding_events`
- `public.contact_channels`

It reads one more view, `public.org_irs_standing`, when the database has it
(see "Optional columns").

These views show only records from sources that may be republished. Before
the export writes a file, it runs seven checks. One failed check stops the run
and no file is written.

| Check | What it proves |
|---|---|
| F1 | Every output column names its source view, and that view is an allowed view. |
| F2 | Every relation that the queries read is an allowed view or a step inside the query. |
| F3 | The SQL names no other schema and does not read `public.filing_application_info`. |
| F4 | The two contact columns come from `public.contact_channels` and from nothing else. No other email or phone column is read. Only the foundations query reads contacts. |
| F5 | Each allowed view is a view in schema `public`. |
| F6 | Each view has the columns the queries use. |
| F7 | A grant row names its recipient only through the linked organization record. No query reads the recipient name, city, state or address that the foundation typed. The grants query keeps only rows with a linked record. |

The checks cover every statement: the foundations query, the years query,
the grant coverage query and the grants query. The grants query runs once
for each fiscal year. Only the year number changes, so the check reads it
once.

The results are in `manifest.json` under `boundary_checks`.

## Optional columns

Some columns are in the files only when the database shows their source on a
public view. The export looks for the source when it starts. `manifest.json`
says under `optional_columns` what it found, and the `README.md` of the build
lists the columns that are not there.

| Columns | File | Needs | When it is missing |
|---|---|---|---|
| `irs_standing`, `irs_revocation_date`, `irs_on_pub78` | `foundations.csv.gz` | the view `public.org_irs_standing` (migration 0028), and the right to read it | The three columns are not in the file. |
| `link_basis` | the grants files | a column `recipient_link_basis` on `public.funding_events` | The column is not in the files. |
| `address_basis` | `foundations.csv.gz` | a column `address_basis` on `public.organizations` (migration 0030) | The column is not in the file. |

`link_basis` is not available today. The database knows how each recipient
was linked (the EIN on a Schedule I row, a name match, or the agreement of
other filers), but no public view shows it for a grant row. The export does
not guess it. When `public.funding_events` gets a `recipient_link_basis`
column with the values `ein_on_return`, `name_and_state_match` and
`filer_consensus`, the column appears in the grants files with no change to
this code. Any other value stops the run.

## Columns of `foundations.csv.gz`

One row for each organization of type `private_foundation` that has an EIN.

| Column | Read from | Meaning |
|---|---|---|
| `getfunded_id` | `public.organizations` | Stable id of the foundation in this database (a UUID). |
| `ein` | `public.org_identifiers` | IRS Employer Identification Number, 9 digits, with leading zeros. |
| `name` | `public.organizations` | Name as the IRS master file or the return gives it. |
| `city` | `public.organizations` | City of the mailing address. |
| `state` | `public.organizations` | State of the mailing address (2 letters). |
| `zip` | `public.organizations` | ZIP code of the mailing address. |
| `ntee_code` | `public.organizations` | NTEE activity code from the IRS master file. Empty for many foundations. |
| `ruling_year` | `public.organizations` | Year the IRS recognized the exemption. |
| `website` | `public.filings` | Website the foundation wrote on its own latest return that states one. |
| `first_fiscal_year` | `public.org_financial_series` | Earliest fiscal year with a parsed return on file. |
| `latest_fiscal_year` | `public.org_financial_series` | Latest fiscal year with a parsed return on file. |
| `years_on_file` | `public.org_financial_series` | Number of fiscal years with a parsed return on file. |
| `latest_total_assets` | `public.org_financial_series` | Total assets at the end of the latest fiscal year, book value, in dollars. |
| `latest_grants_paid` | `public.org_financial_series` | Money paid out for charitable purposes in the latest fiscal year, in dollars. See latest_grants_paid_basis for which line it is. |
| `latest_grants_paid_basis` | `public.org_financial_series` | `qualifying_distributions` (Form 990-PF qualifying distributions) when the return has that line, else `charitable_disbursements` (Part I, column d, total). Empty when the return has neither. |
| `latest_revenue` | `public.org_financial_series` | Total revenue in the latest fiscal year, in dollars. |
| `latest_expenses` | `public.org_financial_series` | Total expenses in the latest fiscal year, in dollars. |
| `grants_on_file` | `public.funding_events` | Number of grant rows this database holds for the foundation, all years. Empty when it holds none. |
| `grants_total_on_file` | `public.funding_events` | Sum of those grant rows, in dollars. |
| `application_posture` | `public.org_application_posture` | `accepts_applications`, `preselected_only` or `not_stated`, from Part XV of the latest parsed Form 990-PF. |
| `has_application_instructions` | `public.org_application_posture` | `t` when that return describes how to apply, `f` when Part XV is there but says nothing useful, empty when there is no Part XV on file. |
| `application_deadline_text` | `public.org_application_posture` | Submission deadlines, exactly as filed. |
| `public_contact_email` | `public.contact_channels` | A role inbox (such as grants@) the foundation printed for applicants. Addresses of named people are never published. |
| `public_contact_phone` | `public.contact_channels` | The phone number the foundation printed for applicants, as +1XXXXXXXXXX. |
| `latest_filing_object_id` | `public.org_financial_series` | IRS OBJECT_ID of the return the latest_* columns come from. |
| `latest_filing_tax_period` | `public.org_financial_series` | Tax period of that return, YYYYMM (the month the fiscal year ended). |
| `source_dataset` | `public.organizations`, `public.filings`, `public.funding_events`, `public.org_application_posture`, `public.contact_channels` | The source datasets this row draws on, separated by `;`. |
| `profile_url` | `public.organizations` | The foundation's page on getfunded.ai. |

Only when `public.org_irs_standing` is in the database:

| Column | Read from | Meaning |
|---|---|---|
| `irs_standing` | `public.org_irs_standing` | What three IRS lists say about the foundation's tax-exempt status: `listed`, `not_listed`, `revoked`, `revoked_then_relisted` or `lists_disagree`. Empty when the lists are not loaded for it. The dates of the lists are in manifest.json. |
| `irs_revocation_date` | `public.org_irs_standing` | Date of the foundation's latest automatic revocation, when the IRS list has one. A foundation that was reinstated later still has a date here, so read irs_standing with it. A listed date from 2020-04-01 to 2020-07-14 reads 2020-07-15, as the IRS says it should. |
| `irs_on_pub78` | `public.org_irs_standing` | `t` when the foundation is in IRS Publication 78 data (organizations that can receive tax-deductible contributions), `f` when it is not. `f` alone does not mean that the foundation lost its status. |

The values of `irs_standing`:

- `listed`: In the IRS master file or in Publication 78, and not on the revocation list.
- `not_listed`: Not in the IRS master file and not in Publication 78. No revocation is in force: it was never on the revocation list, or it was reinstated.
- `revoked`: On the Automatic Revocation of Exemption List with no reinstatement, and in neither the IRS master file nor Publication 78.
- `revoked_then_relisted`: Was on the revocation list and is in the IRS master file or Publication 78 again. A reinstatement or a later ruling date explains it.
- `lists_disagree`: On the revocation list with nothing that explains it, and also in the IRS master file or Publication 78. Check with the IRS.

Only when `public.organizations` has an `address_basis` column. It is the
last column of the file:

| Column | Read from | Meaning |
|---|---|---|
| `address_basis` | `public.organizations` | Where city, state and zip come from: `irs_master_file` (the IRS master file) or `latest_return` (the address the foundation wrote on its latest parsed return; used when the foundation is not in the master file). Empty when there is no address. |

A foundation that is not in the IRS master file has no address there. For
these foundations `funderdb derive org-address --apply` copies the address
from the header of the foundation's newest parsed return (see
"Derived: address from the latest return" in `DATA-SOURCES.md`). Run it
before the export. The export writes `latest_return` only for those rows,
and `irs_master_file` only for an address on a master-file row.

## Columns of `foundation_years.csv.gz`

One row for each foundation and fiscal year with a parsed return. If a
foundation filed two returns that end in the same calendar year, the row
comes from the return with the later end date. The grant counts are for the
fiscal year, so they include the grant rows of both returns.

| Column | Read from | Meaning |
|---|---|---|
| `ein` | `public.org_identifiers` | IRS Employer Identification Number. |
| `getfunded_id` | `public.organizations` | Same id as in foundations.csv.gz. |
| `fiscal_year` | `public.org_financial_series` | The year in which the fiscal year ended. |
| `tax_period_end` | `public.org_financial_series` | Last day of the fiscal year, YYYY-MM-DD. |
| `return_type` | `public.org_financial_series` | `990PF` or `990`. A few organizations that the IRS lists as private foundations filed Form 990 for a year; grants_paid is empty for those years. |
| `total_revenue` | `public.org_financial_series` | Total revenue, in dollars. |
| `total_expenses` | `public.org_financial_series` | Total expenses, in dollars. |
| `total_assets_eoy` | `public.org_financial_series` | Total assets at year end, book value, in dollars. |
| `net_assets_eoy` | `public.org_financial_series` | Net assets or fund balances at year end, in dollars. |
| `grants_paid` | `public.org_financial_series` | Qualifying distributions when the return has that line, else charitable disbursements, in dollars. |
| `grants_paid_basis` | `public.org_financial_series` | Which of the two lines grants_paid is: `qualifying_distributions` or `charitable_disbursements`. |
| `n_grants_on_file` | `public.funding_events` | Grant rows this database holds for that foundation and fiscal year. Empty when it holds none. |
| `grants_linked_on_file` | `public.funding_events`, `public.organizations` | How many of those grant rows are in the grants file of that fiscal year: the rows whose recipient is linked to an organization record. Empty when the database holds no grant rows for the year. |
| `grants_not_linked_on_file` | `public.funding_events`, `public.organizations` | How many of those grant rows are NOT in the grants file. Their recipient is not linked to an organization record, so they are counted here and never named. |
| `amount_not_linked_on_file` | `public.funding_events`, `public.organizations` | Sum of the grant rows that are not in the grants file, in dollars. Empty when there are none. |
| `filing_object_id` | `public.org_financial_series` | IRS OBJECT_ID of the return. |

`grants_linked_on_file` plus `grants_not_linked_on_file` is
`n_grants_on_file`. For one fiscal year, the sum of `grants_linked_on_file`
is the number of rows in the grants file of that year, with one exception:
grant rows of a return whose financial data is not loaded have no row in
this file. `manifest.json` shows both numbers.

## Columns of `foundation_grants_<fiscal_year>.csv.gz`

One file for each fiscal year that has a linked grant. One row for each
grant row (`event_type = 'grant'`) of a private foundation whose recipient is
linked to an organization record. Grants approved for a later year are not
in these files.

| Column | Read from | Meaning |
|---|---|---|
| `funder_ein` | `public.org_identifiers` | EIN of the foundation that made the grant. Same as ein in foundations.csv.gz. |
| `funder_getfunded_id` | `public.organizations` | Id of that foundation. Same as getfunded_id in foundations.csv.gz. |
| `funder_name` | `public.organizations` | Name of that foundation. Same as name in foundations.csv.gz. |
| `recipient_ein` | `public.org_identifiers` | EIN of the organization record the recipient is linked to. Empty when that record has no EIN. |
| `recipient_getfunded_id` | `public.organizations` | Id of that organization record in this database (a UUID). |
| `recipient_name` | `public.organizations` | Name on that organization record. It is NOT the text the foundation typed. |
| `recipient_city` | `public.organizations` | City on that organization record. |
| `recipient_state` | `public.organizations` | State on that organization record (2 letters). |
| `amount` | `public.funding_events` | Amount of the grant as filed, in dollars. |
| `purpose_text` | `public.funding_events` | Purpose of the grant, exactly as the foundation wrote it. |
| `fiscal_year` | `public.funding_events` | The year in which the foundation's fiscal year ended. |
| `filing_object_id` | `public.funding_events` | IRS OBJECT_ID of the return the grant row comes from. |

Only when `public.funding_events` has a `recipient_link_basis` column:

| Column | Read from | Meaning |
|---|---|---|
| `link_basis` | `public.funding_events` | How the recipient was linked to the organization record: `ein_on_return` (the return gives the recipient's EIN), `name_and_state_match` (the name and state on the return match one organization) or `filer_consensus` (other filers wrote this name and state with one EIN). |

## What `manifest.json` holds

| Field | Meaning |
|---|---|
| `vintage`, `generated_at` | When the files were built (UTC). |
| `limit` | The `--limit` value, or `null` for the full list. |
| `grants_row_cap` | The most rows a grants file can hold in a sample, or `null` for the full list. |
| `generator.git_commit` | The commit of the code. It is read from the `.git` folder. Edits that are not committed do not show. |
| `generator.snapshot` | The note that all files were read in one transaction. |
| `license` | CC BY 4.0 for the compilation, the credit line, and the note that the IRS records are public domain. |
| `source_views` | The views that were read. |
| `optional_columns` | For each group of optional columns: if it is in the files and why. For the IRS columns also the dates of the two IRS lists and the count of each `irs_standing` value. For `address_basis` also the count of each value. |
| `source_datasets` | The datasets the rows come from, for example `irs_eo_bmf` and `irs_990_xml`. |
| `index_years_covered` | The IRS index years of the returns in `foundation_years.csv.gz`. |
| `fiscal_years` | The first and last fiscal year in `foundation_years.csv.gz`. |
| `application_posture_counts` | How many foundations have each posture value. |
| `grants_coverage` | For each fiscal year: grant rows on file, how many are linked, how many are not, the dollar sums, the grants file and its row count. Also the totals. |
| `boundary_checks` | The seven checks and their results. |
| `files` | For each CSV: rows, bytes, sha256 of the gzip file, sha256 of the plain CSV, columns, source views, sort order. For a grants file also its fiscal year and the row cap. |

Rows are counted as CSV records. A line break inside a quoted cell is part
of the cell, not a new row.

## How to cite

> Open Funder Database contributors (GetFunded), from IRS e-file data. Open Foundation List, version <vintage>.

The compilation is CC BY 4.0. The IRS records are in the public domain.

## Known limits

- Only returns filed electronically are in the IRS bulk data.
- The years in the files depend on which IRS index years the database has
  loaded. `manifest.json` lists them. `funderdb backfill` adds 2017 to 2020.
- Returns of schema versions before 2021v4.0 that were loaded before
  2026-10-08 have no qualifying distributions value in the database. For
  those years `grants_paid` uses the charitable disbursements line, and
  `grants_paid_basis` says so.
- Name, address, NTEE code and ruling year come from the IRS master file,
  which can be up to two years behind.
- A foundation that is not in the master file has the address from its
  latest parsed return, when `address_basis` is in the build. That address
  is as old as that return. Without that step its city, state and zip are
  empty.
- A foundation that has no return on file still has a row. Its filing
  columns are empty and its posture is `not_stated`.
- When a foundation has more than one public email or phone, the file shows
  the first one in alphabetical order.
- A link between a grant row and an organization record can be wrong. A
  Form 990-PF grant row has no recipient EIN, so its link comes from the
  recipient's name and state.
- The linked organization record can have no EIN (for example a company from
  an SEC filing). Then `recipient_ein` is empty.
- A grant row with no fiscal year is in no grants file. `manifest.json`
  counts these rows under `grants_coverage`.
- In the full build, the query for each fiscal year reads the whole grants
  table once. An index on the fiscal year of linked grant rows would make it
  faster. That is a future migration.

## Where the code is

`src/funderdb/export_foundations.py`. The column lists in this page and in
the `README.md` of each build come from the lists at the top of that file
(`FOUNDATION_COLUMNS`, `IRS_STANDING_SOURCE`, `YEAR_COLUMNS`,
`GRANT_COLUMNS` and `LINK_BASIS_COLUMN`). Change a column there and then
update this page and the dictionary the website uses,
`apps/web/components/marketing/foundations/columns.ts`.
