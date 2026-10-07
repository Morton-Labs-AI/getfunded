-- 0019: 'mail' and 'email' are weak role tokens — accept them only as the
-- WHOLE local part.
--
-- Found by the contacts audit on the first real load (2026-08-09). The
-- whole-token allowlist in 0018 treated 'mail' and 'email' like 'grants' or
-- 'scholarship', but they describe a MEDIUM, not a role:
--
--   mail@foundation.org        a desk            -> publish
--   jdoe.email@example.com       J. Doe's mailbox  -> withhold
--                              (Example Family Foundation — the local part is a
--                               person's handle with a medium suffix)
--
-- Every other allowlist token names a function ('grants', 'office',
-- 'director', 'finaid') and stays valid inside a compound, which is what
-- keeps executive.director@ and skadden.foundation@ publishable.
--
-- Demotes exactly 2 of 834 published addresses. Re-running
-- `funderdb contacts sync-part-xv` applies it: the loader's
-- `do update ... where source_record_locator like 'partxv:%'` clause exists
-- precisely so a classifier correction can DOWNGRADE an already-published
-- row. This is that mechanism's first use.

create or replace function internal.is_role_based_email(addr text, contact_name text)
returns boolean
language sql immutable parallel safe
set search_path = ''
as $$
  with f as (
    select pg_catalog.regexp_replace(
             pg_catalog.lower(pg_catalog.split_part(pg_catalog.btrim(addr), '@', 1)),
             '\+.*$', '') as local_raw,
           internal.email_local_flat(addr) as flat
    where internal.email_local_flat(addr) is not null
  )
  select case
    when not exists (select 1 from f) then false
    when (select flat from f) = any (array[
      'na','none','notapplicable','notapplicible','unknown','nil','null',
      'test','email','noemail','nota','n','x','xx','xxx']) then false
    when exists (
      select 1 from f,
        pg_catalog.regexp_split_to_table(
          pg_catalog.regexp_replace(
            pg_catalog.lower(coalesce(contact_name, '')),
            '[^a-z ]', ' ', 'g'), '\s+') as tok
      where pg_catalog.length(tok) >= 4
        and pg_catalog.strpos(f.flat, tok) > 0
    ) then false
    -- Weak tokens: a medium, not a role. Only the whole local part counts.
    when (select local_raw from f) = any (array['mail','email']) then true
    when exists (
      select 1 from f,
        pg_catalog.regexp_split_to_table(f.local_raw, '[._-]') as tok
      where tok = any (array[
        'grants','grant','grantsinfo','grantinfo','grantsadmin','grantadmin',
        'apply','application','applications','foundation','fdn','info',
        'information','contact','contactus','admin','office',
        'inquiries','inquiry','enquiries','enquiry','general','hello','help',
        'support','giving','philanthropy','charity','charitable','scholarship',
        'scholarships','proposals','proposal','trustee','trustees','secretary',
        'treasurer','executivedirector','execdir','director','president',
        'board','staff','team','reception','frontdesk','finaid','donations',
        'main','grantsmanager','programs','program'])
    ) then true
    when (select flat from f) ~
         '^(grants|foundation|scholarship|application|inquir|enquir|philanthrop|frontdesk)'
      then true
    else false
  end
$$;
