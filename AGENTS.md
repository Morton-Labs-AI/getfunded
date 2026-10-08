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
