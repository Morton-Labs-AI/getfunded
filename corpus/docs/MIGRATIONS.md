# Migrations

The schema lives in `migrations/NNNN_description.sql`, plain SQL applied in
filename order by `funderdb migrate`. There is no ORM and no generated code:
what is in the file is what runs.

## Running

```
uv run funderdb migrate --dry-run     # show the plan, change nothing
uv run funderdb migrate               # apply every pending file
uv run funderdb migrate --to 0012     # stop after 0012 (inclusive)
```

Before touching anything, the runner checks that the server offers the
extensions the schema needs and fails with a message naming the package:

| Extension | Needed for | Required |
|---|---|---|
| `vector` (pgvector) | `halfvec(512)` embeddings and HNSW search (0008) | yes |
| `pg_trgm` | trigram indexes on organization names (0001) | yes |
| `pgcrypto` | `gen_random_uuid()` on Postgres < 13 (built in since 13) | no |
| `uuid-ossp` | not used; listed because some forks add it | no |
| `pg_cron` | optional scheduled materialized-view refresh | no |

The migrations themselves run `create extension if not exists`, so an
extension only has to be *available* (installed on the server), not already
created in the database.

Roles: `0000` creates `funder_ro`, `funder_rw` and `ofdb_publisher`; `0022` sets their
grants; `0036` adds `greenbook_ro`, the read identity for `apps/greenbook`. None of them can
log in; attaching a login is an operator step (see each file's header).

## The ledger

Each applied file is recorded in `internal.schema_migrations`:

| column | meaning |
|---|---|
| `filename` | e.g. `0008_semantic_search.sql` (primary key) |
| `sha256` | hash of the file bytes at the time it was applied |
| `applied_at` | when |
| `applied_by` | the database user that ran it |

The runner creates the `internal` schema and this table itself, idempotently,
because the ledger must exist before `0001` runs.

Each file runs in its own transaction together with its ledger insert, so a
failing migration leaves neither half-applied SQL nor a misleading ledger
row. Nothing in the current files uses `CREATE INDEX CONCURRENTLY` or other
statements that refuse to run inside a transaction; if a future file needs
one, it needs a runner change first.

## Hash conflicts

On every run the sha256 of each applied file is compared with the ledger.
A difference means the file was edited after it ran. The runner **refuses to
continue** and names the file:

```
conflict      0008_semantic_search.sql  applied sha 3f1c... != file sha 9a2e... (use --force to re-run)
```

Two ways out:

- restore the file to what was applied (usually: you edited the wrong file;
  new changes belong in a new numbered file), or
- `funderdb migrate --force`, which re-runs the changed file and records its
  new hash. Only do this when the file is idempotent by construction (0022
  and 0024 are; 0001-0021 are not).

## Databases built before the runner existed

The original database had 0001-0024 applied by hand. Its tables exist but
there is no ledger. `funderdb doctor` detects this and says so. Tell the
runner where you are without re-running anything:

```
uv run funderdb migrate --baseline 0024
uv run funderdb migrate               # applies 0025+ only
```

`--baseline NNNN` records every file numbered ≤ NNNN as applied, with its
current hash, and executes none of them. (`0000_roles_bootstrap.sql` is
covered by the baseline too: on that database the roles were created by
0022, and 0000 would have been a no-op.)

## Writing a new migration

1. Take the next number: `ls migrations | tail -1`, add one, four digits.
2. One concern per file, with a header comment that says *why* — the
   existing files are the style guide. Measured numbers in comments are
   welcome; secrets, hostnames and project refs are not.
3. Never edit a file that has been applied anywhere. Fix forward in a new
   file. (The hash check exists to make this rule enforceable.)
4. Grants may name only roles created in `0000_roles_bootstrap.sql`
   (`funder_ro`, `funder_rw`, `ofdb_publisher`). A new role goes into 0000
   with an `if not exists` guard, and that edit is the one exception to
   rule 3 — 0000 is idempotent.
5. A new `create view public.*` must repeat the revoke from
   `0024_public_view_grant_hygiene.sql` for `anon` / `authenticated`, guarded
   on the roles existing, because Supabase default privileges grant ALL on
   new objects.
6. Prefer `if not exists` / `or replace` where the statement allows it, so a
   file that fails halfway can be re-run after the fix.
7. Run `uv run funderdb migrate --dry-run` and the test suite:
   `tests/test_migrate.py::test_real_migrations_directory_is_well_formed`
   checks numbering, uniqueness and that every granted role exists.

## Why `0000`, and why `0022` and `0024` changed

`0008` granted to `funder_ro`, which only `0022` created, so a clean replay
died at 8 of 24. `0000_roles_bootstrap.sql` now creates every role ahead of
first use. `0022` keeps its own guarded `create role` block (so a database
that applied 0022 by hand and never ran 0000 still converges) and keeps all
its grants and settings; only its header comment changed. `0024` revoked
privileges from the Supabase roles `anon` and `authenticated`, which do not
exist on vanilla Postgres and would abort the replay; it now revokes only
from the roles present. Files were not renumbered.

## Clean replay from zero

```
docker run --rm -e POSTGRES_PASSWORD=x -p 5433:5432 -d pgvector/pgvector:pg16
DATABASE_URL=postgresql://postgres:x@localhost:5433/postgres uv run funderdb migrate
```

A full replay against an empty database applies 0000-0025 and finishes with
`up to date` on the second run. Maintainers should do this before tagging a
release; it is the only proof that the files, not just the live database,
describe the schema.
