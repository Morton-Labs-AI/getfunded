# Agent notes for getfunded

Read README.md first.

## Testing policy (2026-10-08)

Zach's rule for every coding agent in this repo. Full text: `docs/testing-policy.md` in
`zach-hynek/digital-command-center` (also copied to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`).

- Do not write or run tests during a dev cycle. Do not wait on or poll CI after a push.
- Verify a change once with the cheapest direct check. Here: in `apps/web`, `npx tsc --noEmit`, then load the changed page once.
- Handoff line: `Verified by: <what you ran>. Tests: not run (weekly review policy).`
- Exceptions: Zach asks for tests; a bug that already escaped once (one reproducing test); changes to money,
  authentication, credentials, data deletion or database migrations.
- The full suite still runs in this repo's existing CI on push; red runs are reviewed weekly from the Isengard command center, not chased per push.

## Preserve removed material (user instruction, 2026-10-18)

## Unattended research: stage database changes locally (2026-10-18 correction)

- Read `corpus/docs/RESEARCH-RESUME.md` and the newest section at the TOP of the private campaign `OPERATIONS.md` before resuming. The user stopped the campaign; do not restart it without a new resume instruction.
- During unattended research, Supabase is READ-ONLY. Do not submit remote INSERT, UPDATE, DELETE, UPSERT, DDL, procedural blocks, mutating functions or ingestion-ledger writes. Prepare source-backed candidates and pending changes as local files instead. Local research queue/checkpoint writes remain permitted when research is resumed.
- Live database application is a separate, explicitly requested operator step. Pending application is not a reason to stop independent research, and locally prepared candidates must never be counted as database-applied or published.
- A connector cancellation, expired approval or approval prompt is not permission to retry. Record the exact pending operation and outcome, inspect read-only state if needed, and continue independent work. Do not repeatedly reissue the request in later heartbeats.
- Do not route a blocked mutation through a different client, SQL wrapper, RPC, encoded statement or service credential to evade the connector's approval. Do not change approval settings. Backups, a DELETED folder and WHERE clauses do not disable connector checks.
- This rule supersedes older campaign directions to keep applying candidates to Supabase during research. It changes the workflow, not the external connector's implementation.

### Retention rules

- Do not permanently delete files, source evidence or database records during the funder research campaign.
- If an authorized change requires removing a file from its active location, move it into `DELETED/<UTC timestamp>/<original repository-relative path>` without overwriting an existing archive. Record the original path, archived path, SHA-256, time and reason in a private append-only manifest. See `DELETED/README.md`. Do not move files merely to populate the archive.
- Database rows are not filesystem files. Preserve them; do not issue `DELETE`, `DROP` or `TRUNCATE` for this campaign. Before future candidate updates, save the exact selected rows privately as a before-image, alongside the existing source/provenance artifacts. Use explicit primary-key and expected-state `WHERE` conditions, retain the human-review/publication gates, and record affected IDs.
- Prefer the existing narrow candidate-ingestion path. Avoid anonymous procedural SQL blocks for routine updates; keep the requested operation and affected rows directly reviewable. Do not disable, bypass or promise suppression of platform approval checks. A generic destructive-operation warning does not itself establish that a deletion is present: inspect the actual SQL and report its effects accurately.
