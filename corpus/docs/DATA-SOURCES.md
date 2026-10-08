# Data sources

Every row in the database comes from a file that was downloaded, hashed and
registered before it was parsed (`docs/PROVENANCE.md`). This page lists the
sources, what we take from each, how often they change, their licence, and
what they do not tell you.

Cache policy terms used below:

- **immutable** — the URL always serves the same bytes (a dated zip); a cached
  copy is reused forever, re-hashed on every use.
- **mutable, N days** — the same URL serves new bytes over time; a cached copy
  is reused for N days, then checked upstream with a conditional request
  (`If-None-Match` / `If-Modified-Since`). `--refresh` checks immediately.

## IRS Exempt Organizations Business Master File (EO BMF)

| | |
|---|---|
| Publisher | Internal Revenue Service, Tax Exempt & Government Entities |
| URL | `https://www.irs.gov/pub/irs-soi/eo1.csv` … `eo4.csv` (four regions) |
| Documentation | <https://www.irs.gov/pub/foia/ig/tege/eo-info.pdf> |
| Cadence | roughly monthly, same filenames |
| Licence | U.S. Government work, public domain (`us_public_domain`) |
| Cache | mutable, 30 days |
| Command | `funderdb ingest bmf` (`--all-orgs` for every exempt org) |
| Dataset name | `irs_eo_bmf` |

What we extract: EIN, name, address, subsection, foundation code, ruling
date, NTEE code, asset / income / revenue amounts. Default scope is private
foundations (foundation codes 02, 03, 04); `--all-orgs` loads the full 2.2M
exempt-organization spine, every non-foundation as `public_charity`.

Known limits: the BMF is a registry, not a behaviour record — it says an
organization *is* a foundation, not that it makes grants. A later BMF never
demotes an organization that has 990-PF grant evidence on file. Amounts are
the most recent return the IRS has processed, which can lag by two years.
Organizations that lost exemption disappear from the file (we keep the row).

## IRS Automatic Revocation of Exemption List

| | |
|---|---|
| Publisher | Internal Revenue Service (Tax Exempt Organization Search bulk data) |
| URL | `https://apps.irs.gov/pub/epostcard/data-download-revocation.zip` |
| Documentation | <https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads>, dataset guide <https://www.irs.gov/pub/irs-pdf/p5891.pdf> |
| Cadence | about monthly, same filename |
| Licence | U.S. Government work, public domain (`us_public_domain`) |
| Cache | mutable, 30 days |
| Command | `funderdb ingest irs-standing` (`--only revocation`, `--dry-run`, `--report`, `--refresh`) |
| Dataset name | `irs_auto_revocation` |
| Tables and views | `internal.irs_revocations`, `internal.irs_list_snapshots`, `internal.org_irs_standing`, `public.irs_revocations`, `public.org_irs_standing` |

What it is: the organizations whose tax exemption was revoked by operation
of law because they filed no annual return or notice for three years in a
row. The IRS must publish this list.

What we extract: EIN, legal name, exemption type, revocation date,
revocation posting date and exemption reinstatement date. Nothing else
leaves the file. The street, city, state, ZIP, country and
doing-business-as name are not loaded and not printed.

File layout: one pipe-delimited text file in the zip, UTF-8, no header
row. The file starts with two blank lines and ends with one. Each data line
has 12 fields. The loader prints and checks the first three data lines on
every run and stops, with nothing loaded, when a line does not have 12
fields or field 10 is not a date like `15-NOV-2017`.

How it is loaded: every row of the file, not only EINs that the database
already holds. Each load is a full snapshot in one transaction. Rows that
the new file no longer carries are deleted, and
`internal.irs_list_snapshots` records which file the table now holds. A
load of the same file again changes nothing. A new file that holds under
90% of the rows now loaded is refused, because it is probably cut off
(`--allow-shrink` loads it as it is).

Known limits:

- It is the **automatic** revocation list only. A revocation after an IRS
  examination is not in it.
- An organization on the list can be recognized again. The file then
  carries a reinstatement date, or the organization is in the master file
  or on Publication 78. `internal.org_irs_standing` (migrations 0028 and
  0032) calls an organization `revoked` when it has a revocation row with
  no valid reinstatement, Publication 78 does not list it, and one of these
  is true:
  - it is not in the master file; or
  - it is in the master file, it has no ruling date after the (corrected)
    revocation date, and the copy of the master file that its row came from
    is older than the day the IRS posted the revocation (`posting_date` is
    later than `bmf_as_of`). That copy could not know about the revocation,
    so the newer list is followed (migration 0032). A reader tells this
    case by `standing = 'revoked'` with `in_bmf = true`.
- `lists_disagree` is kept for a real conflict: a revocation row with no
  valid reinstatement and no later ruling date, and Publication 78 lists
  the organization, or the master-file copy is as new as the posting date
  or newer, or the posting date is not on record.
- `revoked_then_relisted` means a revocation row, the master file or
  Publication 78 lists the organization, and a valid reinstatement or a
  ruling date after the revocation date explains it.
- A revoked organization can still file returns. Migration 0032 adds two
  columns that show it. `filed_after_revocation` is empty when there is no
  revocation row. It is true when a return on file covers a tax year after
  the (corrected) revocation date: the tax year ends more than 12 months
  after that date and, where the begin date is on record, begins after it.
  `latest_tax_period_end` is the end of the newest tax year a return is on
  file for. Only returns that are not superseded and that may be
  republished are read. The standing value does not change: an organization
  that loses its exemption must still file, so a later return does not show
  that the IRS reinstated it. The website's "Hide automatically revoked"
  filter keeps these organizations in the results.
- A reinstatement date counts only when it is on or after the revocation
  date. 88 rows carry a reinstatement date that is earlier than the
  revocation date. The list shows only that. It does not show a second
  revocation after an earlier reinstatement: none of those EINs has an
  earlier revocation row. (A comment in migration 0028 says otherwise; the
  header of migration 0032 corrects it.) The rule is unchanged: such a date
  does not count as a reinstatement.
- The IRS says that a listed revocation date from 1 April 2020 to 14 July
  2020 is wrong and should read 15 July 2020 (31,685 rows). The table keeps
  the date as filed. The views add `effective_revocation_date` with the
  corrected date.
- `in_bmf` means "the organization row was last written by a master-file
  load". This is correct while one master-file vintage is loaded. After the
  next `ingest bmf --refresh`, an organization that left the master file
  keeps its old file and stays `in_bmf = true`. Change the rule to "the
  row's file belongs to the newest master-file vintage" before that refresh.
- Standing is NULL for every organization until both this list and
  Publication 78 are loaded.

Measured on the file dated 2026-09-30: 1,247,069 rows, 1,227,606 EINs,
1,065,369 EINs with no reinstatement date on the latest row.

## IRS Publication 78 data

| | |
|---|---|
| Publisher | Internal Revenue Service (Tax Exempt Organization Search bulk data) |
| URL | `https://apps.irs.gov/pub/epostcard/data-download-pub78.zip` |
| Documentation | <https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads>, code list <https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-deductibility-status-codes> |
| Cadence | about monthly, same filename |
| Licence | U.S. Government work, public domain (`us_public_domain`) |
| Cache | mutable, 30 days |
| Command | `funderdb ingest irs-standing` (`--only pub78`, `--dry-run`, `--report`, `--refresh`) |
| Dataset name | `irs_pub78` |
| Tables and views | `internal.irs_pub78`, `internal.irs_list_snapshots`, `internal.org_irs_standing`, `public.irs_pub78`, `public.org_irs_standing` |

What it is: the organizations that the IRS lists as eligible to receive
tax-deductible charitable contributions.

What we extract: EIN and the deductibility status codes (`PC`, `PF`,
`POF`, `SO`, `SONFI`, `SOUNK`, `EO`, `LODGE`, `GROUP`, `FORGN`, `UNKWN`,
`FED`). The name, city, state and country are not loaded.

File layout: one pipe-delimited text file in the zip, UTF-8, no header
row, two blank lines at the start and one at the end, 6 fields per data
line. The same three-line check applies.

How it is loaded: every row, as a full snapshot in one transaction, the
same as the revocation list.

Known limits: absence from this list is not a negative on its own.
Churches and the subordinate units of a group ruling can receive deductible
gifts without being listed, and many master-file charities are not on it.
A "doing business as" name is never in the file.

Measured on the file dated 2026-09-10: 1,419,989 rows, one per EIN.

## IRS Form 990 series e-file index and XML

| | |
|---|---|
| Publisher | Internal Revenue Service (Tax Exempt Organization Search bulk data) |
| Index URL | `https://apps.irs.gov/pub/epostcard/990/xml/{YEAR}/index_{YEAR}.csv` |
| XML URL | `https://apps.irs.gov/pub/epostcard/990/xml/{YEAR}/{YEAR}_TEOS_XML_{NN}{A-H}.zip` (2021 and later; 2017 to 2020 use older names, see below) |
| Cadence | index: appended through the year as returns are processed; zips: posted in batches, immutable once posted |
| Licence | public domain (`us_public_domain`) |
| Cache | index: mutable, 7 days for the current year, 90 days for past years; zips: immutable |
| Commands | `ingest filings` (index only), `ingest 990pf`, `ingest 990pf-detail`, `ingest 990`, `ingest 990-detail`, `ingest websites`, `backfill` (2017 to 2020, one zip at a time) |
| Dataset name | `irs_990_xml` |

What we extract:

- **Filings spine** (`ingest filings`): every indexed 990 and 990-PF —
  object id, EIN, return type, tax period, DLN, batch — plus the
  amended-return supersession sweep. No zips needed.
- **990-PF** (`ingest 990pf`, `990pf-detail`): officers and trustees with
  compensation (corporate trustees kept separate from people), grants paid
  and approved for future payment (recipient, address, purpose, amount),
  51 financial-statement lines (Parts I/II/III/VI/X/XI/XII/XIII/XV),
  Schedule B contributors (unredacted in public 990-PF XML), Part XV
  application information and contacts.
- **990** (`ingest 990`, `990-detail`): Schedule I grants to organizations,
  core-form financials, Part IX program/admin split, Part VII compensation.
- **Websites** (`ingest websites`): filer-stated `WebsiteAddressTxt`.

Known limits: the IRS publishes XML only for returns filed electronically and
only in batches; at any time tens of thousands of indexed returns have no
XML yet (we record them in the spine with nothing attached). 990-EZ, 990-N,
990-T and paper returns are not in this feed. Batch labels in the index are
unreliable (about 30% of filings are physically in a different zip), so
processing is membership-driven. Filer-entered numbers can be absurd; the
parser clamps out-of-range values to NULL. NULL means the line is absent
from the return; `0` means the filer reported zero.

### Index years 2017 to 2020: older file names

The IRS still serves the index CSV and the XML zips for 2017, 2018, 2019 and
2020. The files for 2016 and earlier are gone (the host answers with a
redirect to an error page). The zips of these four years do not use the
`{YEAR}_TEOS_XML_{NN}{A-H}.zip` pattern. They use two older patterns:

- `download990xml_{YEAR}_{N}.zip` holds the returns of the year, in
  object-id order;
- `{YEAR}_TEOS_XML_CT{N}.zip` holds returns the IRS added later.

The names cannot be guessed, so the code records them
(`LEGACY_BATCHES` in `src/funderdb/sources/irs_990pf.py`). The table shows
what a HEAD request to `apps.irs.gov` returned on 2026-10-08. The folder is
`https://apps.irs.gov/pub/epostcard/990/xml/{YEAR}/`. "On IRS page" says if
the [Form 990 series downloads page](https://www.irs.gov/charities-non-profits/form-990-series-downloads)
links the file today. The page lists 2019 and later. The 2017 and 2018 files
are not linked, but the host still serves them.

| Year | File | Bytes | Size | Returns in zip | Compression | On IRS page |
|---|---|---:|---:|---:|---|---|
| 2020 | `download990xml_2020_1.zip` | 410,636,484 | 410.6 MB | 65,551 | Deflate | yes |
| 2020 | `download990xml_2020_2.zip` | 403,633,186 | 403.6 MB | 63,059 | Deflate | yes |
| 2020 | `download990xml_2020_3.zip` | 402,519,268 | 402.5 MB | 63,286 | Deflate | yes |
| 2020 | `download990xml_2020_4.zip` | 412,449,605 | 412.4 MB | 66,199 | Deflate | yes |
| 2020 | `download990xml_2020_5.zip` | 407,097,915 | 407.1 MB | 64,273 | Deflate | yes |
| 2020 | `download990xml_2020_6.zip` | 404,259,826 | 404.3 MB | 63,219 | Deflate | yes |
| 2020 | `download990xml_2020_7.zip` | 406,249,542 | 406.2 MB | 64,474 | Deflate | yes |
| 2020 | `download990xml_2020_8.zip` | 164,852,375 | 164.9 MB | 25,293 | Deflate | yes |
| 2020 | `2020_TEOS_XML_CT1.zip` | 374,013,631 | 374.0 MB | 65,723 | Deflate64 | yes |
| 2020 | **9 zips** | **3,385,711,832** | **3.39 GB** | | | |
| 2019 | `download990xml_2019_1.zip` | 405,230,455 | 405.2 MB | 65,088 | Deflate | yes |
| 2019 | `download990xml_2019_2.zip` | 402,125,774 | 402.1 MB | 63,726 | Deflate | yes |
| 2019 | `download990xml_2019_3.zip` | 403,135,309 | 403.1 MB | 63,477 | Deflate | yes |
| 2019 | `download990xml_2019_4.zip` | 407,401,876 | 407.4 MB | 65,191 | Deflate | yes |
| 2019 | `download990xml_2019_5.zip` | 399,048,882 | 399.0 MB | 62,612 | Deflate | yes |
| 2019 | `download990xml_2019_6.zip` | 394,490,221 | 394.5 MB | 61,459 | Deflate | yes |
| 2019 | `download990xml_2019_7.zip` | 406,778,542 | 406.8 MB | 65,068 | Deflate | yes |
| 2019 | `download990xml_2019_8.zip` | 190,353,313 | 190.4 MB | 28,954 | Deflate | yes |
| 2019 | `2019_TEOS_XML_CT1.zip` | 15,817 | 0.0 MB | 3 | Deflate | yes |
| 2019 | **9 zips** | **3,008,580,189** | **3.01 GB** | | | |
| 2018 | `download990xml_2018_1.zip` | 405,852,961 | 405.9 MB | 64,738 | Deflate | no |
| 2018 | `download990xml_2018_2.zip` | 402,189,942 | 402.2 MB | 63,170 | Deflate | no |
| 2018 | `download990xml_2018_3.zip` | 407,493,755 | 407.5 MB | 64,998 | Deflate | no |
| 2018 | `download990xml_2018_4.zip` | 404,723,587 | 404.7 MB | 65,009 | Deflate | no |
| 2018 | `download990xml_2018_5.zip` | 408,094,770 | 408.1 MB | 64,169 | Deflate | no |
| 2018 | `download990xml_2018_6.zip` | 406,406,859 | 406.4 MB | 63,938 | Deflate | no |
| 2018 | `download990xml_2018_7.zip` | 301,672,836 | 301.7 MB | 47,449 | Deflate | no |
| 2018 | `2018_TEOS_XML_CT1.zip` | 408,154,337 | 408.2 MB | 69,065 | Deflate64 | no |
| 2018 | `2018_TEOS_XML_CT2.zip` | 408,862,000 | 408.9 MB | 69,065 | Deflate | no |
| 2018 | `2018_TEOS_XML_CT3.zip` | 420,140,132 | 420.1 MB | 69,064 | Deflate64 | no |
| 2018 | **10 zips** | **3,973,591,179** | **3.97 GB** | | | |
| 2017 | `download990xml_2017_1.zip` | 410,883,001 | 410.9 MB | 66,613 | Deflate | no |
| 2017 | `download990xml_2017_2.zip` | 410,054,163 | 410.1 MB | 65,391 | Deflate | no |
| 2017 | `download990xml_2017_3.zip` | 411,234,704 | 411.2 MB | 65,734 | Deflate | no |
| 2017 | `download990xml_2017_4.zip` | 411,728,756 | 411.7 MB | 65,639 | Deflate | no |
| 2017 | `download990xml_2017_5.zip` | 408,880,532 | 408.9 MB | 65,596 | Deflate | no |
| 2017 | `download990xml_2017_6.zip` | 411,037,347 | 411.0 MB | 65,835 | Deflate | no |
| 2017 | `download990xml_2017_7.zip` | 170,853,823 | 170.9 MB | 26,515 | Deflate | no |
| 2017 | `2017_TEOS_XML_CT1.zip` | 23,112,306 | 23.1 MB | 3,954 | Deflate | no |
| 2017 | **8 zips** | **2,657,784,632** | **2.66 GB** | | | |

All four years: 36 zips, 13,025,667,832 bytes (13.03 GB).

Seven of these zips were downloaded on 2026-10-08 to check the parsers. The
sha256 values below are what the IRS served on that day. The zips do not
change, so a new download must give the same value.

| File | sha256 |
|---|---|
| `download990xml_2017_7.zip` | `34b3fad8318a8ee4580d96ab5d2ff045fb65ae06014c5e3e97fcbe061d2bf2ee` |
| `2017_TEOS_XML_CT1.zip` | `73a7c467aef65b14fa8f4d491abdbed4dbadffc012c420cae916f666e7a76d58` |
| `download990xml_2018_7.zip` | `5c1d485f48d27cce28db9442f50a3c2ab59a607fd4f18ac9965c8ef318390c45` |
| `download990xml_2019_8.zip` | `6cd5a925638361d8dc19f42cb4b6771b0d1fd9a966008bcd4c4d188da4a2b42b` |
| `2019_TEOS_XML_CT1.zip` | `33b5c88e141617eb58fb2089b411840192dc996e62248638a69447a5b35e9018` |
| `download990xml_2020_8.zip` | `5dd964a3d3b8d843c11c532cad18789394f331da234ae11d40aafb05311c887e` |
| `2020_TEOS_XML_CT1.zip` | `d19fe9f97901e38e8a722c227beffeba60cf641d96e86c73a56e57e5ec1cddc7` |

Index CSV files (`index_{YEAR}.csv`, all last changed by the IRS in July 2023):

| Year | Bytes | Rows | 990-PF rows | Form 990 rows |
|---|---:|---:|---:|---:|
| 2017 | 62,311,681 | 488,780 | 68,438 | 274,442 |
| 2018 | 58,185,653 | 457,274 | 67,520 | 253,435 |
| 2019 | 52,899,717 | 416,656 | 64,614 | 227,302 |
| 2020 | 50,674,862 | 399,078 | 57,968 | 212,238 |

The index columns are `RETURN_ID, FILING_TYPE, EIN, TAX_PERIOD, SUB_DATE,
TAXPAYER_NAME, RETURN_TYPE, DLN, OBJECT_ID`. This is the same layout as 2021
to 2023. There is no `XML_BATCH_ID` column, so the loader finds a filing's
XML by membership: it reads the member list of each zip and matches
`<OBJECT_ID>_public.xml`.

Facts measured on these files on 2026-10-08. The loader depends on each one.

1. **Two return types have other codes.** The index writes `990O` for a Form
   990 from an organization that is not a 501(c)(3). The 2020 index writes
   `990PR` for 30,085 Form 990-PF returns (all of them are in
   `2020_TEOS_XML_CT1.zip`). The loader reads `990O` as `990` and `990PR` as
   `990PF`. The return type inside the XML agrees on every return checked.
   The row counts in the table above already include them.
2. **A zip holds returns by object-id year, not by index year.** The index
   of year Y also lists returns that the IRS received late in year Y-1.
   Their object ids start with Y-1, and their XML is in the Y-1 zips. For
   990-PF this is 12,000 (2018 index), 12,508 (2019 index) and 22,108 (2020
   index) returns. `funderdb backfill` therefore checks each zip against the
   index of its own year and of the next year.
3. **The 2017 index is not complete in the zips.** 18,701 of its 990-PF rows
   have object ids that start with 2016. Those returns were in the 2016
   zips, which are gone. They stay in the filings spine with no data. 198
   more 2017 rows and 74 of the 2018 rows are in no zip.
4. **The 2020 zips hold returns that are in no index.** The 2020 index stops
   listing 990-PF returns near the end of September 2020, and the 2021 index
   starts in January 2021. The 2020 zips hold 47,750 Form 990-PF returns and
   145,766 Form 990 returns that no index lists. (These two numbers come
   from the member lists of all nine zips. The form was read from the object
   id and checked against the XML in one zip.) A sample of 3,891 of these
   990-PF returns had 3,225 for tax year 2019 and 633 for tax year 2020.
   `funderdb backfill` loads them by default. It reads the EIN, the tax
   period, the form and the name from the header of the return. The zip is
   the raw file of the row. On 42,851 returns that an index does list, these
   header values agree with the index on every return. `--indexed-only`
   turns this off. The other three years have about 100 such returns each.
5. **Three zips are Deflate64.** `2018_TEOS_XML_CT1.zip`,
   `2018_TEOS_XML_CT3.zip` and `2020_TEOS_XML_CT1.zip` use compression
   method 9. Python's `zipfile` cannot read it. The loader uses `7zz` when
   it is installed (`brew install sevenzip`) and a slower pure-Python reader
   when it is not. It extracts 5,000 returns at a time, so the temporary
   folder stays near 200 MB. All other old zips are plain Deflate. All
   members are flat (`<OBJECT_ID>_public.xml`, no folders).
6. **The catch-up zips repeat returns.** Most returns in the three 2018 CT
   zips are also in the `download990xml_2018_*` zips. 5,172 of their 990-PF
   returns are only there, so every zip is needed. A return that is already
   loaded is skipped.
7. **One schema element has an older name.** In return versions before
   2021v4.0 the Part XII group is `QualifyingDistriPartXIIGrp`. Later
   versions call it `PFQualifyingDistributionsGrp`. The parser reads both.
   No other 990-PF column and no part of the grant table changed name
   between versions 2014v6.0 and 2019v5.1.

Distinct returns that the zips of each year hold (index rows found, plus
returns in no index):

| Zip year | 990-PF in an index | 990-PF in no index | Form 990 in an index | Form 990 in no index |
|---|---:|---:|---:|---:|
| 2017 | 61,465 | 93 | 236,018 | 62 |
| 2018 | 68,028 | 115 | 252,259 | 45 |
| 2019 | 72,375 | 108 | 261,168 | 63 |
| 2020 | 37,699 | 47,750 | 127,611 | 145,766 |

### Repairing qualifying distributions

Fact 7 above left a hole in data that was loaded before the parser read both
names. On every Form 990-PF return of version 2018v3.x, 2019v5.x or 2020v4.x
that was loaded before that fix, `qualifying_distributions` is empty in
`internal.filing_financials`. The return states the amount. The old parser
did not find it. New loads are correct. A loader does not read a filing a
second time, so the old rows stay empty until they are repaired.

`funderdb repair qualifying-distributions` repairs them. It does these steps:

1. It reads the affected rows from the database with one read-only query:
   Form 990-PF, one of the three versions, the column empty, and an object
   id that starts with one of `--years` (default 2021, 2022, 2023).
2. It groups the rows by the zip they were parsed from. Each row already
   names that zip (`raw_file_id`), and `raw_files` has the URL, the size and
   the sha256 of the zip. No index file is read and no zip name is guessed.
3. For each zip it uses a copy that is on this machine: first the staging
   folder (`data/raw/irs_990_xml/`), then each `--also-look-in` folder. If
   there is no copy, it downloads the zip (resume and sha256, as all loaders
   do). It does not start a download that would leave less free disk than
   `--min-free-gb`.
4. It compares the sha256 of the zip with the sha256 in `raw_files`. If they
   are different, it does not use the zip, and the rows of that zip stay as
   they are. This keeps the source of each row true: the repair does not
   change `raw_file_id`.
5. It reads only the affected returns from the zip, reads Part XII with the
   same parser code that the loaders use, and fills the column, 5,000 rows
   for each transaction.
6. It writes one ledger row for each zip. The notes start with
   `repair:qualifying-distributions` and hold the counts.
7. With `--discard-zips` it deletes the zip, but only a zip that this
   command downloaded.

Rules that the command obeys:

- It never changes a value that is not empty. The UPDATE statement checks
  this itself.
- A return that states no Part XII amount stays empty. The app shows "Not
  available" for it. A return that states 0 gets 0.
- It never writes, renames or deletes a file in an `--also-look-in` folder.
- It never deletes a zip that was on disk before it ran.

You can run the command again at any time. A row that was filled is not
read again. A zip that is complete in the ledger is not opened or downloaded
again. If a run stops in the middle of a zip, the next run does that zip
again and reads only the rows that are still empty.

| Option | Effect |
|---|---|
| `--dry-run` | Plan only: the zips, their sizes, the returns in each zip, what is on this machine, the total download and the free disk. It reads the database. It writes nothing and downloads nothing. |
| `--also-look-in DIR` | An extra folder that can hold the zips. Read only. You can give it more than once. |
| `--years 2021,2022,2023` | Object-id years of the returns to repair (the first four digits of the object id). |
| `--limit-zips N` | Stop after N zips. |
| `--min-free-gb 6` | The free disk that a download must leave. |
| `--prefetch N` | Get up to N zips ahead with one worker thread. |
| `--discard-zips` | Delete each zip that this command downloaded, after its ledger row is written. |
| `--no-resume` | Do the zips again that the ledger marks complete. |

When the repair is done, run `funderdb refresh-views`. The app reads the
newest financials of each funder from a materialized view.

Numbers for the hosted database, measured on 2026-10-08:

- 127,702 returns were affected: 474 of version 2018v3.x, 12,610 of 2019v5.x
  and 114,618 of 2020v4.x. Before the repair the column was empty on all of
  them.
- They were parsed from 17 zips (12.41 GB): `2021_TEOS_XML_01A` (108,644
  returns), `2022_TEOS_XML_01A` (15,579), `2022_TEOS_XML_02A` (1,422), the
  twelve `2023_TEOS_XML_*` zips (1,719), `2024_TEOS_XML_01A` (5) and
  `2024_TEOS_XML_07A` (333).
- Returns of the same versions whose object id starts with 2020 or an
  earlier year were loaded later by `funderdb backfill`, with the corrected
  parser. An empty value on those returns means that the return states no
  amount. The default `--years` leaves them out.
- 118,757 of the 127,702 returns state a Part XII amount (93.0%). The other
  8,945 state none and stay empty after the repair. These two numbers were
  read from the 17 zips before the repair ran. The return counts for each
  zip and each version were the same in the zips and in the database.
- Speed on a laptop: 2 GB of zip hashed each second, and 1,530 returns read
  and parsed each second.

If a download gives bytes that are not the registered ones, the command
moves that file aside as `.corrupt_<name>` in the staging folder and reports
the zip. Delete that file by hand when you have looked at it.

## SEC Form ADV — daily firm feed (IAPD)

| | |
|---|---|
| Publisher | U.S. Securities and Exchange Commission, Investment Adviser Public Disclosure |
| URL | `https://reports.adviserinfo.sec.gov/reports/CompilationReports/IA_FIRM_SEC_Feed_MM_DD_YYYY.xml.gz` |
| Cadence | regenerated daily; the server keeps about 7 days of files |
| Licence | public domain (`us_public_domain`) |
| Cache | each dated file is immutable; `ingest adv` reuses the newest staged feed for 7 days, then fetches the newest available day. Ordered by the date in the filename, never by hash. |
| Command | `funderdb ingest adv [--feed-date YYYY-MM-DD] [--refresh]` |
| Dataset name | `sec_form_adv` |
| Requires | `SEC_USER_AGENT` |

What we extract: every SEC-registered adviser and exempt reporting adviser
(~23,600 firms): CRD, SEC file number, names, main address, phone (internal
only), website, regulatory assets under management, whether it advises
private funds, registration type and status.

Known limits: a snapshot of registration state, not of investment activity.
Family offices and many venture firms are exempt from ADV and absent. Phone
numbers are loaded as `internal_only` and never published. Rows carry the
feed date as their verification time.

## SEC Form ADV — monthly filing zips (Schedules A/B, Schedule D 7.B.1)

| | |
|---|---|
| Publisher | SEC, FOIA ADV filing data |
| URL | `https://reports.adviserinfo.sec.gov/reports/foia/advFilingData/{YYYY}/ADV_Filing_Data_{start}_{end}.zip` |
| Cadence | monthly |
| Licence | public domain |
| Cache | immutable per zip; `ingest adv-schedules` reads already-staged zips under `data/raw/sec_form_adv_filings/` |
| Command | `funderdb ingest adv-schedules` |
| Dataset name | `sec_form_adv_filings` |
| Requires | `SEC_USER_AGENT` (to stage) |

What we extract: individual owners and executives (people and
owner_of / executive_of relationships), private funds (7.B.1) with gross
asset value, manages_fund edges, and an adviser classification (`vc`, `pe`).

Known limits: filings in the window, not a snapshot — the latest filing per
CRD wins. Entity owners (other firms) are counted but not loaded.

## SEC Form D — quarterly structured data sets

| | |
|---|---|
| Publisher | SEC, Office of Structured Disclosure |
| URL | `https://www.sec.gov/files/structureddata/data/form-d-data-sets/{yyyy}q{n}_d.zip` |
| Cadence | quarterly, posted about five weeks after quarter end |
| Licence | public domain |
| Cache | immutable per quarter |
| Command | `funderdb ingest formd [--start 2024q1]` |
| Dataset name | `sec_form_d` |
| Requires | `SEC_USER_AGENT` |

What we extract: issuers (as `fund` or `company`) with CIK, Reg D offerings
as `reg_d_offering` events, related persons as people with roles.
Amendments (D/A) supersede their predecessor offering.

Known limits: Form D names the issuer raising money, never the investors.
It must not be read as a portfolio or deal graph. Offerings whose first sale
is "yet to occur" have a NULL event date.

## SBIR / STTR award data

| | |
|---|---|
| Publisher | U.S. Small Business Administration, SBIR.gov |
| URL | `https://data.www.sbir.gov/mod_awarddatapublic_no_abstract/award_data_no_abstract.csv` |
| Cadence | irregular |
| Licence | public domain |
| Cache | mutable, 30 days |
| Command | `funderdb ingest sbir [--refresh]` |
| Dataset name | `sbir_awards` |

What we extract: awardee companies (with UEI/DUNS when present), awards as
`sbir_award` / `sttr_award` events linked to the seeded agency and program,
principal investigators and points of contact as people. Contact details
are loaded `internal_only` at the `yellow` tier and never published.

Known limits: the bulk file has no stable award id; we dedupe on a hash of
company, agency, contract, phase, program and year. Abstracts are excluded
on purpose (the no-abstract variant avoids embedded-newline breakage).

## Curated seed: federal agencies and programs

| | |
|---|---|
| Publisher | this project's maintainers |
| Files | `data/seed/federal_agencies.csv`, `data/seed/federal_programs.csv` |
| Cadence | edited by pull request |
| Licence | CC BY 4.0 (`cc_by`), an original compilation |
| Command | `funderdb ingest seed` |
| Dataset names | `seed_federal_agencies`, `seed_federal_programs` |

What it holds: 10 agencies and 16 non-dilutive federal programs with
descriptions, eligibility notes, award ranges and URLs.

Known limits: award figures and URLs are curated estimates pending review by
each program's own documentation. Attribution is required when republished.

## Entity-resolution labels

| | |
|---|---|
| Files | `data/seed/er_labels/*.csv` |
| Licence | CC BY 4.0 |
| Command | `funderdb resolve export-labels` writes them; `resolve eval` reads them |

Human match / not-match decisions on candidate pairs. They gate the
canonical-map apply (`docs/PROVENANCE.md`, "supersession and gates").

## Funder websites (internal only)

| | |
|---|---|
| Licence | `publisher_website` — all rights reserved by the publisher; **not republishable** |
| Dataset name | `funder_website` |

Page snapshots fetched for profile enrichment, with human-reviewed extracted
facts in `internal.org_web_facts`. Structurally excluded from every
`public.*` view and from the export (boundary assertion X6). Listed here so
the exclusion is visible, not hidden.

## Derived: semantic-search documents and embeddings

Not a source. `funderdb embed sync` aggregates the rows above into one
document per organization or program and embeds it with Voyage AI
(`voyage-3.5`, 512 dimensions). Documents are derived rows whose provenance
is the facts they summarise; the embedding run is ledgered, not
raw-file-registered.

## Derived: recipient aliases (filers as witnesses)

| | |
|---|---|
| Publisher | this project: our own compilation of rows that are already in the database |
| Inputs | Form 990 Schedule I grant rows and Form 990-PF grant rows in `internal.funding_events` |
| Cadence | by hand, after a load of new returns |
| Licence | CC BY 4.0 (`cc_by`), an original compilation. The input rows are U.S. public domain |
| Command | `funderdb resolve aliases --build`, `--report`, `--sample N --out FILE`, `--apply`, `--unapply` |
| Dataset name | `resolve_aliases` (the raw file is the rule manifest of the build) |
| Tables | `internal.recipient_aliases`, `internal.recipient_alias_links`, views `public.recipient_aliases` and `public.recipient_alias_links` (migration 0034) |

Not a download. A Form 990-PF names each grant recipient but gives no EIN. A
charity that files Schedule I of Form 990 writes the EIN next to the name.
The build reads the Schedule I rows whose EIN we hold and stores one row for
each recipient name and state that two or more different filers wrote:

- `n_filers` is the number of different filers that wrote the name and state
  with the EIN of `org_id`.
- `status` is `unanimous` when every filer wrote the same EIN, `dominant`
  when more than one EIN was written and one has 5 or more filers and 95% or
  more of all filers, and `contested` for the rest. A key is also
  `contested` when the filers that wrote the name with no EIN we hold are
  half as many as `n_filers` or more.
- `witness_cities` holds the cities those filers wrote, and the
  organization's own city.

`--apply` links a 990-PF grant row to `org_id` only when all of these are
true: the alias is `unanimous`, it has 3 or more filers, the row has the same
normalized name and the same state, and the city on the row is in
`witness_cities`. It writes one row in `internal.recipient_alias_links` for
each grant row that it changes. `--unapply` removes those links again; it
leaves a row alone if another job or a person changed the link after us.

How to tell that a grant row was linked this way: a grant row whose `id` is
in `internal.recipient_alias_links` was linked by filer consensus. The open
form of that table is the view `public.recipient_alias_links` (`event_id`,
`alias_id`, `recipient_org_id`, `link_basis`, `n_filers`, `alias_status`,
`linked_at`). `event_id` is `public.funding_events.id`, and `link_basis` is
always `filer_consensus`. The view shows a row only while the grant row still
points at the organization of the alias, and only when both rows may be
republished. A grant row that is not in the view was not linked this way: its
link came with the return (an EIN on Schedule I) or from the name matcher.
Join `alias_id` to `public.recipient_aliases.id` to read the evidence.
`public.funding_events` has no link-basis column of its own; the grants table
is too large to rewrite for it. The Open Foundation List writes this fact as
the column `link_basis` of its grants files (`filer_consensus` or
`name_match`; see `OPEN-FOUNDATION-LIST.md`).

A later `--build` and an alias that already has links: the alias keeps its
`org_id`, because the links were made to that organization and `--unapply`
compares with it. Its `status` and its counts are counted again from the new
evidence. If the filers no longer support it (a second EIN appeared, the
filers now point at another organization, fewer than 2 filers are left, or
the name matcher now holds the key), the status becomes `contested` and
`n_filers` is the number of filers that still write the name with the EIN of
`org_id` (0 when none does; `top_share` is then empty). `--apply` links
nothing new through such an alias. The links it already made stay until
`--unapply`. `--report` prints how many linked aliases are no longer
supported and how many grant rows are linked through them.

`--apply` and `--unapply` work in batches of alias ids. The first batch has
`--batch` ids (default 500). The next batches are larger while a batch is
fast and half as large when a batch is slow. A batch that passes
`--batch-timeout` seconds (default 300) writes nothing and is done again at
half the size. One alias that is too slow alone gets a longer limit; if the
longest limit is not enough, the alias is skipped, the other aliases are
still done, and the command ends with an error that lists the skipped ids.
The command says "finished" only when every alias id was visited.

A command that was stopped can be run again. It continues where it stopped
only if its cursor file (`data/resolve/aliases_apply_cursor.json` or
`aliases_unapply_cursor.json`) belongs to the same work: the same direction,
the same last `--build`, no `--apply` or `--unapply` in the other direction
since, and for `--apply` no finished load of returns since. If not, it prints
why and starts at the first alias. That is always correct; it only takes
longer. `--apply` links the rows that are in the database when it runs, so
run it again after each load of returns.

Rules that the command obeys:

- It never links a Schedule I row. An unlinked Schedule I row can carry an
  EIN that we do not hold.
- It never applies a `dominant` or `contested` alias, or an alias with fewer
  than 3 filers. `--min-filers` cannot go below 3.
- It never changes a recipient name or an amount, and it never makes a new
  organization row.
- It stores no alias for filler text such as "SEE ATTACHED", "VARIOUS",
  "UNKNOWN" or "GRANTS UNDER 5,000" (`internal.is_placeholder_recipient`,
  second version in migration 0034), for a name shorter than 6 characters,
  or for a key that `internal.recipient_matches` already holds. The name
  "OTHERS" alone is not on the filler list, because an organization with
  exactly that name is in the database.
- No model is called.

Known limits: no person has labelled these links yet; run `--sample` and read
the file before `--apply`. A name is sometimes written with the EIN of a
parent body (a school with the EIN of its parish, a project with the EIN of
its fiscal sponsor), so a link means "filers wrote this name with this
organization's EIN", not "this is the same legal entity". There is no
command that removes only the links of aliases that are no longer supported;
`--unapply` removes all links, and `--apply` then makes the supported ones
again.

## Derived: city, state and ZIP code from the latest return

| | |
|---|---|
| Publisher | this project: a copy of values that are already in the database |
| Inputs | the city, state, ZIP code and country in the header of each parsed return (`internal.filings.filer_city`, `filer_state`, `filer_zip`, `filer_country`) |
| Cadence | by hand, after a load of new returns and after the detail pass |
| Licence | CC BY 4.0 (`cc_by`) for the rule manifest. The address values are U.S. public domain |
| Command | `funderdb derive org-address --dry-run`, `--apply`, `--report`, `--unapply` |
| Dataset name | `derive_org_address` (the raw file is the rule manifest) |
| Columns | `internal.organizations.address_basis`, `address_object_id` (migration 0030), also on `public.organizations` |

Not a download. An organization that is made from an e-filed return and is
not in the IRS master file has no address on its row. `--apply` gives it the
city (in upper case), state and ZIP code that its own newest parsed,
non-superseded return states. It sets `address_basis` to `filing_header`
and `address_object_id` to the IRS OBJECT_ID of that return. An empty
`address_basis` means what it always meant: the address came with the row's
own source record.

**The privacy rule: an organization's street address from a return is not
copied to its profile.** The street line of a return can name a person
("C/O" and a name) or be the home of a trustee. Measured on the live
database on 2026-10-08: 730 of the 51,010 street lines this command could
have copied held "C/O", "ATTN", "care of" or a percent sign, and about half
of those read like the name of a person. No pattern finds a home address
that has no such marker, so the command writes no street at all and does not
read the street lines. Search by state and the Open Foundation List need
city, state and ZIP code only. The line as filed stays on the return itself
(`public.filings`, the row that `address_object_id` names).

Rules that the command obeys:

- It writes city, state and ZIP code. It never writes a street.
- It fills a row only when state, city, street and ZIP code are all empty. It
  never changes an address that is already there.
- It uses the newest return only. When that return gives a foreign address,
  or a state that is not a U.S. state or territory code, it writes nothing.
  It does not go back to an older return.
- A ZIP code is written as `12345` or `12345-6789`. A value that does not
  have 5 or 9 digits is left empty.
- The organization row keeps its own source file. The address has the source
  file of the return named in `address_object_id`.
- `--unapply` empties city, state, ZIP code and the two new columns on
  exactly the rows that still carry `filing_header`. It does not touch the
  street column. No row is deleted.
- When another loader later writes the address of such a row (the master
  file starts to list the organization), a trigger empties the two columns.
  It does so also when the loader writes the same city, state and ZIP code.
  The address is then the master file's, the label is gone, and `--unapply`
  leaves the row alone. So `--unapply` never empties an address that the
  master file wrote.

Run order: migration 0030 adds the two columns and needs a short exclusive
lock on `internal.organizations`. Run `funderdb migrate` after the return
loader has stopped, not between its batches, and do not put it in a retry
loop: every try that fails makes new reads of the table wait for up to half
a second. Migration 0031 and the command itself can run beside a loader.

Known limits:

- The address is the one on the return that was the newest when `--apply`
  ran. `--report` counts the rows whose return is not the newest one any
  more ("return no longer newest").
- "Newest" means the newest return that the detail pass has parsed. A newer
  return can be on file and not parsed yet. The row then gets the city and
  state of an older return and can be found under the wrong state. Measured
  on 2026-10-08 on one quarter of the organizations, while a back-year load
  was running: 448 of 12,231 (3.7%). `--dry-run`, `--apply` and `--report`
  print this count ("a newer return on file that is not parsed yet"). Run
  the detail pass before `--apply` to keep it small.
- For both limits: run `--unapply` and then `--apply` to bring the rows up to
  date.
- After an `--apply`, refresh `internal.mv_org_state_counts` and run
  `funderdb embed sync`, or the state counts and the search documents do not
  show the new states.

## Derived: application answers across returns, and recipient turnover

| | |
|---|---|
| Publisher | this project: counts of rows that are already in the database |
| Inputs | parsed, non-superseded Form 990-PF returns (`internal.filings`, `internal.filing_application_info`) and Form 990-PF grant rows (`internal.funding_events`) |
| Cadence | by hand, after a load of new returns. See the run order below |
| Licence | CC BY 4.0 (`cc_by`) for the rule manifest. The input rows are U.S. public domain |
| Command | `funderdb refresh-views` (the history view); `funderdb derive turnover --dry-run`, `--slice N`, `--fy YEAR`, `--report` |
| Dataset name | `derive_turnover` (the raw file is the rule manifest of the run) |
| Objects | `internal.mv_org_posture_history`, `internal.funder_recipient_turnover` (migration 0029). Neither has a public view |

Not a download. Both are counts from past returns. Neither says that a
foundation will consider a new request, and neither is a score.

**Application answers across returns** (`internal.mv_org_posture_history`):
for each foundation, how many of its Form 990-PF returns say that it accepts
applications, how many say that it funds preselected organizations only, and
how many say nothing. The view also stores `restrictive_phrase`: words in the
instructions of the latest return that match a short list ("by invitation",
"no applications", "preselected"). That column is for analysis only. The
website does not show it. Of 30 stored phrases read on 2026-10-08, 9 did not
mean a limit on applications ("no applications are required", "does not
accept requests of funds for individuals") and 2 more overstated one.

**Recipient turnover** (`internal.funder_recipient_turnover`, rule
`turnover-v2`): for one foundation and one fiscal year, how many of the named
grant recipients are on none of that foundation's grant lists for the three
fiscal years before. Rules that the command obeys:

- A row that says "see attached" or the like is not a recipient
  (`internal.is_placeholder_recipient`).
- A grant to an individual is not counted. A row is an individual row when
  the filer wrote "I", "IND", "INDIVIDUAL" or "STUDENT" in the box for the
  recipient's foundation status (`recipient_foundation_status`) and our
  records do not link the row to an organization. Such rows are left out of
  the year's list and of the earlier lists. The relationship box is not
  used: filers write "NONE" there for organizations and people alike.
- Names are compared after cleaning (`internal.norm_name`, no "THE" at the
  start, no ending such as "INC") and with everything that is not a letter
  or a digit removed. So "FEED MORE" and "FEEDMORE" are one name.
- A recipient is already listed when an earlier list has the same name, or a
  row linked to the same organization, or a name with a trigram similarity
  of 0.8 or more. The state on the row is not compared.
- A row is written only when the foundation has a named row that is not an
  individual row in the year and in each of the three years before. No row
  is written when more than half of the named rows of the year, or of the
  four years together, are individual rows. No row is written for a
  foundation whose lists would need more than 60 million name comparisons.
  No row means "cannot tell". It is never stored as zero.

Run order. Both objects go out of date when returns are loaded, when an
amended return replaces an original, and when recipients are linked:

1. Let the backfill and its reconcile finish.
2. `funderdb resolve recipients`, and `funderdb resolve aliases --apply` if
   it is in use.
3. `funderdb refresh-views`.
4. `funderdb derive turnover --slice 117 --dry-run` (the slice with the
   largest list), then `funderdb derive turnover`.
5. `funderdb derive turnover --report`.

`--report` prints a warning when the history view holds a different number
of returns than the tables hold now, when turnover rows were computed before
the newest return was read, and when rows of an older rule version are still
in the table.

Known limits: a person whom the filer did not mark as an individual is
counted as a recipient, so a scholarship fund that leaves the status box
empty can still show "none is on the earlier lists". The parser stores one
recipient name and does not keep whether the return gave it as a person's
name or as a business name. A recipient that adds or drops a chapter name
("ALS ASSOCIATION" and the same name with a chapter) can look new. Two
different recipients with almost the same name can be counted as one.
