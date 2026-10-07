# Self-install: run the Open Funder Database on your own machine

This guide gets a nonprofit from nothing to a working, queryable copy of the
database in about an hour, using only free tools. You do not need to be a
developer. Every step is a command you paste into a terminal.

What you end up with:

- a Postgres database with every U.S. private foundation from the IRS master
  file, the curated federal funding programs, one year of 990-PF filing
  records, and a sample of foundation grant and officer data;
- the `funderdb` command, which can grow that database to the full corpus
  whenever you have the disk and the time.

## Before you start

You need:

- a Mac, Linux, or Windows (WSL) machine with about 10 GB of free disk;
- an internet connection (the small install downloads roughly 1-2 GB);
- a Postgres 15 or 16 database with the `pgvector` extension available.
  Step 2 shows two free ways to get one.

## Step 1 — Install uv

`uv` installs Python and the project's dependencies for you.

```
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Close and reopen your terminal, then check:

```
uv --version
```

## Step 2 — Create a Postgres database

Pick one.

### Option A: Supabase free tier (hosted, nothing to install)

1. Go to <https://supabase.com>, create an account and a new project. Choose
   any region and a strong database password — write the password down.
2. Wait for the project to finish provisioning (about two minutes).
3. Open **Project Settings → Database**. Under **Connection string** choose
   **URI** and the **Session** mode (port 5432). Copy it. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` with your password.
4. Supabase ships `pgvector` and `pg_trgm` already. Nothing to enable by hand.

Note: the free tier has a 500 MB database limit. It is enough for the small
profile. The full corpus needs a paid plan (tens of GB) or a local database.

### Option B: Local Docker (everything on your machine)

1. Install Docker Desktop from <https://www.docker.com/products/docker-desktop/>.
2. Start a Postgres that already contains pgvector:

   ```
   docker run --name funderdb \
     -e POSTGRES_USER=funderdb \
     -e POSTGRES_PASSWORD=funderdb \
     -e POSTGRES_DB=funderdb \
     -p 5432:5432 \
     -v funderdb-data:/var/lib/postgresql/data \
     -d pgvector/pgvector:pg16
   ```

3. Your connection string is
   `postgresql://funderdb:funderdb@localhost:5432/funderdb`.

To stop it later: `docker stop funderdb`. To start it again: `docker start funderdb`.
Your data stays in the `funderdb-data` volume.

## Step 3 — Get the code and set DATABASE_URL

```
git clone <this repository>
cd <repository>/corpus
uv sync
cp .env.example .env
```

Open `.env` in any text editor and set:

- `DATABASE_URL=` the connection string from Step 2.
- `SEC_USER_AGENT=` your organisation's name and a contact e-mail, for example
  `"Example Nonprofit data@example.org"`. The SEC requires this before it
  serves any download. It is only used for the SEC sources (Form ADV, Form D),
  which the small profile does not touch, so you can leave it for later.
- Leave `VOYAGE_API_KEY` empty unless you want semantic search (see the end).

Every other line in `.env.example` has a comment explaining it.

## Step 4 — Check your setup

```
uv run funderdb doctor
```

You should see `OK` for python, uv, migrations, data dir and DATABASE_URL.
`WARN` lines are informational (for example, SEC_USER_AGENT not set yet).
Any `FAIL` line tells you exactly what to fix. The most common ones:

| Message | What to do |
|---|---|
| `cannot connect` | Check the password and that the database is running (`docker ps`). On Supabase, use the **Session** connection string, not Transaction (port 6543). |
| `extension 'vector' is not available` | Your Postgres does not have pgvector. Use the Docker image above, or install the `postgresql-16-pgvector` package. |
| `disk ... GB free` | Free up space or point `DATA_ROOT` in `.env` at a bigger drive. |

## Step 5 — Install the schema and load the small dataset

```
uv run funderdb bootstrap --profile small
```

This runs, in order, printing progress for each step:

1. `migrate` — creates every table, view and function (26 migration files).
2. `ingest seed` — 10 federal agencies and 16 federal funding programs.
3. `ingest bmf` — the IRS Exempt Organizations Business Master File
   (four CSVs, about 250 MB), keeping the ~135,000 private foundations.
4. `ingest filings --year <newest>` — the IRS e-file index for the newest
   year: one row per filed 990 / 990-PF, with amended-return supersession.
5. `ingest 990pf --year <newest> --limit 2000` — downloads one IRS batch zip
   (typically 0.3-1 GB) and parses 2,000 full 990-PF returns: officers,
   grants paid, Schedule B, Part XV application contacts.
6. `status` — the ledger of what ran and the row counts.

How long: 20-45 minutes on a typical home connection; most of it is
downloading. Everything is resumable. If it stops (network, laptop closed),
run the same command again and it continues from where it was.

Want more or fewer filings in the sample? `--limit 500` or `--limit 20000`.

## Step 6 — Look at what you have

```
uv run funderdb status
```

Then connect with any SQL tool (psql, TablePlus, DBeaver, the Supabase SQL
editor) using the same connection string. The tables you want are the views
in the `public` schema — they are the publishable projection:

```sql
select name, city, state, asset_amount
from public.organizations
where org_type = 'private_foundation' and state = 'TX'
order by asset_amount desc nulls last
limit 20;

select * from public.funding_events where funder_org_id = '<an id from above>';
```

`internal.*` holds the base tables, including things we do not republish
(see `docs/PROVENANCE.md`).

## Going further

### Refreshing

The sources change over time. Re-running an ingest command reuses cached
downloads until they are older than a per-source age (BMF: 30 days, current
year's IRS index: 7 days, SEC ADV feed: 7 days), then checks upstream and
downloads only if the file actually changed. To force a check now:

```
uv run funderdb ingest bmf --refresh
```

Rows record the vintage of the file they came from, not the day you ran the
command, so a refresh never makes old data look new.

### The full corpus

```
uv run funderdb bootstrap --profile full
```

This loads every source and every year: all 2.2M exempt organizations, six
years of 990 and 990-PF filings with financials, public-charity Schedule I
grants, filer websites, SEC Form ADV and Form D, and SBIR/STTR awards.

Budget for it:

- **Disk**: about 250 GB for the staged IRS zips (they are kept, hashed, as
  the provenance for every row), plus a database of 30-40 GB.
- **Time**: several days of downloading and parsing. Every step is resumable
  and idempotent, so it can run overnight in pieces.
- **Settings**: `SEC_USER_AGENT` must be set (the SEC sources refuse to run
  without it). A Supabase free-tier database is too small; use Docker or a
  paid plan.

You can also run any single step from the list in `uv run funderdb --help`;
`full` only chains them.

### Semantic search (optional)

`funderdb embed sync` builds the hybrid search corpus with Voyage AI
embeddings. It needs a `VOYAGE_API_KEY` (paid, a few dollars for the full
corpus). Nothing else depends on it.

## Updating later

When you pull a newer version of the code:

```
uv sync
uv run funderdb migrate --dry-run   # shows what would change
uv run funderdb migrate             # applies only new migrations
```

See `docs/MIGRATIONS.md` for how the runner keeps your database and the
migration files in agreement.
