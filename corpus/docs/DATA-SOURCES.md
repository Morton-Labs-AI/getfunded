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
| XML URL | `https://apps.irs.gov/pub/epostcard/990/xml/{YEAR}/{YEAR}_TEOS_XML_{NN}{A-H}.zip` |
| Cadence | index: appended through the year as returns are processed; zips: posted in batches, immutable once posted |
| Licence | public domain (`us_public_domain`) |
| Cache | index: mutable, 7 days for the current year, 90 days for past years; zips: immutable |
| Commands | `ingest filings` (index only), `ingest 990pf`, `ingest 990pf-detail`, `ingest 990`, `ingest 990-detail`, `ingest websites` |
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
