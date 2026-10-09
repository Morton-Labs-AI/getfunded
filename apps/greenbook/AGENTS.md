# Agent notes for open-funder-db-ui

Read README.md first.

## Testing policy (2026-10-08)

Zach's rule for every coding agent in this repo. Full text: `docs/testing-policy.md` in
`zach-hynek/digital-command-center` (also copied to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`).

- Do not write or run tests during a dev cycle. Do not wait on or poll CI after a push.
- Verify a change once with the cheapest direct check. Here: `npx tsc --noEmit`, then run the changed page or command once.
- Handoff line: `Verified by: <what you ran>. Tests: not run (weekly review policy).`
- Exceptions: Zach asks for tests; a bug that already escaped once (one reproducing test); changes to money,
  authentication, credentials, data deletion or database migrations.
- This repo has no automated test run. Verify by hand and say so in the handoff.
