-- community_0005: row level security.
--
-- WHY NOW, AND WHY THIS IS NOT 0026_api_hardening's problem.
--
-- The corpus RLS migration is frightening for reasons that are ENTIRELY about
-- internal.*: ENABLE ROW LEVEL SECURITY takes ACCESS EXCLUSIVE on 20 tables
-- including 22M-row filing_officers, and a policy bug returns zero rows on a
-- live public site where "zero rows" and "empty table" are indistinguishable on
-- a seeded branch. NONE of that is true here: this schema is days old and
-- nearly empty. So the two are decoupled, and RLS lands the moment the first
-- member-owned row can exist rather than after a year of them accumulating.
--
-- WHAT GRANTS ALREADY COVER (structurally, and RLS adds nothing to these):
--   the corpus cannot be written; funder_ro cannot name this schema; no member
--   can promote their own trust_tier or un-suspend themselves; append-only
--   tables cannot be rewritten; the invite list cannot be read.
--
-- WHAT GRANTS DO NOT COVER, AND THIS MIGRATION DOES:
--   ROW-LEVEL ISOLATION BETWEEN MEMBERS. community_app is ONE role for every
--   member. Nothing in the grant system stops a missing `where owner_member_id
--   = $me` from returning another member's private list, or a route that trusts
--   a collection_id straight from a request body. That is an ordinary
--   application bug class, and RLS is what makes it structural.
--
-- THE IDENTITY CHANNEL: policies key on community.current_member_id(), which
-- reads current_setting('app.member_id', true) and returns NULL when unset.
-- NULL denies. Forgetting set_config() therefore yields an EMPTY RESULT, never
-- someone else's data — the failure direction is the only acceptable one.
--
-- TWO RLS GOTCHAS, ENCODED RATHER THAN REMEMBERED:
--   * RLS DOES NOT APPLY TO THE TABLE OWNER. These tables are owned by postgres,
--     which is rolbypassrls. Policies guard community_app, which was created
--     NOBYPASSRLS in 0001 precisely so it is bound by them.
--   * VIEWS LAUNDER PAST POLICIES unless security_invoker = true. Every view in
--     0004 sets it.

-- ---------------------------------------------------------------------------
-- Identity and provisioning move behind SECURITY DEFINER.
--
-- This is forced, not stylistic: getViewer() looks a member up BY auth_user_id,
-- which is exactly the moment before app.member_id can possibly be known. Under
-- RLS a direct read would return nothing and sign-in would break for everyone.
-- Provisioning has the same shape — it inserts the very row whose id the policy
-- would test against.
--
-- Both take an auth.users id the caller has already proven by verifying a JWT
-- (lib/supabase/server.ts uses getUser(), never getSession()), and both return
-- profile fields only.
-- ---------------------------------------------------------------------------
create or replace function community.member_by_auth_user(p_auth_user_id uuid)
returns table (
  id           uuid,
  auth_user_id uuid,
  handle       text,
  display_name text,
  roles        text[],
  status       text,
  role         text,
  trust_tier   smallint
)
language sql stable security definer
set search_path = ''
as $$
  select m.id, m.auth_user_id, m.handle, m.display_name, m.roles,
         m.status, m.role, m.trust_tier
  from community.members m
  where m.auth_user_id = p_auth_user_id
    and m.kind = 'human'
    and m.deleted_at is null
  limit 1
$$;

-- The whole of first-sign-in provisioning, atomic and DB-side, so the app
-- cannot get half of it right.
create or replace function community.provision_member(p_auth_user_id uuid, p_email text)
returns table (member_id uuid, status text, is_new boolean)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email  text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_id     uuid;
  v_status text;
  v_new    boolean := false;
begin
  -- The gate, re-checked server-side. Supabase's own dashboard invite UI
  -- creates auth.users rows out of band, so surviving the OTP-request check is
  -- NOT proof this address was ever invited here.
  if not community.may_sign_up(v_email) then
    return;                                  -- zero rows => refused
  end if;

  select m.id, m.status into v_id, v_status
  from community.members m
  where m.auth_user_id = p_auth_user_id;

  if v_id is null then
    insert into community.members (auth_user_id)
    values (p_auth_user_id)
    returning community.members.id, community.members.status into v_id, v_status;
    v_new := true;
  end if;

  -- member_private is the ONLY place an address is stored; community.members
  -- has no email column at all.
  -- ON CONFLICT ON CONSTRAINT, NOT ON (member_id). This is not a style choice.
  -- `member_id` is simultaneously this function's RETURNS TABLE output
  -- parameter and member_private's column, and PL/pgSQL substitutes variables
  -- into the ON CONFLICT INFERENCE clause — so the column form raises
  -- `42702 column reference "member_id" is ambiguous` AT EXECUTION TIME.
  -- CREATE FUNCTION only syntax-checks a plpgsql body, so the migration would
  -- have reported success and every sign-in would then have failed with a
  -- generic "provisioning_failed" redirect. Constraint-name inference takes no
  -- column reference and cannot be ambiguous.
  -- (`status` is the same latent collision against community.members.status —
  -- which is why every reference to it below is qualified. Keep it that way.)
  insert into community.member_private (member_id, email, email_verified_at)
  values (v_id, v_email, pg_catalog.now())
  on conflict on constraint pk_cm_member_private do update
    set email = excluded.email,
        email_verified_at = pg_catalog.now(),
        updated_at = pg_catalog.now();

  perform community.claim_invite(v_email, v_id);

  member_id := v_id;
  status    := v_status;
  is_new    := v_new;
  return next;
end $$;

revoke all on function community.member_by_auth_user(uuid) from public;
revoke all on function community.provision_member(uuid, text) from public;
revoke all on function community.current_member_id() from public;
grant execute on function community.member_by_auth_user(uuid) to community_app;
grant execute on function community.provision_member(uuid, text) to community_app;
grant execute on function community.current_member_id() to community_app, funder_rw;

-- The app never reads an address: viewerEmail() takes it from the verified
-- session, and may_sign_up()/provision_member() read member_private internally
-- as definers. So withdraw the read entirely — a privilege not held cannot be
-- misused by a route bug.
revoke select, insert, update on community.member_private from community_app;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere in the schema. No table is left un-policied, including
-- the ones community_app already has no grants on — defence in depth costs
-- nothing on an empty table and removes "was that one deliberate?" forever.
-- ---------------------------------------------------------------------------
alter table community.members            enable row level security;
alter table community.member_private     enable row level security;
alter table community.invites            enable row level security;
alter table community.allowlist_domains  enable row level security;
alter table community.settings           enable row level security;
alter table community.collections        enable row level security;
alter table community.collection_items   enable row level security;
alter table community.follows            enable row level security;
alter table community.notes              enable row level security;
alter table community.tags               enable row level security;
alter table community.org_tags           enable row level security;

-- member_private, invites, allowlist_domains: RLS ON, ZERO POLICIES. Reachable
-- only through the SECURITY DEFINER functions above. Deliberate.

-- settings: the app reads signup_mode; nothing here is secret.
create policy p_settings_read on community.settings
  for select using (true);

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
-- 'private' members are visible to themselves alone. Non-active members are
-- visible to no one but themselves — a suspended account does not linger in
-- the directory.
create policy p_members_read on community.members
  for select using (
    id = community.current_member_id()
    or (status = 'active' and kind = 'human' and deleted_at is null and (
          visibility = 'public'
          or (visibility = 'members' and community.current_member_id() is not null)))
  );
-- Own profile only. Combined with 0002's column grants (which withhold
-- trust_tier, role, status, kind, handle, invited_by), this is the complete
-- edit surface: your row, your profile columns, nothing else.
create policy p_members_update on community.members
  for update using (id = community.current_member_id())
           with check (id = community.current_member_id());
-- No INSERT and no DELETE policy: rows are born in provision_member() and die
-- as a status, never a DELETE.

-- ---------------------------------------------------------------------------
-- collections
-- ---------------------------------------------------------------------------
-- 'unlisted' is link-only: readable, but never surfaced by a listing query.
-- The distinction between unlisted / members / public is about LISTING and is
-- enforced by the query predicates, not by row access.
create policy p_collections_read on community.collections
  for select using (
    owner_member_id = community.current_member_id()
    or visibility = 'public'
    or (visibility in ('members','unlisted') and community.current_member_id() is not null)
  );
create policy p_collections_insert on community.collections
  for insert with check (owner_member_id = community.current_member_id());
create policy p_collections_update on community.collections
  for update using (owner_member_id = community.current_member_id())
           with check (owner_member_id = community.current_member_id());
create policy p_collections_delete on community.collections
  for delete using (owner_member_id = community.current_member_id());

-- ---------------------------------------------------------------------------
-- collection_items — readability is INHERITED, not restated.
--
-- The EXISTS below is itself filtered by p_collections_read (policies apply to
-- tables referenced inside another table's policy), so "you can see the items
-- iff you can see the list" holds by construction and cannot drift out of sync
-- with the collection rules above.
-- ---------------------------------------------------------------------------
create policy p_ci_read on community.collection_items
  for select using (
    exists (select 1 from community.collections c where c.id = collection_id)
  );
create policy p_ci_insert on community.collection_items
  for insert with check (
    exists (select 1 from community.collections c
             where c.id = collection_id
               and c.owner_member_id = community.current_member_id())
  );
create policy p_ci_update on community.collection_items
  for update using (
    exists (select 1 from community.collections c
             where c.id = collection_id
               and c.owner_member_id = community.current_member_id())
  ) with check (
    exists (select 1 from community.collections c
             where c.id = collection_id
               and c.owner_member_id = community.current_member_id())
  );
create policy p_ci_delete on community.collection_items
  for delete using (
    exists (select 1 from community.collections c
             where c.id = collection_id
               and c.owner_member_id = community.current_member_id())
  );

-- ---------------------------------------------------------------------------
-- follows — the most privacy-sensitive table in the schema.
--
-- Which funders a development director tracks is competitive intelligence about
-- their organization's strategy. Rows are readable ONLY by their owner, unless
-- that member deliberately set follows_public. Follower COUNTS come from
-- community.org_stats() (SECURITY DEFINER, aggregates only) — which is exactly
-- why that function has to exist.
-- ---------------------------------------------------------------------------
create policy p_follows_read on community.follows
  for select using (
    follower_member_id = community.current_member_id()
    or exists (select 1 from community.members m
                where m.id = follower_member_id and m.follows_public)
  );
create policy p_follows_insert on community.follows
  for insert with check (follower_member_id = community.current_member_id());
create policy p_follows_delete on community.follows
  for delete using (follower_member_id = community.current_member_id());
-- Follows are add/remove, never rewrite.
revoke update on community.follows from community_app;

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create policy p_notes_read on community.notes
  for select using (
    author_member_id = community.current_member_id()
    or (redacted_at is null and (
          visibility = 'public'
          or (visibility = 'members' and community.current_member_id() is not null)))
  );
create policy p_notes_insert on community.notes
  for insert with check (author_member_id = community.current_member_id());
create policy p_notes_update on community.notes
  for update using (author_member_id = community.current_member_id())
           with check (author_member_id = community.current_member_id());
-- A member may retract what they wrote — UNLESS a maintainer has already
-- redacted it. Redaction deliberately keeps the row as a tombstone so flags and
-- the audit trail still resolve; letting the author then DELETE it would hand
-- the moderated party a way to erase the record of their own moderation.
create policy p_notes_delete on community.notes
  for delete using (
    author_member_id = community.current_member_id()
    and redacted_at is null
  );

-- ---------------------------------------------------------------------------
-- tags + org_tags — a folksonomy is public by nature. Tagging an organization
-- IS the affirmative public act, so there is no private tier here.
-- ---------------------------------------------------------------------------
create policy p_tags_read on community.tags for select using (true);
create policy p_tags_insert on community.tags
  for insert with check (community.current_member_id() is not null);

create policy p_org_tags_read on community.org_tags for select using (true);
create policy p_org_tags_insert on community.org_tags
  for insert with check (member_id = community.current_member_id());
create policy p_org_tags_delete on community.org_tags
  for delete using (member_id = community.current_member_id());

-- ---------------------------------------------------------------------------
-- THE MAINTAINER PLANE.
--
-- Every policy above is written without a TO clause, so it binds EVERY role —
-- including funder_rw, which is NOBYPASSRLS (verified: rolbypassrls = false).
-- funder_rw holds deliberate grants from 0002 and 0003 (read members, redact a
-- note, rename a tag, manage invites), and enabling RLS without a policy it can
-- satisfy SILENTLY REVOKES ALL OF THEM — every maintainer query returns zero
-- rows rather than an error.
--
-- This is latent rather than live only because funder_rw cannot log in today
-- (rolcanlogin = false). That is exactly the state the Phase-0 operator step
-- changes: ADMIN_DATABASE_URL is supposed to BE funder_rw rather than the
-- superuser it currently is. So the landmine is armed by doing the very thing
-- the plan instructs. Defuse it here, in the migration that laid it.
--
-- These are permissive and OR with the member policies; they do not widen what
-- community_app can see, because community_app is not a member of funder_rw.
-- ---------------------------------------------------------------------------
create policy p_members_maintainer           on community.members           for all to funder_rw using (true) with check (true);
create policy p_member_private_maintainer    on community.member_private    for all to funder_rw using (true) with check (true);
create policy p_invites_maintainer           on community.invites           for all to funder_rw using (true) with check (true);
create policy p_allowlist_maintainer         on community.allowlist_domains for all to funder_rw using (true) with check (true);
create policy p_settings_maintainer          on community.settings          for all to funder_rw using (true) with check (true);
create policy p_collections_maintainer       on community.collections       for all to funder_rw using (true) with check (true);
create policy p_collection_items_maintainer  on community.collection_items  for all to funder_rw using (true) with check (true);
create policy p_follows_maintainer           on community.follows           for all to funder_rw using (true) with check (true);
create policy p_notes_maintainer             on community.notes             for all to funder_rw using (true) with check (true);
create policy p_tags_maintainer              on community.tags              for all to funder_rw using (true) with check (true);
create policy p_org_tags_maintainer          on community.org_tags          for all to funder_rw using (true) with check (true);

-- The curated-tag path 0003 defines had no writer: funder_rw could rename and
-- delete a tag but never create one.
grant insert on community.tags to funder_rw;

-- Dead grant removal: 0001's schema-wide default gave community_app INSERT on
-- community.members, but rows are now born only inside provision_member() and
-- there is deliberately no INSERT policy. Withdraw the privilege so the grant
-- table stops advertising a capability that does not exist.
revoke insert on community.members from community_app;

-- ---------------------------------------------------------------------------
-- CORRECTION to community.claim_invite() (introduced in community_0002).
--
-- The second UPDATE — the one that carries invited_by onto the member — tested
-- only `m.invited_by is null and i.invited_by is not null`, while the first
-- UPDATE correctly checked revoked_at, accepted_at and expires_at. So a REVOKED
-- or EXPIRED invitation still stamped its author onto the member, and a profile
-- would then render "invited by @zach" for a vouch that had been explicitly
-- withdrawn. Revocation is the only lever a maintainer has to take a vouch
-- back; here it withdrew nothing.
--
-- No spoofing is involved — it fires on the ordinary sign-in path whenever
-- someone with a dead invite still gets in via the domain allowlist. And
-- community_app holds no UPDATE grant on members.invited_by, so nothing in the
-- app could correct it afterwards.
--
-- The fix sources invited_by from the invite THIS CALL ACTUALLY ACCEPTED
-- (accepted_by = p_member_id), which makes the two statements consistent by
-- construction rather than by keeping two WHERE clauses in sync by hand.
-- ---------------------------------------------------------------------------
create or replace function community.claim_invite(p_email text, p_member_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  if not community.may_sign_up(v_email) then
    return false;
  end if;

  update community.invites
     set accepted_by = p_member_id,
         accepted_at = pg_catalog.now()
   where email_norm = v_email
     and accepted_at is null
     and revoked_at is null
     and expires_at > pg_catalog.now();

  update community.members m
     set invited_by = i.invited_by
    from community.invites i
   where m.id = p_member_id
     and i.email_norm = v_email
     and i.accepted_by = p_member_id      -- the invite this call just accepted
     and i.revoked_at is null
     and i.expires_at > pg_catalog.now()
     and m.invited_by is null
     and i.invited_by is not null;

  return true;
end $$;

revoke all on function community.claim_invite(text, uuid) from public;
grant execute on function community.claim_invite(text, uuid) to community_app;

-- ---------------------------------------------------------------------------
-- Verification — the decisive probes.
-- ---------------------------------------------------------------------------
--   begin; set local role community_app;
--     select set_config('app.member_id', '<A>', true);
--     select count(*) from community.collections;          -- only A's + shared
--     select count(*) from community.notes
--       where author_member_id = '<B>' and visibility = 'private';   -- MUST be 0
--     select count(*) from community.follows
--       where follower_member_id = '<B>';                  -- MUST be 0
--     -- and the one that proves the definer boundary survived:
--     select followers_n from community.org_stats(array['<org B follows>']::uuid[]);
--                                                          -- MUST be 1, not 0
--     select set_config('app.member_id', '', true);
--     select count(*) from community.collections;          -- MUST be 0 (fail-closed)
--   rollback;
