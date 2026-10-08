-- 0027: recipient aliases ("filers as witnesses").
--
-- Why. A foundation's return (Form 990-PF) names each grant recipient but
-- gives no ID number. A grant-making charity's return (Form 990, Schedule I)
-- writes the recipient's EIN next to the name. When several different
-- charities wrote the same name and state with ONE EIN, that is public,
-- filer-stated evidence of which organisation the name means. This file adds
-- the place to keep that evidence (one row per name + state) and a ledger of
-- the grant rows that were linked because of it (one row per changed grant
-- row, so the work can be undone exactly).
--
-- Nothing in this file changes a grant row. `funderdb resolve aliases --build`
-- fills internal.recipient_aliases. `--apply` links 990-PF grant rows of the
-- strict class only (status 'unanimous', 3 or more filers, and the city on
-- the grant row is a city those filers wrote or the organisation's own city)
-- and writes internal.recipient_alias_links. `--unapply` removes those links.
-- No recipient name is rewritten and no amount changes.
--
-- Measured on the live database on 2026-10-08, read only. The numbers are
-- SCALED FROM THREE NAME SLICES (158,730 grant rows, 1.16% of the table), so
-- they are estimates until `resolve aliases --report` prints the real ones:
--   * slices HEA + ST M: 242 strict keys and 4,309 rows the strict rule links;
--   * a third slice (BRO + LIB + PEA): 125 strict keys and 2,912 rows;
--   * together 7,221 rows, 10.5% of the unlinked 990-PF rows in those slices;
--   * scaled: about 0.6 million rows (accept 0.45 to 0.8 million), about
--     32,000 strict keys, about 100,000 stored alias rows in all classes.
-- No person has labelled these links yet. A reading of about 100 of the
-- largest strict aliases found no wrong organisation and about 7% that point
-- at a parent body (a school's row linked to its parish or church).
--
-- Known defect in the older name matcher, recorded here because the alias
-- build leans on its table: internal.recipient_matches.confidence is type
-- `real`, so tier3's 0.90 is stored as 0.8999999762, and the apply filter
-- `rm.confidence >= 0.90` in resolve/recipients.py was false for every tier3
-- match (0 of 93,780 passed). About 0.89 million unlinked 990-PF rows and
-- about 22,000 Schedule I rows carry a tier3 key and were never linked. The
-- alias build drops every key that is in recipient_matches, so those rows
-- stay unlinked both ways. The Python fix makes tier3 an explicit choice
-- (`resolve recipients --max-tier 3`); the alias report prints how tier3
-- agrees with the filers so the choice can be made on evidence.

-- Locks. The foreign keys below need a brief SHARE ROW EXCLUSIVE lock on
-- internal.organizations, internal.raw_files and internal.funding_events. A
-- load that is writing to those tables holds a conflicting lock for minutes,
-- and a migration that WAITS for one table while it already holds another can
-- deadlock with that load; Postgres then cancels one of the two, and it may
-- be the load. So this file never waits: if a lock is not free within half a
-- second (shorter than the 1 s deadlock timer) the whole file fails, nothing
-- is applied, and `funderdb migrate` is simply run again a little later.
set local lock_timeout = '500ms';

-- ---------------------------------------------------------------------------
-- is_placeholder_recipient: true when a NORMALISED recipient name (the output
-- of internal.norm_name) is not a name at all: "SEE ATTACHED", "VARIOUS",
-- "UNDER 5000". Same shape as internal.norm_name in 0009.
--
-- The pattern is anchored and narrow on purpose. Filers do write an EIN next
-- to "VARIOUS" or "OTHER", so a filter is needed; but a loose prefix list
-- ("PER ", "UNDER ", "GENERAL", "SCHOLARSHIP", "MULTIPLE") also catches real
-- organisations (measured on the live rows: a workforce charity whose name
-- starts "PER", a youth shelter named "UNDER 21", a housing charity named
-- "UNDER 1 ROOF", charities whose names start "ATTACHMENT" or "ATTACH",
-- multiple-sclerosis societies, general alumni associations, scholarship
-- funds). Those must never be called placeholders. So "UNDER" needs an
-- amount after it ("UNDER 5000", "UNDER 5K"), and "ATTACHMENT" needs a
-- letter or a number after it ("ATTACHMENT A", "ATTACHMENT 6").
-- ---------------------------------------------------------------------------
create or replace function internal.is_placeholder_recipient(nn text) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select nn is null
      or pg_catalog.length(nn) < 4
      or nn ~ ('^(SEE (ATTACH|STATEMENT|SCHEDULE|LIST|SUPPLEMENT)'
               || '|PER (ATTACH|SCHEDULE|LIST|STATEMENT)'
               || '|VARIOUS'
               || '|MISC(ELLANEOUS)?( |$)'
               || '|N A$|NA$|NONE$|OTHER$|GENERAL$'
               || '|SCHEDULE( |$)'
               || '|ATTACH(ED|MENT)?$'
               || '|ATTACHED (LIST|SCH|STATEMENT|SUPPLEMENT)'
               || '|ATTACHMENT ([A-Z]|\d+)( |$)'
               || '|STATEMENT( \d|$)'
               || '|ANONYMOUS( DONOR)?$'
               || '|INDIVIDUALS?$'
               || '|SCHOLARSHIPS?$'
               || '|SUNDRY'
               || '|MULTIPLE (RECIPIENT|GRANT|CHARIT|ORGANIZATION)'
               || '|UNDER (\d{3,}|\d+ ?K|\d{1,3} \d{3})( |$))')
$$;

comment on function internal.is_placeholder_recipient(text) is
  'True when a normalised recipient name (internal.norm_name output) is filler text such as SEE ATTACHED or VARIOUS, not an organisation name. Null and names under 4 characters are placeholders.';

-- ---------------------------------------------------------------------------
-- recipient_aliases: one row per (normalised name, state) that two or more
-- Schedule I filers wrote next to an EIN we hold. Our own compilation of
-- public-domain rows (licence cc_by through raw_file_id, like
-- recipient_matches).
--
--   status 'unanimous'  every filer that wrote an EIN we hold wrote the same
--                       one, and fewer than half as many filers wrote the
--                       name with no EIN we hold (n_unlinked_filers * 2 <
--                       n_filers). The only class `--apply` may use.
--   status 'dominant'   more than one EIN was written; the top one has 5 or
--                       more filers and 95% or more of all filers. Stored,
--                       never applied.
--   status 'contested'  everything else with 2 or more filers. Stored, never
--                       applied.
--
-- target_* are counts taken at build time of the unlinked 990-PF grant rows
-- that carry this name and state; "city_ok" means the row's city is in
-- witness_cities. They let `--report` run in seconds without reading the
-- grants table again.
-- ---------------------------------------------------------------------------
create table internal.recipient_aliases (
  id          bigint generated always as identity
              constraint pk_recipient_aliases primary key,
  recipient_name_normalized text not null,
  recipient_state text not null,
  org_id      uuid not null
              constraint fk_recipient_aliases_org references internal.organizations(id),
  n_filers    int not null,            -- distinct filers that wrote this name + state with org_id's EIN
  n_rows      int not null,            -- their Schedule I grant rows
  n_orgs_seen smallint not null,       -- distinct organisations filers attached to this name + state
  top_share   real not null,           -- n_filers / all filers that wrote an EIN we hold
  n_unlinked_filers int not null default 0,  -- filers of Schedule I rows with this name + state and no EIN we hold
  witness_cities text[] not null default '{}',  -- normalised cities the filers wrote, plus the organisation's own
  first_fy    smallint,
  last_fy     smallint,
  status      text not null
              constraint ck_recipient_aliases_status
              check (status in ('unanimous','dominant','contested')),
  target_rows           int,
  target_rows_city_ok   int,
  target_amount_city_ok numeric(18,2),
  raw_file_id bigint not null
              constraint fk_recipient_aliases_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_recipient_aliases unique (recipient_name_normalized, recipient_state)
);

create index ix_recipient_aliases_org on internal.recipient_aliases (org_id);

create trigger trg_recipient_aliases_updated_at before update on internal.recipient_aliases
  for each row execute function internal.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- recipient_alias_links: the undo ledger. One row per grant row whose
-- recipient_org_id was set by `resolve aliases --apply`. The cascade keeps it
-- clean when an amended return replaces a filing and its grant rows go.
-- ---------------------------------------------------------------------------
create table internal.recipient_alias_links (
  event_id  uuid
            constraint pk_recipient_alias_links primary key
            constraint fk_recipient_alias_links_event
            references internal.funding_events(id) on delete cascade,
  alias_id  bigint not null
            constraint fk_recipient_alias_links_alias references internal.recipient_aliases(id),
  linked_at timestamptz not null default now()
);

create index ix_recipient_alias_links_alias on internal.recipient_alias_links (alias_id);

-- ---------------------------------------------------------------------------
-- public.recipient_aliases: the publishable projection. n_filers and status
-- are what a page needs to explain a link ("matched because N grant-making
-- charities wrote this name with this organisation's EIN"). raw_file_id is
-- left out; the licence filter is the same as every other public view.
-- ---------------------------------------------------------------------------
create view public.recipient_aliases as
  select ra.id, ra.recipient_name_normalized, ra.recipient_state, ra.org_id,
         ra.n_filers, ra.n_rows, ra.n_orgs_seen, ra.top_share, ra.n_unlinked_filers,
         ra.witness_cities, ra.first_fy, ra.last_fy, ra.status,
         ra.target_rows, ra.target_rows_city_ok, ra.target_amount_city_ok,
         rf.dataset_name as source_dataset, lm.license_code,
         ra.source_record_locator, ra.created_at, ra.updated_at
  from internal.recipient_aliases ra
  join internal.raw_files rf on rf.id = ra.raw_file_id
  join internal.licensing_map lm on lm.license_code = rf.license_code
  where lm.republishable;

-- 0024's hygiene, repeated for the new view as 0024 requires: Supabase default
-- privileges hand anon and authenticated ALL on a new public view. SELECT is
-- kept (the view serves only republishable rows); the write-shaped grants go.
-- On vanilla Postgres the two roles do not exist and there is nothing to do.
-- The analyst role (the SQL guard's allowlist) is deliberately given nothing here.
--
-- MAINTAIN is revoked too. It is a privilege new in Postgres 17, the default
-- privileges hand it out with the rest, and 0024's list predates it (checked
-- 2026-10-08: anon and authenticated still hold it on the 14 older views; that
-- is a separate clean-up). The keyword does not exist before 17, hence the
-- version test.
do $$
declare
  roles text;
begin
  select string_agg(quote_ident(rolname), ', ') into roles
  from pg_roles where rolname in ('anon', 'authenticated');
  if roles is null then
    raise notice '0027: no anon/authenticated roles in this cluster; nothing to revoke';
    return;
  end if;
  execute format(
    'revoke insert, update, delete, truncate, references, trigger '
    'on public.recipient_aliases from %s', roles);
  if current_setting('server_version_num')::int >= 170000 then
    execute format('revoke maintain on public.recipient_aliases from %s', roles);
  end if;
end $$;
