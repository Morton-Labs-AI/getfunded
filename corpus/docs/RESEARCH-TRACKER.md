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
