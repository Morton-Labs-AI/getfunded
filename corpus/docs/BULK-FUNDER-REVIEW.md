# Bulk source review

The active-funder campaign sweeps tens of thousands of acquired live-site cases
in a durable local run. It compares source evidence and stages literal candidates.
It does not replace semantic interpretation or approve a funder. The 150,000
qualified-funder target remains separate from batch membership.

```sh
funderdb research active-funders-sweep \
  --run data/research/active-funders-150k-2026-10-18 \
  --out data/research/active-funders-150k-2026-10-18/bulk-sweep-2026-10-18 \
  --workers 4 --follow
```

Inspect the existing worker PID, lease, checkpoints and disk before resuming.
One exclusive sweep lease prevents duplicate coordinators. Four local CPU
processes inspect saved files; they make no network or model calls. The separate
crawler keeps its 16-worker/six-page cap, pacing, robots, TLS, public-IP, body
limits and 10 GiB disk guard. No Supabase mutation or scheduler is added.

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
accumulate into additional immutable waves of 1,000 to 10,000 cases. An already
audited organization/result-hash pair is excluded. Queue timestamps and assessment
re-read times alone do not schedule another wave. A changed result is a recheck,
not a new organization. Distinct organizations and rechecks have separate counters.
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

This first rule version screens evidence; it is not an adjudicated benchmark or
a learned policy. It makes no measured token-savings claim. Deep rules/model
benchmarking still requires independently reviewed examples and a holdout; no
paid model batch or automatic rule/model promotion is running.
