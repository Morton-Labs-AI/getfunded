# Evidence-first 150,000-organization campaign

This campaign implements the October 18, 2026 request to work through a bounded
501(c)(3) cohort, make supporting evidence reproducible, then document observed
rules and evaluate cheaper extraction models. It stages research locally. It
does not apply changes to Supabase, approve identity, certify current tax
standing, or publish profiles.

## Fixed population and selection

The full 2,309,073-organization campaign and its immutable inventory remain
intact. A separate private cohort contains exactly 150,000 unique EINs from that
inventory. Membership requires an exact organization-ID/EIN link to a hashed
public IRS-BMF-derived observation with `subsection_code=03`, rather than an
inference from the existing `org_type` label. The original inventory omitted
subsection codes, so a checkpointed **GET-only** export supplies that evidence.

Selection prioritizes private foundations, then available acquired evidence,
known websites and UUID order. If qualified foundations are insufficient,
public charities fill the remainder from a bounded UUID-ordered eligibility
sample. This is a funder-first research cohort, not a representative sample of
all charities or a ranking of their likelihood to fund an applicant. It does
not use assets to infer eligibility or interest. Unknown websites stay in the
cohort with an explicit discovery dependency.

The eligibility response is a dated observation of existing government-derived
data, not a new IRS determination or current-standing check. API observation
time must not be presented as the government's underlying source vintage.
Revocations, reinstatements and entity ambiguities require separate evidence.

`cohort.json` records source-inventory and membership hashes. `members.jsonl`
and saved eligibility responses are private and immutable after selection.
No original organizations, files, candidate preparations or ledger rows are
removed. Running initialization again validates membership rather than
selecting a new population under the same name.

## Two distinct forms of verification

The automatic evidence pass performs reproducible mechanical checks:

1. Match subsection evidence to the member's exact UUID and EIN.
2. Check stored and uncompressed snapshot hashes, successful page status and
   the exact source URL. Bound reads to private research storage and 8 MiB.
3. Extract inert visible text using `lxml-visible-text/v1`; preserve its UTF-8
   SHA-256 and original observation time.
4. Record explicitly labeled EIN matches and conflicts on the candidate host.
   An EIN observation is an identity-review input, never an identity approval.
5. Preserve acquisition errors, unvisited URLs and unknown program fields.

The second stage interprets claims. A successful checksum or matching excerpt
does not prove that an amount belongs to the target, that an application is
open, or that a recipient independently corroborates an award. Model and agent
claims retain pending semantic and human review. Fully verified organizations,
applied changes and published profiles remain separate counts.

## Strict candidate interface

The versioned [JSON schema](EVIDENCE-PROPOSAL.schema.json) is generated from
`research.evidence.Proposal`. Agent and future model outputs use the same
interface. Unknown keys are rejected; provider selection does not loosen it.

Each claim includes field, literal source value, program, cycle, currency/unit
when relevant, publication/effective dates or explicit nulls, timezone, conflicts
and citations. Each citation identifies a saved snapshot and text hash plus
exact character offsets and a 20–1,200-character private supporting passage.
Offsets address Python Unicode characters in the versioned extracted text,
not byte offsets or positions in a live page.

`evidence-submit` rechecks raw hashes, URLs, the packet hash, text hashes and
offsets. The claimed literal value must appear within the cited passage;
program/cycle scope must occur in the source. Amount claims distinguish award,
round and partnership scope and require currency explicitly in the passage:
`$` alone is insufficient to assert `USD`. General eligibility can use
`cycle=not_stated`; deadline/posture claims require a stated cycle. These checks
still leave attribution, interpretation and conflicts for semantic review.

A staged proposal records author/model and reported usage, exact source-result
and cohort hashes, unknown fields and `awaiting_separate_application`. A duplicate
input hash returns the existing preparation. Remote before-images are explicitly
unknown until separately read. Future application must save exact before-images,
compare expected states, deduplicate source hashes, register required inputs and
use the existing review paths. Nothing here submits SQL or a remote mutation.

## Local operation and recovery

```bash
funderdb research evidence-init \
  --source-run data/research/full-2026-10-17 \
  --run data/research/verification-150k-2026-10-18 \
  --access data/research/supabase-read-access.json

funderdb research evidence-prioritize --run data/research/verification-150k-2026-10-18
funderdb research evidence-work --run data/research/verification-150k-2026-10-18 --follow
funderdb research evidence-report --run data/research/verification-150k-2026-10-18
funderdb research evidence-attach --run data/research/verification-150k-2026-10-18 \
  --sources data/research/already-acquired-source-references.json
funderdb research evidence-prepare --run data/research/verification-150k-2026-10-18 \
  --org-id <cohort-uuid> \
  --out data/research/verification-150k-2026-10-18/work-items/<new-name>.json
funderdb research evidence-submit --run data/research/verification-150k-2026-10-18 \
  --proposal data/research/agent-candidate.json
```

The existing 16-worker, six-page crawler supplies evidence; a second crawler is
not started. Its robots, TLS, public-IP, body-size and shared-host pacing controls
remain. Cohort prioritization changes only pending local queue priorities and
first saves exact local before-images. The separate evidence worker has one
exclusive lease, checkpoints each organization, keeps every prior packet and
follows changed crawler results. Both workers retain the 10 GiB disk guard.
Eligibility-export checkpoints resume without discarding prior responses.
`evidence-attach` accepts an exact `org_id`/`ein` envelope and 1–12 existing
page references (`url`, `snapshot`), rechecks their bytes, preserves the input
and queues a new check. It performs no acquisition and grants no identity approval.

States distinguish pending, waiting for acquisition, website discovery needed,
acquisition blocked, unusable text, source-integrity blocked and awaiting claim
review. A first-pass disposition for all 150,000 is not a declaration that all
150,000 were verified. Source failures remain unresolved, not closed funders.
Changed source results are processed again with their original observation dates.

The local tracker on port8768 shows the cohort alongside the full-population
campaign. It exposes aggregate allowlisted counts only. `tracker-config.json`
can name `evidence_run` to connect the views. The paused heartbeat remains paused;
these commands create no scheduler or automation.

## Cost measurement and later rules work

This source-check worker makes **zero model calls**. Its counts include actual
processing seconds, page checks and repeated observations. Interactive research
tokens are separate and are not measured by this worker. Candidate usage is
reported by the submitting agent/model, not independently metered provider data.
No cost-savings or time-to-completion claim follows from a row count.

`evidence-prepare` uses bounded keyword windows and labeled EIN locations to
prepare a private work item, with a default 12,000-character excerpt budget.
It rotates across pages rather than letting a long homepage consume the budget.
Every window retains exact source/text hashes and offsets, and the result
reports excerpt versus full-source characters. It performs no inference or
model request. Missing context may contain important qualifications; extraction
must abstain or request further source review. Character reduction is not a
measured token reduction or proof of lower provider cost.

The initial pass retains real successes, identity conflicts, missing sites and
retrieval failures. Once all members have an initial disposition, the worker
writes `initial-pass-rules-review.json`, marking the next phase as due. That
milestone is not verification completion or a set of adjudicated labels.

After working through the cohort, spend the deeper documentation effort on
observed if/then rules, scope exceptions, counterexamples and required evidence.
Use preserved packet hashes to trace each rule to real cases. Build a separately
adjudicated evaluation set spanning outcomes; freeze independent holdouts before
comparing cheaper models. Measure field precision, evidence entailment, entity
and cycle errors, abstentions, coverage, latency and actual provider cost.

Future recursive improvement may propose extraction/rule changes from errors,
then compare versions on frozen cases. It must not label its own outputs as
ground truth, train on evaluation holdouts, silently change the cohort, lower
evidence requirements, or promote itself to production. Rule/model promotion,
publication and remote application retain their existing separate review gates.
No automatic model switching, paid model batch or training job is launched here.
