# Working agreements for `corpus/`

Read this before changing the data pipeline. These rules are enforced by tests and SQL
constraints where possible; the rest is on you and your reviewer.

1. **File first.** Every input (bulk CSV, XML zip, API pull, curated seed) is sha256-hashed and
   registered in `internal.raw_files` before parsing. Every fact row carries `raw_file_id` and a
   `source_record_locator`. No fact without a file.
2. **Mutable feeds have a vintage.** Use `stage_download(..., mutable=True, max_age=...)` for
   feeds that reuse a filename. Never pick a cached file by hash order. `last_verified_at` is the
   file's vintage, not the time you ran the loader.
3. **Publication is a database property.** `internal.*` is private. Only `public.*` views are
   publishable, and only rows whose source is `republishable` in `internal.licensing_map`.
   Contact channels additionally require `publishability = 'public'`; the trigger that blocks
   vendor-sourced contacts from ever becoming public stays.
4. **Unknown is not closed.** Application posture comes from the latest *parsed*, unsuperseded
   filing. When a filing says nothing, the value is `unknown`, rendered downstream as
   "Not stated in filings".
5. **Amended returns win.** Within (EIN, return type, tax period) the greatest object id wins and
   losers carry `superseded_by_object_id`. No superseded filing may keep event rows.
6. **Numbers are never invented.** Missing is NULL. A filed zero is 0. Do not derive check sizes,
   appetite, or eligibility from AUM, offering size, or historical grants.
7. **Migrations are append-only files.** Add `NNNN_name.sql`; never edit an applied file except
   for comments. `funderdb migrate` records a hash per file and refuses changed hashes.
8. **Roles come first.** `0000_roles_bootstrap.sql` creates every role later files reference.
   New grants go in a migration, never by hand.
9. **No identity in code.** `SEC_USER_AGENT` and attribution strings come from settings. No
   personal names, emails, or client names in code, comments, seeds, or fixtures; public IRS
   filings used as test fixtures are fine because they are public records.
10. **Evaluate before you claim.** `uv run pytest -q` must pass offline. Changes that touch loaders
    or views also run `uv run funderdb eval all` against a database and paste the dated block into
    `benchmarks/queries.sql`.

Commands: `uv run funderdb --help`, `uv run funderdb doctor`, `uv run funderdb migrate`,
`uv run funderdb bootstrap --profile small`. Docs: `docs/SELF-INSTALL.md`, `docs/DATA-SOURCES.md`,
`docs/MIGRATIONS.md`, `docs/PROVENANCE.md`.
