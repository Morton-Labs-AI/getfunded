# Research progress tracker

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
