---
title: Self-install
description: Run the database and the web app on your own computer or cloud account, with no plan limits.
group: developers
order: 1
---

# Self-install

You can run all of GetFunded yourself. The code is Apache-2.0 and the data pipeline is part of the repository. A self-install has no plan limits: every workspace is on an internal "Unlimited" plan, with your own API keys.

The two full guides in the repository are written for non-developers and are the source of truth:

- [corpus/docs/SELF-INSTALL.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/corpus/docs/SELF-INSTALL.md): the database.
- [apps/web/README.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/apps/web/README.md): the web app.

This page is the short version.

## What you need

- Node.js 22 or newer.
- Python 3.12 with [uv](https://docs.astral.sh/uv/).
- A Postgres 15 or 16 database with the `vector` extension. A free Supabase project works for the small profile. So does Docker.
- A Supabase project for sign-in (magic link). The app uses Supabase Auth for the session only; it never reads data through it.

## Part 1: Build the database

```bash
git clone https://github.com/Morton-Labs-AI/getfunded
cd getfunded/corpus
uv sync
cp .env.example .env            # set DATABASE_URL and SEC_USER_AGENT
uv run funderdb doctor          # checks your setup
uv run funderdb migrate         # creates the schema
uv run funderdb bootstrap --profile small   # a laptop-sized slice, under an hour
```

The `small` profile loads every private foundation from the IRS master file, one year of filing records and a sample of 2,000 parsed 990-PF returns. The `full` profile loads everything: about 250 GB of staged IRS files, a 30-40 GB database, and several days of runtime. Both are resumable; if a run stops, run the same command again.

Semantic search is optional. `uv run funderdb embed sync` builds it and needs a `VOYAGE_API_KEY`.

## Part 2: Create the app's database role

One SQL statement, run as the database owner (the `postgres` role on Supabase):

```sql
create role getfunded_login login password '<choose a password>' in role getfunded_app;
```

`getfunded_app` is created by the app's migrations in Part 3, so run `npm run db:migrate` first if the statement says the role does not exist.

## Part 3: Run the web app

```bash
cd ../apps/web
npm ci
cp .env.example .env.local      # DATABASE_URL (getfunded_login), Supabase Auth keys, SELF_HOSTED=true
npm run db:migrate              # creates the getfunded schema
npm run db:ping                 # proves the app can read the corpus and cannot write it
npm run dev                     # http://localhost:3050
```

`npm run db:ping` must print `PASS`. It checks four things: a corpus read works, a corpus write is refused, a workspace write works under Row Level Security, and a delete on an append-only table is refused.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | The `getfunded_login` role over the Supabase session pooler |
| `MIGRATE_DATABASE_URL` | for migrations | An owner role with BYPASSRLS; never in a deployed app |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase Auth, session only |
| `APP_URL` | yes | Absolute origin for links and same-origin checks |
| `SELF_HOSTED` | yes for self-install | `true` puts every workspace on the Unlimited plan and hides billing |
| `ANTHROPIC_API_KEY` | for AI | Your own key; only `lib/ai/client.ts` reads it, only through `meter()` |
| `AI_MODEL_FAST`, `AI_MODEL_DEEP` | no | Model overrides |
| `AI_ENABLED` | no | `false` turns off all model calls and shows a notice |
| `AI_MODE` | no | `mock` gives a deterministic, token-free model for local work and tests |
| `ANALYST_DATABASE_URL` | for Ask | The `funder_ro` role; the only connection that runs model-written SQL |
| `VOYAGE_API_KEY` | for semantic search | Query embeddings, voyage-3.5 at 512 dimensions |
| `ADMIN_EMAILS` | no | Comma-separated logins allowed under `/admin` |
| `SECRETS_KEY` | for Gmail | 32-byte base64 key for encrypting integration tokens |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Gmail | OAuth for sending through a user's own Gmail |
| `STRIPE_*` | hosted only | Leave empty when `SELF_HOSTED=true` |

Every variable has a one-line comment in `apps/web/.env.example`.

## Deploy to Vercel

1. Import the repository in Vercel.
2. Set the **Root Directory** to `apps/web`.
3. Add the environment variables above. Set `SELF_HOSTED=true` and `APP_URL` to your deployment's origin.
4. In Supabase, add `APP_URL/auth/callback` to **Authentication → URL Configuration → Redirect URLs**.
5. Deploy.

Anything else that runs Next.js works too: `npm run build` then `npm start` serves the app on port 3050.

## Keeping it up to date

```bash
git pull
cd corpus && uv sync && uv run funderdb migrate
cd ../apps/web && npm ci && npm run db:migrate && npm run build
```

Re-running an ingest command reuses cached downloads until they age out, then downloads only what changed.

## Running the checks

```bash
cd corpus && uv run pytest -q           # unit tests, no database needed
cd apps/web && npm run check            # typecheck, lint, unit tests, build
```

The web unit tests run the migrations on an in-process Postgres and never touch a real database, Stripe or Anthropic.

## Naming your install

The code is yours to run. The name and logo are not: see [TRADEMARK.md](https://github.com/Morton-Labs-AI/getfunded/blob/main/TRADEMARK.md). If you host it for other people, give it its own name and say "based on GetFunded".
