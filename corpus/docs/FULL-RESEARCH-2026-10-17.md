# Full-population research — 2026-10-17

The Supabase access issue is resolved. The existing public Data API exported
**all 2,309,073 organizations** and **1,266,695 unsuperseded filing
website records**. Both totals matched the live database census. No database
password, privileged API key, role change or schema migration was needed.

This is an active whole-database campaign, **not completed research**. A detached
16-worker crawler is processing every pending website, with a current-chat
continuation scheduled every 30 minutes to recover work and continue discovery,
news, reverse research and review preparation. There is no cohort/batch stopping
limit on the worker. All organization types remain in scope. Nothing was merged
or pushed to main.

## Population and evidence

The immutable inventory has **329,222 candidate websites**
and **1,979,851 records without one**.
It includes identifiers, locality, NTEE, registry provenance, licenses and the
latest selected filing website/tax period. Confirmed website records take
precedence. Fifteen earlier attributed discoveries were carried into the queue;
five further candidate websites were attributed during this continuation.

Inventory SHA-256: `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`.

The API export is a paginated observation interval, not a repeatable-read
transaction. Matching census counts cannot rule out same-count membership
changes during export. The census found no canonical merges and no unparsed
website-bearing filing rows; the API path needs those checks on future runs.

Live progress snapshot at **2026-10-17T21:23:49.355674+00:00**:

| State | Organizations |
| --- | ---: |
| HTML acquired; identity/claims still unreviewed | 3,062 |
| Attempted, with an acquisition blocker | 1,778 |
| Currently running | 16 |
| Candidate website awaiting acquisition | 324,386 |
| Website discovery still unresolved | 1,979,831 |
| Complete inventory | 2,309,073 |

**4,872 distinct organizations have a crawl attempt**, including interrupted
attempts returned to pending during recovery. A separate result-file scan from
21:23:49 to 21:23:59 UTC observed **11,976 HTML page observations** across
**11,617 distinct URLs**, **8,406
publisher-linked resource references**, and **340 pages with
an explicitly labelled EIN matching the target**. These are acquisition/review
leads, not approved profiles. Result scanning overlaps ongoing acquisition;
its counts may advance beyond the queue snapshot. Supplemental manual page
acquisitions are separate from that scan. Human-reviewed profiles in
this campaign: **0**. Published signals: **0**.

## Database additions and findings

The live signals workflow now contains **17 first-party source definitions** and
**245 unreviewed URL candidates**. This continuation added three sources and
41 candidate URLs for McKnight neuroscience, Mid-Iowa Health and New York Health.
All 41 link to existing organizations and remain unreviewed candidates. Raw files
**466–467** were registered before ingestion; ledger runs **552–553** completed
with three/41 insertions and no skipped rows. These include historical and
editorial announcements, not just potential funding calls. Publisher snapshots
remain private. No eligibility, award amount or deadline was automatically
promoted from URL discovery. Earlier raw files 464–465 / ledger 550–551 retain
the preceding two sources and eight candidates.

The [12 follow-up notes](../data/seed/research/followup-notes-2026-10-17.jsonl)
include Stabler's reported transition to a donor-advised fund; a recipient-reported
science-funding lead from UK Biobank; recovered Knight and Fidelity domains;
program-provider versus external-grantmaker distinctions; and a filed domain
that now serves unrelated casino content. That last case is an identity conflict,
not a closure finding. CHDI's RSS omits a newer PDF-linked news item, so feeds
must be checked against other publisher surfaces.

This continuation records [64 performed website searches](../data/seed/research/continuation-searches-2026-10-17.jsonl),
[five attributed website candidates](../data/seed/research/continuation-websites-2026-10-17.jsonl)
and [26 additional review notes](../data/seed/research/continuation-notes-2026-10-17.jsonl)
across 21 organizations. The campaign now has 113 actual research-step records:
77 website-search records, ten identity reviews, three news searches, nine
recipient reverse-research records and 14 claim reviews. All reviews are agent
preparation for human review; generated query suggestions do not count.

The new findings distinguish McKnight's two 2027 award cycles and preserve the
August 3/August 12 opening-date conflict; identify a namesake TYH domain with a
different EIN; document a UCI-hosted Irvine Health Foundation closure retrospective
without inventing its effective date; and distinguish student grants from
institution grants at Sarkisian. Recipient evidence includes Weizmann, SMU, AUA
and Valdese park support. Joint gifts, conditional pledges, endowments and paid
grants are not interchangeable. State dissolution evidence is not a federal
tax-status decision. Indexed WebsterRogers articles now returning 404 remain
blocked leads; no closure is inferred.

Program-path and page-body link priority now prevents generic menus and branding
pages from exhausting the crawl budget before relevant award guidance. A real
six-page McKnight crawl reached both award overviews and Brain Disorders
application instructions with zero acquisition errors. Six pages still do not
complete a program review. The continuous worker was gracefully restarted to
load this change, recovering interrupted jobs through the existing lock/queue.

## Continuation and proposed adapters

The [protocol](ORGANIZATION-RESEARCH.md) documents resumable API shards,
compressed immutable evidence, shared host pacing, Retry-After handling,
shared-page reuse with original timestamps, disk protection, actual search
records and preservation of earlier evidence. Searches with no verified site
remain unresolved. Successful HTML acquisition never completes identity review.

[Additional source opportunities](RESEARCH-SOURCE-OPPORTUNITIES.md) evaluates
990-N website/alias data, linked PDFs and grant exports, rendered public pages
and recipient evidence. These adapters are proposals and are not counted as
implemented coverage. The existing source-intake and human publication gates
remain in force. The initial [109-organization report](RESEARCH-2026-10-17.md)
is retained as the historical baseline.

Verified by: complete live API export/count reconciliation, full queue initialization,
concurrent acquisition, real search-step recording, snapshot reuse preserving
hash/date, the real six-page program-priority crawl, and live source/candidate
ingestion counts, links and ledger results.
Tests: not run (weekly review policy). CI checks were not polled.
