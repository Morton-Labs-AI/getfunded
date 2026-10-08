-- 0034: a tighter filler-text test for recipient names, a public way to tell
-- which grant rows were linked by filer consensus, and one column that may
-- now be empty.
--
-- Three small changes to the objects of 0027 (recipient aliases, "filers as
-- witnesses"). 0027 is applied, so the changes are made here.
--
-- 1. internal.is_placeholder_recipient, second version. A review on
--    2026-10-08 found filler text the first version lets through: SEE STMT,
--    SEE ADDITIONAL DATA, UNKNOWN, NOT APPLICABLE, ALL OTHERS, CASH GRANTS,
--    GRANTS UNDER 5 000, CONTRIBUTIONS UNDER 1 000, AS PER ATTACHED,
--    AVAILABLE UPON REQUEST. No wrong alias came from them (three filers
--    never agree on one EIN for filler text), but the rule "no alias for
--    filler text" should hold through this function alone.
--
--    Every pattern of the first version is kept as it was; patterns are only
--    added. Checked read only against the organisation names on the live
--    database on 2026-10-08 (5,904 names that start with any word the old or
--    the new patterns start with): the first version flags 13 real
--    organisations of 4 or more characters, this version flags the same 13,
--    and the two versions differ on 0 names.
--
--    One name from the review's list is left out on purpose: OTHERS alone.
--    An organisation with exactly that name is on the live database, so
--    adding it would flag one more real organisation than before. OTHER alone
--    (first version) and ALL OTHER / ALL OTHERS (this version) are flagged.
--
-- 2. public.recipient_alias_links. One row per grant row that was linked by
--    `funderdb resolve aliases --apply` and still carries that link. This is
--    how a reader of the open data tells such a row from a row where the
--    return itself gave the EIN: a grant row whose id is in this view was
--    linked by filer consensus (link_basis = 'filer_consensus'); join
--    alias_id to public.recipient_aliases.id for the evidence (n_filers,
--    status). The 14-million-row grants table and its view are not touched.
--
-- 3. internal.recipient_aliases.top_share may be empty. A later `--build`
--    now refreshes the evidence columns of an alias that already has links.
--    When no filer writes that name and state with any EIN any more, the
--    share has no value; it is stored as NULL, not as 0.
--
-- Nothing in this file changes a grant row or an alias row.

-- Locks, same rule as 0027: this file never waits. The ALTER TABLE needs a
-- brief ACCESS EXCLUSIVE lock on internal.recipient_aliases (a small table
-- that only `resolve aliases` writes). The view takes no lasting lock. If a
-- lock is not free within half a second the whole file fails, nothing is
-- applied, and `funderdb migrate` is run again a little later.
set local lock_timeout = '500ms';

-- ---------------------------------------------------------------------------
-- is_placeholder_recipient, second version. Same signature, same rules for
-- NULL and for names under 4 characters. The input is the output of
-- internal.norm_name: upper case, punctuation turned into spaces, so
-- "Grants under $5,000" arrives as "GRANTS UNDER 5 000".
--
-- Added to the first version:
--   SEE STMT, SEE STMNT, SEE ADDITIONAL (DATA|INFO|SCHEDULE|STATEMENT|LIST|PAGE)
--   AS PER ..., PER STMT
--   ALL OTHER, ALL OTHERS, UNKNOWN, NOT APPLICABLE, CASH GRANT, CASH GRANTS
--     (each only as the whole name)
--   AVAILABLE UPON REQUEST, AVAILABLE ON REQUEST
--   GRANTS / GIFTS / DONATIONS / CONTRIBUTIONS / AMOUNTS, then UNDER,
--     LESS THAN or BELOW, then an amount (same amount shapes as "UNDER 5000")
-- ---------------------------------------------------------------------------
create or replace function internal.is_placeholder_recipient(nn text) returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  select nn is null
      or pg_catalog.length(nn) < 4
      or nn ~ ('^(SEE (ATTACH|STATEMENT|STMT|STMNT|SCHEDULE|LIST|SUPPLEMENT'
               ||    '|ADDITIONAL (DATA|INFO|SCHEDULE|STATEMENT|LIST|PAGE))'
               || '|(AS )?PER (ATTACH|SCHEDULE|LIST|STATEMENT|STMT)'
               || '|VARIOUS'
               || '|MISC(ELLANEOUS)?( |$)'
               || '|N A$|NA$|NONE$|OTHER$|GENERAL$'
               || '|ALL OTHERS?$|UNKNOWN$|NOT APPLICABLE$|CASH GRANTS?$'
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
               || '|AVAILABLE (UPON|ON) REQUEST'
               || '|UNDER (\d{3,}|\d+ ?K|\d{1,3} \d{3})( |$)'
               || '|(GRANTS|GIFTS|DONATIONS|CONTRIBUTIONS|AMOUNTS) (OF )?'
               ||    '(UNDER|LESS THAN|BELOW) (\d{3,}|\d+ ?K|\d{1,3} \d{3})( |$))')
$$;

comment on function internal.is_placeholder_recipient(text) is
  'True when a normalised recipient name (internal.norm_name output) is filler text such as SEE ATTACHED, VARIOUS, UNKNOWN or GRANTS UNDER 5 000, not an organisation name. Null and names under 4 characters are placeholders. Second version (0034): the patterns of 0027 plus the filler text a review found.';

-- ---------------------------------------------------------------------------
-- top_share: n_filers / all filers that wrote the name and state with an EIN
-- we hold. Empty when there are no such filers any more (possible only for an
-- alias that is kept because grant rows are still linked through it).
-- ---------------------------------------------------------------------------
alter table internal.recipient_aliases alter column top_share drop not null;

comment on column internal.recipient_aliases.top_share is
  'n_filers divided by all filers that wrote this name and state with an EIN we hold. NULL when no filer does so any more.';

-- ---------------------------------------------------------------------------
-- public.recipient_alias_links: the publishable projection of the link
-- ledger. A row is shown only when all of these are true:
--   * the grant row still points at the alias's organisation (a link that a
--     later job or a person changed is not ours any more and is left out);
--   * the alias row may be republished (licence filter through its raw file,
--     as in public.recipient_aliases);
--   * the grant row may be republished (the same licence filter that
--     public.funding_events applies), so the view never names a grant row
--     that the public grants view does not show.
--
-- Light by construction: three primary-key probes per link row and two tiny
-- lookup tables. The link ledger has at most one row per linked grant row
-- (about 0.6 million expected), so reading the whole view is one hash join,
-- and looking up the grant rows of one page is a few index probes.
--
-- alias_status is the status at the LAST build, not at the time of the link.
-- When it is no longer 'unanimous' the evidence has changed since the row was
-- linked; the link stays until `resolve aliases --unapply`.
-- ---------------------------------------------------------------------------
create view public.recipient_alias_links as
  select l.event_id, l.alias_id, ra.org_id as recipient_org_id,
         'filer_consensus'::text as link_basis,
         ra.n_filers, ra.status as alias_status, l.linked_at
  from internal.recipient_alias_links l
  join internal.recipient_aliases ra on ra.id = l.alias_id
  join internal.raw_files arf on arf.id = ra.raw_file_id
  join internal.licensing_map alm on alm.license_code = arf.license_code
  join internal.funding_events fe on fe.id = l.event_id
  join internal.raw_files erf on erf.id = fe.raw_file_id
  join internal.licensing_map elm on elm.license_code = erf.license_code
  where alm.republishable
    and elm.republishable
    and fe.recipient_org_id = ra.org_id;

comment on view public.recipient_alias_links is
  'Grant rows (public.funding_events.id = event_id) whose recipient organisation was linked by filer consensus: three or more grant-making charities wrote the same name and state with one EIN, and the city matched. A grant row that is not in this view was not linked this way. Join alias_id to public.recipient_aliases.id for the evidence.';

-- 0024's hygiene, repeated for the new view exactly as 0027 does it: Supabase
-- default privileges hand anon and authenticated ALL on a new public view.
-- SELECT is kept (the view serves only republishable rows); the write-shaped
-- grants go, and MAINTAIN too on Postgres 17 and later. On vanilla Postgres
-- the two roles do not exist and there is nothing to do. The analyst role
-- (the SQL guard's allowlist) is deliberately given nothing here.
do $$
declare
  roles text;
begin
  select string_agg(quote_ident(rolname), ', ') into roles
  from pg_roles where rolname in ('anon', 'authenticated');
  if roles is null then
    raise notice '0034: no anon/authenticated roles in this cluster; nothing to revoke';
    return;
  end if;
  execute format(
    'revoke insert, update, delete, truncate, references, trigger '
    'on public.recipient_alias_links from %s', roles);
  if current_setting('server_version_num')::int >= 170000 then
    execute format('revoke maintain on public.recipient_alias_links from %s', roles);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Check (by hand, read only):
--   select internal.is_placeholder_recipient(internal.norm_name(x)) from (values
--     ('See Stmt.'), ('Grants under $5,000'), ('Unknown'), ('Under 21')) v(x);
--     -- true, true, true, false
--   select count(*) from public.recipient_alias_links;   -- 0 until an apply has run
--
-- Undo (by hand, as the owner, in one transaction):
--   begin;
--   drop view public.recipient_alias_links;
--   -- only when no row has an empty top_share:
--   alter table internal.recipient_aliases alter column top_share set not null;
--   -- then run the `create or replace function internal.is_placeholder_recipient`
--   -- statement of 0027_recipient_aliases.sql again.
--   commit;
-- ---------------------------------------------------------------------------
