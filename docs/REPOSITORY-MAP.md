# Repository map

Where everything that touches the Open Funder Database lives after the October 2026 consolidation,
who owns it, which database it uses, and where it runs. Six repositories became three. This file is
the single place to look before cloning, archiving or creating a repository in this family.

## The three repositories

| Repository | Purpose | Visibility, licence | Supabase project and roles | Deploy target | Owner |
|---|---|---|---|---|---|
| [Morton-Labs-AI/getfunded](https://github.com/Morton-Labs-AI/getfunded) | The open-source home of the Open Funder Database: `corpus/` (the Python pipeline and every corpus migration, with the hash ledger), `apps/web/` (the hosted app at getfunded.ai), `apps/greenbook/` (Greenbook, the maintainer's dashboard and the local-only human review consoles). | Public. Apache-2.0 code, CC BY 4.0 data. | `poznaikbjcgnthfmqueo` ("open-funder-db"). Corpus plane `internal.*` and `public.*` views, written only by the pipeline as the owner. Roles: `getfunded_app` + `getfunded_login` (web app, workspace plane `getfunded.*`), `funder_ro` (the analyst's model-written SQL, allowlist only), `greenbook_ro` (Greenbook pages, corpus migration 0036), `funder_rw` (Greenbook `/admin` consoles, the only human write path into the corpus), `ofdb_publisher`. | Vercel project `getfunded`, root directory `apps/web`, production at getfunded.ai, one daily cron and one six-hourly signals cron. `corpus/` runs on the maintainer's machine. `apps/greenbook` is local only (`ADMIN_ENABLED=1` never on a public host). CI: `.github/workflows/ci.yml` on push and pull request, path-filtered per app. | Zach Hynek (zach@mortonlabs.ai), Morton Labs, steward. |
| [Morton-Labs-AI/dnw-funder-intelligence](https://github.com/Morton-Labs-AI/dnw-funder-intelligence) | Donor Network West's private fundraising workspace on top of the corpus: discovery, fit engine, pipeline, outreach machine, engagements. | Private. DNW's brand and data never enter a public repository. | Same project `poznaikbjcgnthfmqueo`, schema `dnw.*`, roles `dnw_app` (reads the corpus through grants, writes only `dnw.*`) and `dnw_tracker`. Migrations `dnw_0001` onward, applied by hand through the Supabase MCP, no runner. Handoff promise: `pg_dump --schema=dnw`. | Local only, port 3020, never deployed (no real authentication yet). CI: weekly test workflow only. | Zach Hynek for Morton Labs, on behalf of Donor Network West. |
| [Morton-Labs-AI/morton-fundraising](https://github.com/Morton-Labs-AI/morton-fundraising) | Morton Capital: Morton Labs' own investor-outreach CRM. A sourced static catalog of investors (`data/`), a private local-first JSON workspace, Gmail delivery with human approval, a Chrome side-panel extension, knowledge documents, and a loopback MCP endpoint for Claude. | Private. The catalog is the only versioned data; the workspace, dossiers and messages never enter `data/`. | None live. Local mode stores `.local/workspace.json`. Cloud mode expects a separate Supabase project that has not been created (`docs/BACKEND-SETUP.md`); it never uses the corpus project. | Local only, loopback `127.0.0.1:3040`. Default branch `codex/fundraising-foundation`. CI: `ci.yml` on every push (full suite). | Zach Hynek and Hamilton, Morton Labs founders. |

## Archived repositories (read-only on GitHub)

| Repository | What replaced it | What was kept |
|---|---|---|
| Morton-Labs-AI/open-funder-db | `getfunded/corpus` (imported with `git subtree`, history preserved, 2026-10-07). getfunded's copy was already a strict superset: the migration runner, doctor, bootstrap, backfill, repair, derive, aliases, IRS standing, migrations 0000 and 0025 to 0036. | Nothing to move. Its funder-signals branch was superseded by getfunded PR #10 (migration 0035). |
| Morton-Labs-AI/open-funder-db-ui (Greenbook) | `getfunded/apps/greenbook` (`git subtree add`, 36 commits, getfunded PR #11). | The work-in-progress community layer (schema `community.*`, live in the database since 2026-09-06) is preserved unmerged as getfunded branch `claude/greenbook-community-layer`. |
| Morton-Labs-AI/get-funded (the Lovable prototype "Morton Labs CRM") | `morton-fundraising`. The command-center interface and the Gmail/Calendar/LinkedIn capture flows were carried on 2026-10-07; the MCP server (`app/api/mcp`) and the knowledge base (`/knowledge`) were re-homed on 2026-10-09 (morton-fundraising PR #15); the company narrative is Settings, Company profile. | Not carried: the Gemini, Perplexity and Firecrawl edge functions (Claude with web search does research here), the GitHub connector (stored a plaintext token; Claude Code reads the repositories directly), `ask_crm`. Its Supabase project `fiajkyujgnsawrcavigm` is paused once its data is exported. |

## Boundaries that every repository keeps

- **One-way corpus.** Apps read `internal.*` through role grants and never write it. The only human
  write path is Greenbook's `/admin` consoles through `funder_rw`, on a local machine.
- **Private planes stay private.** `getfunded.*`, `dnw.*` and Morton Capital's workspace never enter a
  public repository or `data/`.
- **Migrations are new files only.** `corpus/migrations` (hash ledger `internal.schema_migrations`),
  `apps/web/migrations` (ledger `getfunded.schema_migrations`), `dnw-funder-intelligence/migrations`
  (applied by hand). An applied file is never edited.
- **Shared code is copied with a header, not packaged.** `apps/web/lib/signals/labels.ts` and
  `dnw-funder-intelligence/lib/signals/labels.ts` are byte-identical by hand; the header in each
  names the other. Measured in October 2026: the three apps' data-class components and corpus
  queries share no filenames and no function names, so a package would have been ceremony for one
  identical file.
- **Testing policy.** Every repository's `AGENTS.md` carries the weekly-review rule: verify a change
  once with the cheapest direct check, no tests during a dev cycle, exceptions for money, auth,
  credentials, deletion and migrations.

## Operator-only facts

Connection strings, passwords and API keys live in the operator's private notes, never here. The
logins that exist today are `getfunded_login`, `funder_ro`, `dnw_app`; `greenbook_ro` has no login
until the operator creates one (corpus migration 0036).
