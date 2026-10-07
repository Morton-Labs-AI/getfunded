-- 0000: role bootstrap — every role a later migration grants to must exist
-- before the first grant runs.
--
-- WHY THIS FILE EXISTS. 0008_semantic_search.sql:57 grants to funder_ro, but
-- that role was only created in 0022_roles.sql, so a clean replay of the
-- numbered migrations failed at 8 of 24 with `role "funder_ro" does not
-- exist`. Moving the CREATE ROLE statements ahead of first use is the only
-- fix that keeps every other file's number and content intact; 0022 stays
-- idempotent against this file and still owns the grants and settings.
--
-- NO LOGIN, NO PASSWORD, EVER. These roles are grant containers. Attaching a
-- password is an operator step, out of band, never in a file that ships public.
--
-- Roles are cluster-wide objects in Postgres, so `create role` is not
-- transactionally scoped per database and cannot use `if not exists`; the
-- DO block makes the whole file re-runnable.

do $$
begin
  -- The application's read identity (UI, analyst tools). Read-only is
  -- enforced by the role (0022), not by the connection string.
  if not exists (select 1 from pg_roles where rolname = 'funder_ro') then
    create role funder_ro nologin;
  end if;

  -- The admin write identity: writes the five labeling/enrichment tables
  -- (0022), never DDL, never the fact tables.
  if not exists (select 1 from pg_roles where rolname = 'funder_rw') then
    create role funder_rw nologin;
  end if;

  -- The owner the public.* views are re-owned to in a later migration.
  -- NOBYPASSRLS is belt-and-braces: this role must never read past a policy.
  if not exists (select 1 from pg_roles where rolname = 'ofdb_publisher') then
    create role ofdb_publisher nologin nobypassrls;
  end if;
end $$;
