# EIN and HTML-boundary extractor validation

October 20, 2026. Original implementation, source annotation and analysis: Codex.

**Later funder-focused validation:** [the40-case challenge report](FUNDER-IDENTITY-VALIDATION-2026-10-20.md) finds95.5% usable-EIN recall and remaining table/placeholder/identity-scope gaps. Its cost per correct result increases9.4%; the easier sample below does not predict production performance. Broad scaling remains held.

The versioned fix recovers the pilot's three missed EIN bridges. On a separate,
pre-labelled 40-page source sample, recovery improves from **17/22 to 22/22**,
with **zero observed false positives** in either version. This supports a larger
funder-focused validation, not an estimate of production website-discovery yield.

| Measure | Before: v1 | After: v2 |
| --- | ---: | ---: |
| Labelled EINs recovered, unique page/EIN pairs | 17/22 (77.3%) | 22/22 (100%) |
| Correct complete identifier sets per page | 35/40 (87.5%) | 40/40 (100%) |
| False positives across 18 negative pages | 0 | 0 |
| Identifier-bearing pages among the 40 selected pages | 17 (42.5%) | 22 (55.0%) |
| Repeated mentions within a page, excluded from unique yield | 2 | 2 |
| Paired sample wall time, 40 pages | 0.427 seconds | 0.474 seconds |
| Paired sample CPU time, 40 pages | 0.418 seconds | 0.466 seconds |
| Wall time per correctly recovered page/EIN | 25.1 milliseconds | 21.5 milliseconds |
| Known pilot development cases, separate from sample | 1/4 | 4/4 |

The sample gains five identifiers: **29.4% more recovery**, or 22.7 percentage
points of recall. Total extraction time rises about 11%; measured wall time per
correct identifier falls **14.3%**. These are single-pass local timings, including
hash checks, file reads, JSON, HTML and extraction. Old/new order alternated;
background workers and filesystem caching can affect timing. They are not a
benchmark of a full discovery campaign or a billed-dollar saving.

## Method and limits

Membership and labels were frozen and hashed before v2 implementation or
predictions. A deterministic organization order selected one usable saved page
per organization, excluding all 1,000 pilot members. The sample has 24 pages
containing an EIN/tax-label marker and 16 numerical contact/address/date controls.
Of the marker pages, 22 contain valid labelled identifiers; one only discusses a
tax-ID enrollment requirement and one prints an incomplete seven-digit suffix.
Missing digits were not filled from registry data.

Labels came from source contexts using a separate text-node-delimited annotation
view. The implementer also annotated the sources: **independent source data, not
a blinded developer evaluation or independent human review**. Predictions were
not used to revise labels or tune the fix. Selection inspected 325 source pages;
only the frozen 40 enter the paired accuracy denominator. This label-enriched
sample spans broader c3 organizations, not a representative recent-funder cohort.
It does not establish 100% population accuracy, resolve legal entity identity or
measure false acceptance of namesakes, directories or multi-entity websites.

There are 40 distinct organizations, URLs and source hashes, zero duplicate
sample members, and two repeated EIN mentions in each extraction version. Old/new
passes and the four known development cases do not add audited organizations,
website discoveries, research steps, proposals or qualified funders. The original
pilot remains **four supported websites out of 1,000 (0.4%)**. Its proposal and
campaign duplicate counts remain separate and unchanged.

## Implementation and retained evidence

New packets and crawler summaries use `lxml-visible-text/v2`. A shared helper
separates structural HTML elements while retaining inline fragments, ignores
inert script/style/noscript/SVG content, and recognizes bounded EIN labels such as
“EIN is” and the EIN/tax-ID question form. It requires a complete labelled
nine-digit identifier and rejects longer or alphanumeric identifier strings.
It never approves an entity, current standing, grantmaking role or application.
Static HTML extraction does not certify CSS visibility or rendered layout.

Saved citations validate with their recorded extractor version; missing version
metadata retains v1 behavior. Unknown versions fail closed. Proposal revalidation
now carries the packet's version instead of silently selecting the default.
Substantive passage locators use the same text version as their packet. All ten
saved pilot pages retain their v1 text hashes, and all four existing staged claim
citations still match. No old packet or proposal was rewritten or resubmitted.

Running followers were not restarted or mass-requeued. New code is available to
new invocations; no claim is made that existing processes have loaded it. The
immutable 2,309,073-organization inventory is untouched. Supabase received **zero
calls and zero mutations** this turn. No additional research web requests or
extractor model calls were needed. Agent engineering/reporting consumes tokens;
numeric counter receipts stay private, and invoice dollars are unavailable.

## Next exact step

Before broad discovery, validate a fresh funder-focused sample with multi-entity,
wrong-EIN, directory, malformed and unlabelled cases, plus explicit fit/inquiry
scope. Keep labels fixed before predictions and use a separate reviewer where
available. Then measure new supported-domain yield and actual search/model usage
on a bounded discovery extension. Do not project this extraction gain onto the
remaining missing-site inventory or replay the pilot's searches/preparations.

Private reproducibility scripts, sample/label hashes, predictions, timings,
regression receipts and exact handoff are under
`corpus/data/research/ein-boundary-validation-2026-10-20/`.
Pending application remains
`corpus/data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`;
all candidates await separate application, fresh expected-state readback and
existing semantic, licensing and human gates. No live application is authorized.

Verified by: one focused escaped-bug regression (failed before, passed after), one
paired 40-page sample, ten retained v1 page hashes and four saved claim citations.
Tests: one reproducing regression run under the escaped-bug exception; full suites
not run (weekly review policy). CI not polled.
