# Agent notes for apps/greenbook (Greenbook)

Read README.md first, then the repository rules in `../../AGENTS.md` and `../../GOVERNANCE.md`.
This app reads the corpus built by `../../corpus` and must never write `internal.*` outside the
`/admin` consoles, which use `funder_rw` and run on a local machine only (`ADMIN_ENABLED=1`).
It carries no private data: no `.env*` except `.env.example`, no labels beyond the CC BY seeds in `../../corpus/data`.

## Testing policy (2026-10-08)

Zach's rule for every coding agent in this repo. Full text: `docs/testing-policy.md` in
`zach-hynek/digital-command-center` (also copied to `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`).

- Do not write or run tests during a dev cycle. Do not wait on or poll CI after a push.
- Verify a change once with the cheapest direct check. Here: `npx tsc --noEmit`, then run the changed page or command once.
- Handoff line: `Verified by: <what you ran>. Tests: not run (weekly review policy).`
- Exceptions: Zach asks for tests; a bug that already escaped once (one reproducing test); changes to money,
  authentication, credentials, data deletion or database migrations.
- This app has no automated test run; CI typechecks and lints it. Verify by hand and say so in the handoff.
