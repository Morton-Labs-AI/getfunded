# Open Foundation List

The Open Foundation List is a small public download. It lists every U.S.
private foundation in the Open Funder Database, with a few facts about each
one. It is made for people who want a list, not a database.

It is built only from public IRS records. Anyone can use it and share it.

## What you get

One folder for each build, named by its date and time (the "vintage"), for
example `20261008T175342Z`. A text file named `LATEST` holds the name of the
newest folder. Each folder holds:

| File | What it is |
|---|---|
| `foundations.csv.gz` | One row for each private foundation. |
| `foundation_years.csv.gz` | One row for each foundation and fiscal year. |
| `README.md` | The same rules and column lists, for the person who downloads the files. |
| `LICENSE.txt` | The licence and the credit line. |
| `manifest.json` | Row counts, the sha256 of each file, the sources, the checks, the git commit. |

The CSV files are gzip files with UTF-8 text. The first line has the column
names. The rows are sorted by `ein`.

## How to build it

You need a loaded database and `DATABASE_URL` in `.env`.

```
uv run funderdb export foundations --out data/open-foundation-list
```

Options:

| Option | What it does |
|---|---|
| `--out DIR` | Where to publish. Required. Each run writes `DIR/<vintage>/` and updates `DIR/LATEST`. |
| `--limit N` | Write only the first N foundations by EIN. Use it to check the output fast. Each query must finish in 20 seconds. |
| `--no-ledger` | Do not record the run in the database. Use it with a read-only role. |
| `--statement-timeout TEXT` | The time limit for each query. The default is `20s` with `--limit` and `60min` without. |

A quick check that writes nothing to the database:

```
uv run funderdb export foundations --out /tmp/ofl-check --limit 300 --no-ledger
```

The full list needs more than 20 seconds per query. Run it with the pipeline
connection, not with the read-only connection of the web app.

Measured on 2026-10-08 with the read-only role: the 300-foundation sample
took 13 seconds in all, about 1.5 seconds for each of the two queries. The
full list did not finish inside a 20 second limit.

## How it is published

1. The files are written into a temporary folder `DIR/.tmp-<vintage>/`.
2. `manifest.json` is written last.
3. The folder is renamed to `DIR/<vintage>/`. A reader never sees a folder
   without its manifest.
4. `DIR/LATEST` is updated.

If a run stops early, only a `.tmp-` folder is left. The next run deletes it.

The same database gives the same bytes. Two runs on 2026-10-08 gave the same
sha256 for both CSV files. To check a copy, compare its sha256 with the value
in `manifest.json`.

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
   They are empty, not 0, when it holds nothing.
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

## The licence boundary

The export reads only seven views:

- `public.organizations`
- `public.org_identifiers`
- `public.org_application_posture`
- `public.org_financial_series`
- `public.filings`
- `public.funding_events`
- `public.contact_channels`

These views show only records from sources that may be republished. Before
the export writes a file, it runs six checks. One failed check stops the run
and no file is written.

| Check | What it proves |
|---|---|
| F1 | Every output column names its source view, and that view is one of the seven. |
| F2 | Every relation that the two queries read is one of the seven views or a step inside the query. |
| F3 | The SQL names no other schema and does not read `public.filing_application_info`. |
| F4 | The two contact columns come from `public.contact_channels` and from nothing else. No other email or phone column is read. |
| F5 | Each of the seven is a view in schema `public`. |
| F6 | Each view has the columns the queries use. |

The results are in `manifest.json` under `boundary_checks`.

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

## Columns of `foundation_years.csv.gz`

One row for each foundation and fiscal year with a parsed return. If a
foundation filed two returns that end in the same calendar year, the row
comes from the return with the later end date.

| Column | Read from | Meaning |
|---|---|---|
| `ein` | `public.org_identifiers` | IRS Employer Identification Number. |
| `getfunded_id` | `public.organizations` | Same id as in foundations.csv.gz. |
| `fiscal_year` | `public.org_financial_series` | The year in which the fiscal year ended. |
| `tax_period_end` | `public.org_financial_series` | Last day of the fiscal year. |
| `return_type` | `public.org_financial_series` | `990PF` or `990`. |
| `total_revenue` | `public.org_financial_series` | Total revenue, in dollars. |
| `total_expenses` | `public.org_financial_series` | Total expenses, in dollars. |
| `total_assets_eoy` | `public.org_financial_series` | Total assets at year end, book value, in dollars. |
| `net_assets_eoy` | `public.org_financial_series` | Net assets or fund balances at year end, in dollars. |
| `grants_paid` | `public.org_financial_series` | Qualifying distributions when the return has that line, else charitable disbursements, in dollars. |
| `grants_paid_basis` | `public.org_financial_series` | Which of the two lines grants_paid is. |
| `n_grants_on_file` | `public.funding_events` | Grant rows this database holds for that foundation and fiscal year. Empty when it holds none. |
| `filing_object_id` | `public.org_financial_series` | IRS OBJECT_ID of the return. |

## What `manifest.json` holds

| Field | Meaning |
|---|---|
| `vintage`, `generated_at` | When the files were built (UTC). |
| `limit` | The `--limit` value, or `null` for the full list. |
| `generator.git_commit` | The commit of the code. It is read from the `.git` folder. Edits that are not committed do not show. |
| `license` | CC BY 4.0 for the compilation, the credit line, and the note that the IRS records are public domain. |
| `source_views` | The seven views. |
| `source_datasets` | The datasets the rows come from, for example `irs_eo_bmf` and `irs_990_xml`. |
| `index_years_covered` | The IRS index years of the returns in the files. |
| `fiscal_years` | The first and last fiscal year in `foundation_years.csv.gz`. |
| `application_posture_counts` | How many foundations have each posture value. |
| `boundary_checks` | The six checks and their results. |
| `files` | For each CSV: rows, bytes, sha256 of the gzip file, sha256 of the plain CSV, columns, source views, sort order. |

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
- A foundation that has no return on file still has a row. Its filing
  columns are empty and its posture is `not_stated`.
- When a foundation has more than one public email or phone, the file shows
  the first one in alphabetical order.

## Where the code is

`src/funderdb/export_foundations.py`. The column lists in this page and in
the `README.md` of each build come from the two lists at the top of that
file (`FOUNDATION_COLUMNS` and `YEAR_COLUMNS`). Change a column there and
then update this page.
