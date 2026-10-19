# Bulk source review

The active-funder campaign sweeps tens of thousands of acquired live-site cases
in a durable local run. It compares source evidence and stages literal candidates.
It does not replace semantic interpretation or approve a funder. The 150,000
qualified-funder target remains separate from batch membership.

```sh
funderdb research active-funders-sweep \
  --run data/research/active-funders-150k-2026-10-18 \
  --out data/research/active-funders-150k-2026-10-18/bulk-sweep-2026-10-18 \
  --workers 4 --follow --minimum-wave-size 10000
```

Inspect the existing worker PID, lease, checkpoints and disk before resuming.
One exclusive sweep lease prevents duplicate coordinators. Four local CPU
processes inspect saved files; they make no network or model calls. The separate
crawler keeps its 16-worker/six-page cap, pacing, robots, TLS, public-IP, body
limits and 10 GiB disk guard. No Supabase mutation or scheduler is added.

The current campaign uses a 10,000-case minimum (maximum 10,000 per wave), raised
from 3,000 for the next large continuation. The CLI default remains 3,000; preserve
the explicit 10,000 option when restarting this follower. Earlier frozen waves
keep their original membership and counts. Larger work spans multiple waves.

## Evidence recorded per case

1. Check the exact organization UUID/EIN against its hashed IRS subsection03
   source observation. This is not a current-standing certificate.
2. Check the immutable assessment and referenced source result, then acquired
   page hashes, URLs, visible text and explicitly labelled EINs. A changed or
   unavailable frozen result remains a source-review dependency.
3. Compare the exact saved filing UUID/EIN/object-ID/domain row and source hash.
   Separate an exact publisher EIN, conflicting EINs, a filer-domain bridge with
   a publisher-name match, a domain-only bridge, and missing evidence. None is
   a human identity decision. Similar brands/shared domains must not merge entities.
4. Inspect substantive HTML blocks, excluding navigation, headers, footers,
   forms and blockquotes. Retain literal source spans for explicit first-person
   outgoing-funding and grant-policy statements. These rules screen assertions;
   they do not adjudicate the speaker or program scope.
5. Retain positive and restrictive policy language together and flag the need
   for program/cycle interpretation. Different policies may describe different
   programs rather than contradict each other. A grant application button alone
   never establishes current intake.
6. Retain page-scoped dates, unknown whole-site update month, unvisited URLs and
   unresolved recent-payment evidence. No deadline year, currency, application
   status or payment date is invented.

The review retains at most 60 matching blocks per page, each no longer than
1,000 characters, and reports omitted matching blocks. Full sources remain
private. Missing funding evidence means **not established in acquired content**,
never “not a funder” or “inactive.” A blocked source is not a dead website.

Selective layout cleanup can hide substantive content when a publisher wraps
its body inside a header. The full checked visible-text packet remains the
fallback for a bounded semantic review; do not turn an empty cleaned portion
into a claim that the acquired body is absent. Likewise, recent sidebar news
does not refresh an older grant article, and a directory's named third-party
funder is separate from the directory operator. Keep those scope checks before
using a literal match as an organization-wide grant or inquiry policy.

Only cases with an exact publisher EIN or a checked filer/EIN/domain plus
publisher-name bridge, and an outgoing-funding passage, can produce proposals.
The existing strict `evidence-first/v1` validator rechecks every cited literal
span. It checks evidence identity, not semantic truth. Each candidate retains
unadjudicated speaker, program, cycle and organization-wide scope. Do not apply
it as normalized organization-wide policy until that scope is reviewed. No
unsupported candidate is fabricated to improve counts.

## Checkpoints, waves and counters

The first batch freezes all then-current acquired live-site candidates and an
immutable member hash. Per-case reviews, local proposals and research-step
inputs are durable. An interrupted worker recovers running jobs through its
checkpoint; completed review files and idempotent steps are reused. Original
source and pending files are preserved.

With `--follow`, newly acquired organizations and changed acquired source results
accumulate into additional immutable waves. The current campaign uses a
**10,000-case minimum and maximum**, after earlier 1,000/3,000 minimums. The command accepts
`--minimum-wave-size` from 1,000 through 10,000; the saved follow policy and tracker
show the configured minimum. Existing frozen waves are never enlarged or replayed.
Within each new live-site selection, funding leads precede other cases, followed
by inquiry-guidance and recent page-date leads. None is automatic qualification.
An already audited organization/result-hash pair is excluded. Queue timestamps and assessment
re-read times alone do not schedule another wave. A changed result is a recheck,
not a new organization. Distinct organizations and rechecks have separate counters.
For staged manual claims, compare the final result hash with the cited packet.
An identical result retains its strict span validation. For a newer result, check
the exact cited URL, literal value and any named program/cycle labels. Distinguish
an omitted page under the bounded cap from changed text on a reacquired page.
Retain these comparisons as application gates without adding new case-audit or
fact counts. Literal reobservation does not adjudicate semantic scope, effective
dates, contradictory notices or human approval.
Fewer than the configured minimum remain pending for another wave, rather than
being padded with previously audited result pairs.

A directed completion pass can retain an already selected 10,000-member
acquisition cohort as one exact 10,000-case wave. First quiesce the general
coordinator at its checkpoint and hold its exclusive lease. Wait for every
selected acquisition to reach a terminal outcome and for its assessment to match
the actual result hash. Freeze the exact selected UUIDs and current assessment
hashes only after proving all 10,000 changed organization/result pairs are unseen.
Preserve the selection, queue amendments, before-images and older results. Resume
the existing four-process audit worker through that frozen wave, with the same
explicit 10,000 minimum and maximum. Do not substitute unrelated cases or replay
older pairs to reach the count.

This directed cohort includes cases that were live when selected but whose new
acquisitions are blocked. Their result envelopes and access failures are audited
as unresolved outcomes; they are not counted as currently live funders. Completion
requires all 10,000 checkpoint rows done and their review hashes and membership
checked. Page checks, acquired evidence, blocked outcomes and qualified profiles
remain distinct. The general follower's live-site selection is unchanged.

This is a local acquisition follower, not a new heartbeat or scheduled automation.
Completing a pass does not qualify the target or resolve
every gap. A completed initial pass leaves its completion observation intact.

`sweep-status.json` reports initial and cumulative batch counts, completed source
audits, checked pages, literal candidate proposals/claims, identity categories,
conflicts and blockers. In-flight submissions and completed-case totals can
briefly differ. Fully verified, remotely applied, human-reviewed and published
counts remain separate and zero for this worker.

Proposal records across waves can overlap. Distinct proposal-input SHA-256 values
and repeated identical inputs are counted separately; neither measures distinct
semantic facts. Early timestamp-only rechecks remain in history. Deduplicate
those exact inputs before reviewing overlapping facts across source vintages.

Actual audits use the `evidence_sweep` research stage, displayed as **Automated
source review**. They do not inflate manual claim-review or identity-review
stages. The tracker reads only aggregate fields, never source paths, excerpts,
contacts, proposals or before-images. Acquisition, automated audits, semantic
review and approved publication are different stages.

## Private application backlog

The sweep's `APPLICATION-BACKLOG.json` links `pending-index/` and additional
`waves/`; the active campaign's root backlog links the sweep alongside older
preparations. A complete read-only web-fact SELECT is saved privately with its
time and hash. Each pending index retains exact existing rows, including empty
state only when absence is established by that complete read. Additional waves
reuse this dated baseline; separate application must refresh it.

No executable remote patches, registrations, ledger updates, confirmed web facts,
reviewer identities or publication decisions are generated. Each proposal is
`awaiting_separate_application`. Separate application requires fresh exact
readback, speaker/program/cycle adjudication, duplicate checks against manual
proposals and prior supersession, and existing human/licensing/publication gates.
Publisher sources, excerpts, contacts, searches and before-images stay private.

A successful response and sufficient text can still be a soft error or the wrong
entity's content. The Downey chapter continuation exposed a page whose body says
it is not found, followed by national-office pages. Treat automated liveness as
a lead until candidate-specific content is reviewed. Retain the dated cached
chapter evidence and fresh failure together; block website application rather
than inheriting a national EIN, contact route or copyright date. The current
mechanical liveness screen does not automatically adjudicate all such cases.

This first rule version screens evidence; it is not an adjudicated benchmark or
a learned policy. It makes no measured token-savings claim. Deep rules/model
benchmarking still requires independently reviewed examples and a holdout; no
paid model batch or automatic rule/model promotion is running.
