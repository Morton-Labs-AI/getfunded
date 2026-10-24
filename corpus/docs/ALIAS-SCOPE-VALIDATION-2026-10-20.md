# Alias and entity-scope validation — October 20, 2026

The experimental enhancement did **not** improve identity recall on the fresh
sample. It introduced one unsafe match, so it remains explicitly opt-in for
evaluation. Normal research packets retain the existing v3 extractor and v1
identity gate. Broad discovery scaling remains held.

## What changed

The v4 extractor retains literal publisher display names, occurrence-local legal
declarations, adjacent entity headings and exact context spans. Gate v2 can use
source-backed display-name overlap with a matching EIN and 501(c) declaration,
and separately named entity scopes. It retains directory, placeholder, mismatch,
historical and filing-fallback holds. These are source assertions, not approved
aliases, standing checks or funding-interest findings.

`build_packet(..., experimental_alias_scope=True)` selects this experimental
pair. Ordinary callers continue to use v3/gate v1; active-funder and bulk review
rules remain unchanged. Existing workers and tracker were not restarted or
requeued. Saved v1/v2/v3 source readers remain available.

## Fresh identity results

Before predictions, freeze 32 previously unused organizations and 152 source
references, excluding the earlier 1,120 organizations and validation URLs/hashes.
The challenge set has 12 single-entity cases, eight EIN mismatches, eight
multi-entity cases and four directory cases. It is deliberately stratified and
is not a representative estimate of the whole inventory. Labels come from
agent source-context review; they are not independent human adjudication.

Seventeen cases support a bounded primary source/entity association. That label
does not establish current standing, recent giving, applicant fit or inquiry
permission.

| Identity metric | Existing v3 / gate v1 | Experimental v4 / gate v2 |
|---|---:|---:|
| Correct supported hints | 9 | 9 |
| Unsafe supported hints | 0 | 1 |
| Supported associations still held | 8 | 8 |
| Correctly held unsupported cases | 15 | 14 |
| Observed precision | 100% (9/9) | 90% (9/10) |
| Recall | 52.9% (9/17) | 52.9% (9/17) |
| Overall sample accuracy | 75.0% | 71.9% |
| Candidate hint yield | 28.1% (9/32) | 31.3% (10/32) |

The apparent yield increase is entirely the unsafe match. A matching declaration
on one page and a different named publisher in another same-domain footer were
incorrectly treated as sufficient separate scopes. Naming a second entity does
not prove the domain's relationship to both entities. Eight source-supported
associations remain held: acronym/DBA/local-name gaps and unresolved extraction
of multi-entity relationships. Preserve their source assertions and conflicts;
do not clear those holds by inference.

Both extractors recovered all 246 labelled source-snapshot/EIN pairs with zero
extra identifiers. This measures identifier extraction, not identity accuracy.
The holdout was not tuned after predictions. The evaluated implementation and
code hashes are retained privately; final containment was checked separately.

## Independent real EIN tables

Two new publisher-linked pages were acquired through the existing guarded public
web client after checking disk and absence of queued/active same-host work. The
URLs and snapshots were unused in development. Table headers and 28 row labels
were frozen before predictions using an independent column reader.

Both v3 and v4 recovered **28/28 EINs and 28/28 corresponding row names**, with
zero additional identifiers, across tables containing five and 23 rows. This
validates the existing table repair on fresh real tables; it is not an incremental
v4 gain. Both pages share one publisher, so different table structures and other
publishers remain unmeasured. Table probes add no organizations or discoveries.

## Cost and duplicates

The single paired pass measured extraction at 2.400 seconds for v3 versus
3.885 seconds for v4: **61.9% more wall time**, about 1.49 seconds across 152
snapshots. CPU time rose from 2.267 to 3.763 seconds. Identity-gate wall time was
0.052 versus 0.063 seconds. These are one-pass local observations, not repeated
benchmarks or production throughput promises. Table extraction took roughly
11 milliseconds per version for both pages combined.

Acquisition used two successful native page attempts plus robots handling;
transport retries were not separately instrumented. There were **zero Supabase
calls, remote mutations or dedicated extractor-model calls**. Engineering and
source review still consumed this coding chat's tokens: at the saved checkpoint,
100,227 uncached input, 3,996,288 cached input and 25,931 output tokens. Reasoning
is included in output. Later documentation/delivery is excluded. Invoice dollars
are unavailable; these totals are not a per-organization discovery cost.

Duplicate denominators stay separate:

- 32 organizations, all distinct; no organization duplicates.
- 152 source references and raw hashes, 151 URLs: one repeated URL reference.
- 149 normalized texts: three repeated text observations.
- 264 EIN mentions per version, representing 246 source/EIN pairs: 18 repeated mentions.
- The two table pages and 28 rows have their own denominator.

Thirty-two actual bounded identity reviews were recorded once in the local
research log. They add **zero** coverage audits, discovered domains, qualified
funders, proposals, applied changes, human reviews or published profiles. The
original pilot discovery result remains four source bridges out of 1,000.
The 2,309,073-member inventory and immutable hash were not changed.

## Next decision

Use these completed cases as development evidence. Require explicit DBA/acronym
links and evidence of the relationship between separately named entities; hold
unexplained same-domain publisher changes. Freeze a new organization/URL/hash-
disjoint sample and tables from a different publisher before evaluating another
version. Require improved recall without new unsafe matches, then measure
bounded discovery yield and actual cost before broad expansion.

Private checkpoint: `data/research/alias-scope-validation-2026-10-20/` contains
frozen labels, exact snapshots/hashes, predictions, evaluated code, cost receipts,
32 registration receipts and `HANDOFF-COMPLETE.json`. Pending application remains
`data/research/active-funders-150k-2026-10-18/APPLICATION-BACKLOG.json`; this run
adds an analysis pointer and no executable database patch. Any future application
requires a separately authorized session, fresh exact expected-state readback,
existing before-images and the normal human/publication gates.

Verified by: one frozen paired source/identity/table evaluation; final default
containment matched all 32 baseline packets and all 32 experimental predictions,
and retained ten saved v1 citation hashes. One escaped-bug regression was run
red→green and checked after containment. Full suites: not run (weekly review
policy). CI was not polled.
