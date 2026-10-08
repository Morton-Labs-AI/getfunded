-- 0031: validate the two address constraints that 0030 added as NOT VALID.
--
-- Its own file because `funderdb migrate` runs one transaction per file.
-- 0030 holds an ACCESS EXCLUSIVE lock on internal.organizations until it
-- commits, so a validation inside 0030 would read the whole table (925 MB)
-- while nobody else can read or write it. Here the only lock is SHARE UPDATE
-- EXCLUSIVE: reads, inserts and updates go on during the scan. It conflicts
-- only with other DDL and with VACUUM or ANALYZE of this table.
--
-- Nothing depends on this file. The two rules are enforced for every insert
-- and update from 0030 on; this only lets Postgres record that the old rows
-- pass too (they hold NULL in both columns, so they do). If it fails on a
-- busy database, run `funderdb migrate` again later.
--
-- lock_timeout is longer than in 0030 on purpose: an autovacuum of the table
-- holds the same lock and steps aside after the 1 s deadlock timer, so the
-- wait has to be longer than that. One table only, so there is no second
-- lock to deadlock on. The statement timeout is raised because the session
-- default (2 minutes on the live database) can be too short for one cold
-- read of the table while a load is running.
set local lock_timeout = '10s';
set local statement_timeout = '15min';

-- One statement, so the table is read once for both rules.
alter table internal.organizations
  validate constraint ck_orgs_address_basis,
  validate constraint ck_orgs_address_pair;

-- Check (by hand, read only):
--   select conname, convalidated from pg_constraint
--    where conrelid = 'internal.organizations'::regclass
--      and conname like 'ck_orgs_address%';     -- two rows, both true
