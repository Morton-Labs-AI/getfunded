-- getfunded_0012: let the app role read the recipient alias evidence.
--
-- Corpus migration 0027 (corpus/migrations/0027_recipient_aliases.sql) adds
-- "filers as witnesses": when three or more grant-making charities wrote the
-- same recipient name and state with one EIN on Schedule I of their own
-- Form 990 returns, a foundation's grant row with that name, that state and a
-- matching city is linked to the same organization. A funder page must be
-- able to say why such a row carries a link, so the app role reads:
--
--   internal.recipient_alias_links   one row per linked grant row
--                                    (event_id, alias_id, linked_at)
--   public.recipient_aliases         the license-filtered alias facts
--                                    (n_filers, status, first_fy, last_fy, ...)
--   internal.recipient_aliases       the same facts, for a join written
--                                    against the internal table
--
-- Read only, three relations, nothing else. Nothing is granted to the analyst
-- role: its readable relations must stay equal to the SQL guard's allowlist
-- (`npm run db:ping` checks that).
--
-- Corpus grants only, so the whole file is one `-- @roles-begin corpus` block,
-- which the PGlite harness strips. On a database with no corpus at all (no
-- schema `internal`) the block is skipped with a NOTICE, so a clean replay on
-- vanilla Postgres still succeeds.
--
-- Order on a real database: `funderdb migrate` (corpus 0027) FIRST, then this
-- file. On a database that has the corpus but not 0027 this file stops with
-- an error and records nothing, so it cannot be marked "applied" while it
-- granted nothing. The web app probes the grants
-- (lib/queries/corpus/recipient-aliases.ts canReadAliasLinks) and leaves the
-- explanation line out until they are there, so the order of web deploy and
-- migrate does not matter.

-- @roles-begin corpus
do $$
declare
  rels constant text[] := array[
    'internal.recipient_alias_links',
    'internal.recipient_aliases',
    'public.recipient_aliases'
  ];
  rel text;
  missing text[] := '{}';
begin
  if to_regnamespace('internal') is null then
    raise notice 'getfunded_0012: schema internal not present; skipping corpus grants';
    return;
  end if;
  foreach rel in array rels loop
    if to_regclass(rel) is null then
      missing := missing || rel;
    end if;
  end loop;
  if array_length(missing, 1) is not null then
    raise exception 'getfunded_0012: % not present. Apply corpus migration 0027 first (`uv run funderdb migrate` in corpus/), then run this migration again.', array_to_string(missing, ', ');
  end if;
  foreach rel in array rels loop
    execute format('grant select on %s to getfunded_app', rel);
  end loop;
end $$;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand, on the live database, as getfunded_login):
--   select count(*) from internal.recipient_alias_links;      -- works
--   select n_filers, status from public.recipient_aliases limit 1;  -- works
--   insert into internal.recipient_alias_links values (gen_random_uuid(), 1);  -- MUST fail
-- As the analyst role:
--   select count(*) from public.recipient_aliases;            -- MUST fail (not on the allowlist)
