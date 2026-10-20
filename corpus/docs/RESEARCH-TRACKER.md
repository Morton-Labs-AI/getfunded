Latest independent work: [the1,000-member missing-site pilot](MISSING-WEBSITE-PILOT-1000-2026-10-20.md) completed its bounded discovery pass with4 current source-supported live identity bridges. Its1,100research records and4candidate admissions are not20k source-audit completion or150k qualification. The pilot is held from scaling pending extractor/accuracy/cost work. The requested0030/0031 audit panel retains its own denominator and actual proof counts.

The requested-batch panel now explains next-wave capacity from fresh pool and
audit snapshots: unseen live-source pairs, the wave minimum, the shortfall and
pool candidates still awaiting screening. When the pool is fully screened and
too few live pairs remain, it explicitly says **New eligible sources needed**.
Missing or stale snapshots show capacity unavailable. Separate timestamps remain
visible; neither available pairs nor searches increase the completed-audit bar.
This reports the current pool's dependency, not a claim that global website
discovery or research is exhausted. No worker, membership or database state is
changed by this calculation.

Current capacity dependency (October20,18:20UTC): requested0030/0031 remains0/20,000, with no component proofs or new followup indexes. All235,324 known-URL eligible pool members have assessments; only1,703 unseen live pairs were waiting. Missing-site discovery and genuine eligible pool expansion are required; waiting alone is insufficient. Independent42steps/18strict preparations do not advance source-audit qualification. See [capacity diagnosis and next steps](ACTIVE-FUNDERS-NEXT20000-BATCH3-2026-10-20.md). Counts are dated observations; rechecks and duplicate inputs remain separate.

Latest requested batch: [waves0030/0031 in progress](ACTIVE-FUNDERS-NEXT20000-BATCH3-2026-10-20.md). The requested-target panel counts only actual new component proofs:0/20,000 at this dated checkpoint. Independent34manual steps/18strict preparations are separate from frozen cohort membership and verified-funder qualification. Previous0028/0029completion remains historical.

Latest requested batch: [waves0028/0029 complete:20,000 source audits/cards,zero remaining](ACTIVE-FUNDERS-NEXT20000-BATCH2-2026-10-20.md). The tracker separates256manual steps and27strict preparations from qualification. All234 flags have bounded dispositions; unresolved verification holds remain. Earlier interim50% checkpoint is superseded; finite coordinator has exited.

Prior completed source batch: [waves0026/0027](ACTIVE-FUNDERS-NEXT20000-2026-10-20.md):20,000 audits/cards,250 actual manual steps and19 strict preparations. Its dated counts remain historical; the requested-target panel now uses0028/0029.

# Progress overview refresh · October 20, 2026

The opening summary shows **distinct organizations source-audited**, the percentage
of the full immutable inventory, and the remaining unaudited population. Three
separate bars use that same inventory denominator: acquisition attempted, HTML
acquired, and distinct source-audited organizations. They overlap and must not be
added together. Total audit passes and organization rechecks are shown alongside
the distinct count; rechecks never increase coverage. Audit counts describe the
local bulk workflow, not completed semantic or human review.

The **150,000 verified-funder goal** has a separate bar and denominator, with
website-criteria leads, application, human review and publication reported
separately. Missing counts remain unavailable rather than becoming zero. Each
source has its own dated snapshot. The requested 20,000 batch has its own
completion bar; its finite receipt no longer presents an old waiting-queue count
as live. The configured frozen component is not labelled the latest batch.
Detailed screening, duplicates and historical baseline remain in expandable
panels below the overview. No research state or database approval is changed.

Latest continuation: [20,000 requested source candidates in progress](ACTIVE-FUNDERS-NEXT20000-2026-10-19.md). The requested-target panel is separate from frozen membership and requires component audit proofs and matching card manifests.

Latest continuation: [the next 10,000 wave is in progress](ACTIVE-FUNDERS-CHART-NEXT10000-2026-10-19.md). The latest frozen batch is labelled separately; unseen live-source pairs waiting now have their own counter. These are not completed audits or qualified funders.

Latest completed observation: [10,000 evidence-format source cards](ACTIVE-FUNDERS-EVIDENCE-FORMAT10000-2026-10-19.md): 10,000 source audits and private projections, separately from 204 individually interpreted cards, 243 actual manual steps, duplicates and qualification. Projection adds no research steps. Existing tracker remains at http://127.0.0.1:8768/.

Latest completed observation: the [10,000-source audit and 164-followup report](ACTIVE-FUNDERS-FOLLOWUPS164-2026-10-19.md) records 10,000 selected/acquired/audited and zero remaining, separately from qualification and publication. The tracker remains at http://127.0.0.1:8768/ with the existing guarded workers.

# Research progress tracker

The optional private `selected_cohort_run` configuration adds a selected-batch
panel. Its immutable `selected-cohort.json` binds the membership count to the
inventory hash. The panel reads the bounded completion coordinator's acquisition
and audit checkpoints, and recognizes completion only from its membership and
review-integrity confirmation. Acquisitions with evidence, access blockers,
remaining acquisition work and completed current-source audits have separate
counters. No candidate paths, source excerpts, contact details or before-images
reach the browser. A completed source batch is not qualified-funder admission.

The private `sweep_run` configuration adds [bulk source review](BULK-FUNDER-REVIEW.md).
Its panel separates frozen batch size, completed automated audits, remaining cases,
checked pages, literal candidates, conflicts and fully verified count. It follows
the local sweep lease/status. Automated audits have their own `evidence_sweep`
stage and filter; they do not count as manual semantic review. Only aggregate
fields reach the browser. The panel also shows the configured next-wave minimum
(current campaign 10,000; CLI default 3,000), distinct proposal-input hashes, identical-input repetitions and
organization rechecks. New source vintages do not establish new semantic facts.
Initial and later immutable waves stay distinct from
qualified admission, application, human review and publication.

The private `active_funders_run` configuration adds the current
[active-funder target](ACTIVE-FUNDERS-150K.md): search-pool size, processed cases,
website criteria candidates awaiting semantic review, verified count, and
separate liveness/freshness/inquiry dispositions. It reports status age and
worker lease. The old cohort panel is labeled retained baseline. The aggregate
API does not return source paths, excerpts, contact routes or proposal payloads.


The optional `evidence_run` path in the private `tracker-config.json` connects
the [150,000-member evidence campaign](EVIDENCE-150K.md). Its panel reports fixed
cohort size, initial dispositions, page checks, candidate submissions, review
counts and evidence-worker health separately from the full inventory. Source
checks do not count as fully verified organizations. The status endpoint
allowlists aggregate fields and never exposes packets, excerpts or proposals.

Run the local dashboard beside an initialized research campaign:

    funderdb research tracker --run data/research/full-2026-10-17 --port 8768

Open http://127.0.0.1:8768. The dashboard refreshes every 30 seconds and
records small, dated aggregate observations every minute, including while
the browser is closed. Its process must remain running.

The fixed campaign population comes from the inventory metadata. Website
states come from the worker's dated status; actual research steps come
from a read-only SQLite connection. These observations have separate
timestamps. The page shows:

- The full denominator, crawl attempts, unresolved websites and blockers.
- Distinct organizations and record counts for each research stage.
- Recent recorded work, with a stage filter.
- Crawl progress over time, worker lease status, snapshot age and free disk.
- Human-review and publication counts reported by this workflow.

Recorded research includes blocked and unresolved attempts. Neither acquired
HTML nor an agent review step proves that an organization is fully
cross-verified. This campaign has no completed-profile approval record;
the tracker therefore leaves that metric unconfirmed. It does not estimate
when exhaustive verification will finish.

The optional private campaign file tracker-config.json accepts started_at
and continue_through ISO timestamps to display a requested work window.
This is context for the operator, not a timer that stops the crawler or a
completion forecast.

The server binds only to loopback and serves only the dashboard and its
aggregate status API. It does not serve campaign files, raw source pages,
source excerpts, credentials or SQL. It cannot change queue states,
approve research, publish data or restart workers. It appends observations
to tracker-observations.jsonl without deleting earlier evidence. A campaign
lease prevents duplicate tracker processes. The underlying crawler and
scheduled research work run independently.

If the worker status becomes stale or its lease disappears, the dashboard
shows a warning. If a snapshot cannot be read, it retains the last display
with a visible error rather than replacing unknown values with zero.

Verification: start the command against the actual campaign and load the
dashboard once. Follow the repository's weekly testing policy; no test
suite or CI polling is required for routine development.
