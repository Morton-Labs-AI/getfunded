# Research restart handoff and SQL approval correction

## Latest bulk source-review continuation

Read [the bulk report](ACTIVE-FUNDERS-BULK-2026-10-18.md) and
[operating contract](BULK-FUNDER-REVIEW.md) first. Initial pass: 37,063
organizations/172,750 saved page checks/383 local proposals/868 literal claim
records. Another 1,175 organizations completed a subsequent wave; new acquisitions
and source revisions continue. These are automated source audits, not qualified
admission. Unique organizations, source rechecks and manual reviews are separate.
The 150,000 qualified target remains incomplete; applied/human/published are zero.

An additional 2,500 source-backed gap acquisitions are queued through the same
16-worker/six-page crawler. Three manual program reviews staged 14 claim records;
eight entity-scope reviews and two matching-EIN website discoveries are retained.
Private run: `active-funders-150k-2026-10-18/bulk-sweep-2026-10-18/`.
Read `next-semantic-review-worklist.json` and `targeted-gap-acquisition/queued-work.json`.
Generated/queued work is not completed research. Inspect current PIDs/leases and
checkpoints before restarting; do not duplicate the workers.

Supabase remains read-only. Root `APPLICATION-BACKLOG.json` links bulk/wave
pending indexes, manual proposals, identity supplements and prior supersessions.
Before-images are dated complete read-only observations, requiring refresh before
any separately requested application. The deferred grant-census SELECT has an
unknown remote outcome; do not replay or reroute it. Heartbeat stays paused;
no new scheduling, outreach, deletion, main push or merge is authorized.

## Latest identity and inquiry continuation

Read [the identity/inquiry report](ACTIVE-FUNDERS-IDENTITY-GUIDANCE-2026-10-18.md)
before older snapshots. Nineteen organizations received source review; 22 local
proposals hold 107 claim records, six superseded, leaving 101 current records.
Forty-one actual research steps and twelve queries were recorded once. Supabase
remained read-only; all application and human approval remain pending.

Private continuation: `active-funders-150k-2026-10-18/identity-guidance-2026-10-18/`.
The root `APPLICATION-BACKLOG.json` links its proposals, identity comparisons and
mandatory operator-cycle supersession, alongside all earlier pending batches.
Best Friends' Binky award has a separate legal operator; do not attribute its
year-round intake to Binky Foundation. Filer-domain identity bridges do not
create human approval. The dated snapshot has 988 steps/693 organizations; the
150,000 target remains unverified. Workers/tracker continue; inspect current
leases/PIDs/checkpoints/disk before a restart. Heartbeat remains paused.

## Latest evidence-gap continuation

Read [the new evidence-gap report](ACTIVE-FUNDERS-GAPS-2026-10-18.md) before the
historical snapshots below. Twelve substantive source reviews produced16new
proposals/59claim records; one rolling-intake claim is superseded by a dedicated
closure notice, leaving58current records in this continuation. All are local,
unapplied and pending human review. Pool235322 is a search scope, not150000
verified funders. GET eligibility export completed. No Supabase mutations.

The crawler recovered a local lock interruption; source-evidence reader now
isolates malformed publisher links and rechecks four saved-source failures.
Current PID/lease files, not older IDs below, govern restart checks. The
application backlog additionally links followup proposals and a claim-specific
supersession record. Preserve all old bytes and before-images. Old heartbeat
paused; no new automation, outreach, deletion, main push or merge.

## Latest scope correction: recent givers or active funder websites

The user prioritizes funding organizations with a paid donation in the past
twelve months, or a live funder website. Record liveness, supported update
month/year and fit/inquiry guidance separately. Read
[the active-funder protocol](ACTIVE-FUNDERS-150K.md) and
[dated revision report](ACTIVE-FUNDERS-2026-10-18.md). The original fixed cohort
is retained and superseded for selection; its initial mechanical pass does not
complete the revised target. Do not pad 150,000 with unknowns.

Private current run: `data/research/active-funders-150k-2026-10-18/`. Its
`APPLICATION-BACKLOG.json` links every previous pending batch. All live
application is deferred. The original evidence follower is stopped; the new
active-funder follower uses the same existing bounded crawler. Inspect recorded
PIDs, locks and checkpoint state before restarting anything. Heartbeat paused.

## Historical launch: 150,000-member evidence campaign

The user authorized a bounded 501(c)(3) evidence-first enhancement campaign.
Exactly 150,000 unique-EIN members were frozen with explicit subsection03 source
observations; the full population remains unchanged. The evidence worker and the
16-worker crawler are running; the tracker on port8768 now shows both scopes.
The heartbeat remains paused. Remote writes remain deferred.

Read [the dated launch report](EVIDENCE-150K-2026-10-18.md) and
[operating contract](EVIDENCE-150K.md). Private run:
`data/research/verification-150k-2026-10-18/`. Backlog:
`APPLICATION-BACKLOG.json` under that directory, linking the prior pending batch.
Initial dispositions, source checks, structured candidates and human approvals
remain distinct. The detailed rules/model-benchmark phase is due after working
through the cohort; no automatic rule/model promotion or paid model batch exists.

## Current state: resumed under read-only database policy

The user explicitly authorized resumption on October 18. Local crawler (PID18540)
and tracker (PID18541, port8768) restarted at 09:01:40 UTC after stopped-state,
locks, checkpoints, full inventory hash and disk verification. The heartbeat is
still paused. No Supabase calls/mutations were made in this resumed session.
The historical stopped state below is retained for context, not current status.

See [the resumed report](RESEARCH-2026-10-18-RESUMED.md) for 129 added research
steps, the dated 914-step/661-organization snapshot, exact next actions and
limitations. Private backlog: `data/research/full-2026-10-17/resume-2026-10-18/pending-application.json`.
The eight saved candidates and one new GitLab proposal await separate application.
Saved searches/reviews are now reconciled; do not replay them or heartbeat-0744.

## Previous state: explicitly stopped

On October 18, 2026 the user stopped all previous work to resolve recurring SQL
approval interruptions. The heartbeat `continue-full-funder-database-research`
is PAUSED. Crawler 91991, tracker 23073 and keep-awake 25396 were stopped with
SIGTERM after checking their identities. All three are absent and the worker
and tracker locks are released. The local dashboard is consequently offline.
Nothing was deleted. Restart requires a new user instruction.

Repository: `/Users/zhynek/Documents/ChatGPT/Open-Funder/getfunded`.
Working directory: `corpus/`. Branch: `codex/funder-research-coverage`.
PR18 was explicitly authorized and merged at `38e2a4c`. Current draft:
https://github.com/Morton-Labs-AI/getfunded/pull/19, pushed head `ab830bb`.
Read private `data/research/full-2026-10-17/OPERATIONS.md` for complete history.

## What went wrong

The screenshot identifies a `plugin-runtime` SQL confirmation, not an ordinary
assistant clarification. A narrow UPDATE still triggered the connector's
destructive-SQL warning. Its exact classifier implementation is not available
in the installed skill bundle, so the reason it flagged this statement is not
confirmed. Quoted summaries contain semicolons, which could confuse a naive
statement splitter; this is a hypothesis, not an established root cause.

The concrete workflow error was retrying live mutations after an interrupted
approval and assuming WHERE guards and private backups would eliminate the
prompt. They do not control external approval checks. A DELETED archive protects
removed files; it neither archives SQL rows nor changes connector policy.
The latest retry returned `SQL execution was cancelled`. Do not replay it.

OpenAI's [MCP documentation](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
describes approvals as a tool execution boundary. It does not establish the
SQL classifier used by this connector or provide a verified fix for this warning.
No connector setting, security policy or credential was changed.

## Workflow correction

Research runs now use Supabase only for read-only queries and existing read-only
exports. All remote mutations, including raw-file registration and ledger writes,
are deferred. Continue acquisition, identity comparisons, news searches, recipient
reviews, local research_steps, original candidate compilations and draft PR work.
Save prepared changes locally with source hashes, expected row state and explicit
`awaiting_separate_application` status. This removes live SQL writes from the
unattended research path; it does not promise that other tools can never require
approval or that the connector itself has been repaired.

Do not repeatedly ask about pending database application. Accumulate one clear
application backlog and keep doing independent research. Apply it only in a
separately requested operator session, after current-state readback. Never switch
clients, disguise SQL or change credentials to bypass an approval. Do not mark
human review or publication on the user's behalf.

## Interrupted batch: preserve, do not replay

Private folder: `data/research/full-2026-10-17/continuation-0758/`.
Exact before-images: `database-before-images.json` (private, mode 600).
Eight prepared candidate IDs: **57, 61, 62, 64, 86, 87, 90, 91**.
Source snapshots and `signal-preparation.json` remain private. Original public
compilation `data/seed/research/daybreak-structured-signals-2026-10-18.jsonl`
exists locally, uncommitted; its bytes are registered and must not be overwritten.
The eight evidence preparations passed the existing evidence verifier.

Read-only reconciliation after cancellation confirms all eight candidate rows
remain unchanged: `status=candidate`, `raw_file_id=463`, `signal_type=NULL`, no
reviewer. Raw-file IDs **500–507** (publisher snapshots) and **508** (compilation)
were inserted before interruption. Ledger **562** exists with `status=running`,
zero rows updated and no completion time. This is an interrupted ledger entry,
not an active worker or a completed import. Leave it intact for later operator
reconciliation; do not issue a live UPDATE just to tidy it.

The batch includes conflicting Packard 2026 amounts ($985,834 versus $875,000),
distinct 2027/2030 commitments, separate fire-fund commitments, and expired
Heising-Simons deadlines. Candidate 90 has a visible May 7 versus metadata May 8
publication-date conflict. Preserve unknowns. Some saved HTML required direct
article-fragment extraction because the general extractor returned empty text;
the private preparation records the fallback. Do not change production parsing
or claim that problem fixed merely because manual extraction worked.

These eight preparations and eight executed follow-up queries have NOT yet been
added to research_steps or PR19. Record them once on resumption; do not recount
the completed heartbeat-0744 batch or rerun its script.

## Progress and restart checks

Denominator: **2,309,073**. Inventory SHA-256:
`f88461d994b2cc8110c6e1a2c1401b5b325d55fc31db14342ea60755f05627e7`.
Completed recorded work: **785 research steps across 579 organizations**;
human approval/publication remain zero. The 08:50 worker observation showed
73,173 attempted, 46,441 evidence-ready, 26,717 blocked, 15 running, 256,089 pending
and 1,979,811 missing-site. These are pre-shutdown observations, not live counts.
The stopped worker may leave running jobs; its restart recovery handles them.
Disk was about 193 GiB free. Never equate acquisition with cross-verification.

When the user resumes, inspect branch/worktree, current PID identities, locks,
checkpoints, disk and latest statuses before starting anything. Use the existing
16-worker, six-page, host-paced `research work --follow` workflow and the tracker
on port 8768. Preserve robots/TLS/body limits and the 10 GiB disk guard. Use
existing access; no credential or role changes. Do not assume old PIDs are safe
to signal. Do not delete locks or checkpoints. The old 14:40 UTC work-window
marker is historical context, not a new deadline or automatic restart command.

The old heartbeat remains paused on the old chat. Do not blindly reactivate it
alongside a new session. A resumed session can run directly; scheduling in that
new chat requires an explicitly requested schedule with the same read-only
Supabase restriction and quiet notifications.

Verified by: process absence and released locks, read-only candidate/ledger
reconciliation, and local handoff consistency. Tests: not run (weekly review policy).
