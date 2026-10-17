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
precedence. Fifteen earlier attributed discoveries were carried into the queue.

Inventory SHA-256: `f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`.

The API export is a paginated observation interval, not a repeatable-read
transaction. Matching census counts cannot rule out same-count membership
changes during export. The census found no canonical merges and no unparsed
website-bearing filing rows; the API path needs those checks on future runs.

Live progress snapshot at **2026-10-17T20:54:19.981226+00:00**:

| State | Organizations |
| --- | ---: |
| HTML acquired; identity/claims still unreviewed | 641 |
| Attempted, with an acquisition blocker | 378 |
| Currently running | 16 |
| Candidate website awaiting acquisition | 328,202 |
| Website discovery still unresolved | 1,979,836 |
| Complete inventory | 2,309,073 |

**1,035 distinct organizations have a crawl attempt.** A separate result-file
scan starting at 20:52 UTC observed **1,955 HTML page observations** across
**1,896 distinct URLs**, **1,218
publisher-linked resources**, and **53 pages with
an explicitly labelled EIN matching the target**. These are acquisition/review
leads, not approved profiles. Result scanning overlaps ongoing acquisition;
its counts may advance beyond the queue snapshot. Human-reviewed profiles in
this campaign: **0**. Published signals: **0**.

## Database additions and findings

The live signals workflow now contains **14 first-party source definitions** and
**204 unreviewed URL candidates**, including this follow-up's two sources and
eight candidate URLs. All eight new candidates link to existing organizations.
Raw files **464–465** were registered before ingestion; ledger runs **550–551**
completed with two/eight insertions and no skipped rows. Publisher snapshots
remain private. No eligibility, award amount or deadline was automatically
promoted from a URL discovery.

The [12 follow-up notes](../data/seed/research/followup-notes-2026-10-17.jsonl)
include Stabler's reported transition to a donor-advised fund; a recipient-reported
science-funding lead from UK Biobank; recovered Knight and Fidelity domains;
program-provider versus external-grantmaker distinctions; and a filed domain
that now serves unrelated casino content. That last case is an identity conflict,
not a closure finding. CHDI's RSS omits a newer PDF-linked news item, so feeds
must be checked against other publisher surfaces.

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
hash/date, Python compilation and live source/candidate ingestion results.
Tests: not run (weekly review policy). CI checks were not polled.
