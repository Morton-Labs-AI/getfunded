# Identity gates and EIN-table extraction

October 20, 2026. Original implementation, source annotation and analysis: Codex.

The identity gates and table extraction fixes are implemented for new research
invocations. On a fresh 40-candidate challenge set, the gates removed all six
observed directory false hints. They also held two previously surfaced valid
associations, reducing recall. **Keep broad scaling on hold** until alias and
multi-entity recall improves and an independent real-table sample is acquired.

| Measure on fresh source set | Before: v2 exact hint | After: v3 gate |
| --- | ---: | ---: |
| Correct identity candidates | 10 | 8 |
| Unsupported primary-website identity hints | 6 | 0 |
| Identity-hint precision | 10/16 (62.5%) | 8/8 (100% observed) |
| Identity recall against 16 source-supported associations | 10/16 (62.5%) | 8/16 (50.0%) |
| Correct candidate/hold decisions | 28/40 (70%) | 32/40 (80%) |
| Candidate-hint yield in selected challenge set | 16/40 (40%) | 8/40 (20%) |
| Usable EIN precision/recall, distinct normalized-text pairs | 161/161 (100%) | 161/161 (100%) |
| Paired extraction wall time, 175 snapshots | 1.245 seconds | 1.843 seconds |

Eight clean candidate hints are not eight approved websites or verified funders.
This challenge set was deliberately enriched with hard cases; neither its yield
nor its observed precision estimates population performance. The eight false
holds include shortened/changed publisher names and separate foundations,
chapters, recipients or operating entities on shared sites. No source labels or
implementation were tuned after seeing the predictions.

## Implemented behavior

`lxml-visible-text/v3` retains v2's structural text boundaries and adds scoped
identifier metadata. It removes the known all-zero placeholder from usable EIN
mentions. An explicit EIN table-column header can label complete nine-digit cell
values in its own simple table. Organization-name cells, row/table paths and
literal source spans are retained. ZIP/phone columns are not harvested as EINs. Rows with merged cells or cells
containing nested tables are skipped; a nested table with its own simple explicit
header is evaluated separately. This is not a generic numeric scraper.

The source identity gate blocks known directory/shared-platform domains,
placeholder-bearing sources, target/publisher EIN mismatches, unresolved local
name association and target-linked historical/succession language. It retains
individual entity assertions rather than joining all EINs on a domain. Multiple
entities stay held unless the target and other entity roles are locally scoped.
The host list is bounded and will not recognize every unknown aggregator.

Both active-funder triage and automatic sweep staging consume the gate. A blocked
source cannot regain support through the filing-domain fallback. A filing bridge
can still be considered when checked pages contain no identifiers and no gate
blockers; that remains a candidate pending semantic review. No gate certifies
current legal standing, ownership, fit, payment recency or inquiry permission.

V1 and v2 extraction remain selectable for old packets and citations; v3 gets new
metadata without rewriting saved sources or their observation dates. Ten retained
pilot page hashes still match. The escaped-bug reproducer checks directory and
filing-fallback blocking, placeholders, explicitly labelled table cells, excluded
numeric columns and v2 citation compatibility. Existing workers were not restarted
or mass-requeued; the fix is available to new invocations, not silently loaded
into running processes. New sweep/active rule versions distinguish later output.

## Fresh validation and table coverage

Membership was frozen before implementation, then source labels were fixed before
predictions on the completed code. The 40 cases comprise ten each of mismatched
publishers, directories, single-EIN candidates and multi-entity/conflict sources.
They exclude the earlier 1,080 organizations and prior validation URLs/snapshots.
A fixed metadata order and additional foundation/fund-name public charities
supplied fresh multi-entity cases; this is not a random recent-funder sample.
Labels are agent source reviews, not independent human verification.

There are 175 native, hash-checked snapshots, 173 URLs and 172 normalized texts.
Deduplicating normalized text leaves 161 usable text/EIN pairs, all recovered by
both versions. The raw snapshot denominator contains 163 source/EIN pairs; these
are not 163 independent semantic facts. There are 26 repeated within-snapshot
mentions in each version. The fresh set contains no explicit EIN-column table.

Separately, v3 recovered all eight EINs from the known missed directory table and
removed the known placeholder from another development source. Those are repair
checks, **not fresh table accuracy**. A focused synthetic regression also covers
labelled and unrelated numeric columns. A read-only search of the six locally
available Nonprofit Locator candidate source sets found no unused explicit-column
table outside the held-out URLs/snapshots. No new web request was substituted or
fresh table coverage invented. Independent real-table validation remains a gate
before scaling this extraction path.

Forty actual bounded identity-review records were registered once locally, with
source hashes, fixed labels and gate outputs. They recheck existing organizations
and add zero source-audit coverage, discoveries, strict proposals, qualified
funders, applications, human approvals or published profiles. Funding/inquiry
interpretation and whole-site update month remain separate review tasks.

## Cost and next exact steps

New extraction took **48.1% more wall time** and **45.9% more CPU time** on this
paired sample, approximately 0.60 extra wall seconds across 175 snapshots. With
unchanged EIN recovery, time per correct extracted identifier also rises 48.1%.
The additional work constructs entity contexts and table metadata. The complete
paired evaluation and current packet-gate classification took 3.36 seconds.
These are one-pass local timings, with version order alternated; caching and
background workers can affect them. They are not billed-dollar estimates.

Research web, Supabase and dedicated extractor-model calls were zero. Engineering,
annotation and reporting consume agent tokens; numeric checkpoint receipts stay
private, with cached input separated and reasoning output counted within output.
Billed dollars are unavailable. Forty review inputs have forty distinct hashes,
with zero repeated inputs; no campaign proposal/claim index was recomputed.
The two URL repetitions and three normalized-text repetitions remain separate
from raw snapshot hashes, identifier mentions and unique organizations.

Next: preserve these fixed results; improve evidence-backed alias and per-entity
context routing on development cases, then evaluate another untouched identity
sample. Acquire a small, independently labelled real-table source set through the
existing guarded acquisition mechanism before scaling table recovery. Only after
those checks should a bounded discovery extension measure newly supported-domain
yield and complete usage. Do not replay this sample or prior pilot work as new
coverage. Inspect live process identities/leases/checkpoints/disk before any
future worker reload; no restart was performed in this turn.

Supabase remains read-only. Pending application remains
`corpus/data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`;
this turn proposes no executable remote patch. Existing before-images and
semantic, licensing, fresh expected-state, human and publication gates remain.
The immutable 2,309,073-organization inventory is untouched. Private exact handoff,
source labels, results, scripts and cost are under
`corpus/data/research/identity-gates-validation-2026-10-20/`.

Verified by: one escaped-bug regression red→green, one frozen paired 40-case/
175-source evaluation, separate known table/placeholder repair checks, ten legacy
page hashes and forty canonical review-record hashes. Tests: one focused regression
under the escaped-bug exception; full suites not run (weekly review policy).
CI not polled.
