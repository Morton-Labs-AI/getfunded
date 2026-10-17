# Additional sources for the full research campaign

The active campaign covers every organization. The following adapters could
reduce missing-site work and improve evidence beyond a six-page crawl. They are
proposals, not implemented ingestion or verified coverage gains.

## IRS Form 990-N websites and aliases

The corpus currently does not ingest 990-N. The IRS publishes a monthly,
pipe-delimited bulk file of the latest e-Postcard notices. On 2026-10-17, the
[live download page](https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads)
listed a September 7, 2026 posting. Search snippets showed an older vintage,
which is why the live page was checked.

The [official dictionary](https://www.irs.gov/pub/irs-tege/990n-data-dictionary.pdf)
includes EIN, legal name, tax year and period, website, and three DBA fields.
These could supply attributed website candidates for some organizations that
have no website in the existing filing/registry inventory. No overlap or yield
has been measured, and this would primarily serve smaller nonprofits rather
than automatically identify new grantmakers.

Before a production adapter, complete the repository's new-source issue and
license review. The proposed implementation would stage the
[official ZIP](https://apps.irs.gov/pub/epostcard/data-download-epostcard.zip)
as a mutable vintage, hash/register the original bytes, preserve member/row
locators, and join only unambiguous EINs. Retain the stated reporting period;
do not promote the download date to the date a website was reported. Preserve
conflicting domains as candidates. A receipts threshold is not an exact revenue
amount, and a filer termination statement is not a general current-status
judgment. Principal-officer names and residential addresses should be excluded
from this website-discovery output.

## Publisher PDFs and public grant exports

Acquire explicitly linked annual reports, guideline PDFs and CSV/JSON grant
exports with individual source hashes and locators. Extract tables and dates
without merging commitments, paid grants and future approvals. Add resource
type dispatch before feeding a PDF to the existing HTML signal processor.

CHDI is a concrete example: its current news index links to a May 26, 2026 PDF
announcement absent from its verified RSS feed. An RSS-only watcher would miss
that entry. The current acquisition records resource links but does not yet
parse their documents.

## Rendered pages and documented public data endpoints

Some news/grant listings render their main results with JavaScript. Knight's
static news HTML exposes only a limited set of article links. Inspect rendered
public pages and publisher-advertised exports/endpoints, then implement bounded
pagination with duplicate and completeness checks. A successful page response
does not prove that every grant or article was retrieved. Inspection of public
website code does not authorize contact forms or private administration APIs.

## Recipient and institutional evidence

Use recent paid-grant rows to select recipient websites and look for the
funder's legal name, program and award year. Preserve the recipient's attribution
and reconcile against the original funder announcement. UK Biobank's funding
page provided a science-funding lead for the Sergey Brin Family Foundation even
though no official foundation website was verified. Recipient evidence alone
does not establish an open application route.

## Review order

Prioritize identity conflicts and program/cycle claims that affect an actual
application decision. Review funding role before thematic fit: operating
research, patient services, medical education, external grants and investment
are different activities. Continue the full queue while adapters and source
reviews are prepared; proposed capabilities never count as completed research.
