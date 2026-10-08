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
