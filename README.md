# GetFunded

**Find the funders who already fund work like yours.**

GetFunded is an open-source fundraising database and research tool for nonprofits. It turns
public records (IRS Form 990 and 990-PF filings, the IRS exempt-organization master file, SEC
filings, SBIR awards) into a searchable database of foundations and other funders, with the
source of every fact one click away. On top of that database it adds a workspace: save funders,
track a pipeline, keep tasks, and ask an AI assistant to explain fit, draft outreach, and answer
questions, always with its evidence shown and always labelled as AI.

You can use it two ways:

- **Hosted at [getfunded.ai](https://getfunded.ai).** Enter your name and email. The free plan
  includes unlimited funder search and a monthly allowance of AI credits. Paid plans add more
  credits, more seats, exports, outreach, and an API. See [docs/PLANS.md](docs/PLANS.md).
- **Self-install.** Run the whole thing on your own computer or cloud account, with your own
  API keys and no plan limits. The code is Apache-2.0 and the dataset is CC BY 4.0.

## What is in this repository

| Folder | What it is | Start here |
|---|---|---|
| `corpus/` | The data pipeline. A Python command-line tool (`funderdb`) that downloads public filings, verifies them, loads them into Postgres, and builds the search index. | [corpus/README.md](corpus/README.md), [corpus/docs/SELF-INSTALL.md](corpus/docs/SELF-INSTALL.md) |
| `apps/web/` | The website and app. Next.js. Public search, funder profiles, sign-in, workspace, AI features, billing, admin. | [apps/web/README.md](apps/web/README.md) |
| `docs/` | How it is designed: [ARCHITECTURE.md](docs/ARCHITECTURE.md), [DATA-MODEL.md](docs/DATA-MODEL.md), [PLANS.md](docs/PLANS.md), RFCs. | |
| Root files | [GOVERNANCE.md](GOVERNANCE.md), [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), [LICENSE](LICENSE), [DATA-LICENSE.md](DATA-LICENSE.md), [TRADEMARK.md](TRADEMARK.md) | |

## Self-install in three parts

You need Node.js 22 or newer, Python 3.12 with [uv](https://docs.astral.sh/uv/), and a Postgres
database with the `vector` extension (a free Supabase project works; so does Docker).

**1. Build the database.**

```bash
cd corpus
uv sync
cp .env.example .env            # set DATABASE_URL and SEC_USER_AGENT
uv run funderdb doctor          # checks your setup
uv run funderdb migrate         # creates the schema
uv run funderdb bootstrap --profile small   # a laptop-sized slice, under an hour
```

The `full` profile loads everything (hundreds of gigabytes of filings, days of runtime). See
[corpus/docs/SELF-INSTALL.md](corpus/docs/SELF-INSTALL.md).

**2. Create the app's database role.** One SQL statement, run as the database owner:

```sql
create role getfunded_login login password '<choose a password>' in role getfunded_app;
```

**3. Run the web app.**

```bash
cd apps/web
npm ci
cp .env.example .env.local      # DATABASE_URL (getfunded_login), Supabase Auth keys, SELF_HOSTED=true
npm run db:migrate              # creates the getfunded schema
npm run db:ping                 # proves the app can read the corpus and cannot write it
npm run dev                     # http://localhost:3050
```

Add `ANTHROPIC_API_KEY` for AI features and `VOYAGE_API_KEY` for semantic search. Without them
the app still runs: AI buttons explain that no key is set, and search falls back to keywords.

Deploy to Vercel with the root directory set to `apps/web`, or anywhere that runs Next.js.

## Working with an AI agent

This repository is written so that a coding agent can install, run, and extend it. Each part has
an `AGENTS.md` with the rules that matter (data honesty, the read-only corpus boundary, metering,
no private data). A good first prompt for an agent:

> Read README.md, docs/ARCHITECTURE.md and apps/web/AGENTS.md. Then install GetFunded locally
> using corpus/docs/SELF-INSTALL.md with the small profile and tell me what you found.

## The rules every change keeps

1. Unknown is not closed. When a filing does not say whether a funder accepts applications,
   we say "Not stated in filings".
2. Missing data reads "Not available", never "$0".
3. Contact details are shown only when the source permits it. Never from vendors.
4. Every fact carries its source file and record locator.
5. AI output is labelled, cites its evidence, and never claims a funder is interested.
6. No fabricated data. No demo data in production.
7. Amended filings replace the originals everywhere.

The full list and how decisions are made are in [GOVERNANCE.md](GOVERNANCE.md).

## Contributing

Issues and pull requests are welcome, including ones written with AI help and reviewed by a
person. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the pull-request checklist, and the
sign-off rule. Security reports go through [SECURITY.md](SECURITY.md).

## License

Code: [Apache License 2.0](LICENSE). Dataset: [CC BY 4.0](DATA-LICENSE.md). The GetFunded name
and logo are trademarks of Morton Labs; see [TRADEMARK.md](TRADEMARK.md).

Built and stewarded by [Morton Labs](https://mortonlabs.ai).
