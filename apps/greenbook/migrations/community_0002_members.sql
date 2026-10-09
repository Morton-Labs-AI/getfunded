-- community_0002: members, private contact, invites, settings.
--
-- TWO ARCHETYPES, ONE TABLE. The open-source data contributor and the nonprofit
-- development director are the same row with different optional blocks filled
-- in. `roles` is an ARRAY, not a single-choice column, because a development
-- director who writes Python is BOTH, and a radio button forces a lie that then
-- drives the directory facets.
--
-- EMAIL IS NOT IN THIS TABLE. Not withheld — ABSENT. A column that does not
-- exist cannot be leaked by a future grant mistake. The convenience copy lives
-- in community.member_private behind a column-list grant; the source of record
-- is auth.users, which no app role can reach.
--
-- tenant_id defaults 'ofdb' on every table in this schema: one community today,
-- keyed tomorrow (a gated per-partner space, or an RLS key) without a rewrite.

-- ---------------------------------------------------------------------------
-- settings: workspace configuration that must be changeable without a deploy.
-- signup_mode is read by community.may_sign_up(); COMMUNITY_MODE in the app
-- controls PRESENTATION (badge, robots), this controls WHO GETS IN.
-- ---------------------------------------------------------------------------
create table community.settings (
  key        text        constraint pk_cm_settings primary key,
  tenant_id  text        not null default 'ofdb',
  value      jsonb       not null,
  updated_by text,
  updated_at timestamptz not null default now()
);
revoke all on community.settings from community_app;
grant select on community.settings to community_app;
grant select, insert, update, delete on community.settings to funder_rw;

insert into community.settings (key, value, updated_by) values
  ('signup_mode', '"invite"'::jsonb, 'migration:community_0002'),
  ('tos_version', '"2026-09-05"'::jsonb, 'migration:community_0002')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create table community.members (
  id                     uuid        constraint pk_cm_members primary key default gen_random_uuid(),
  tenant_id              text        not null default 'ofdb',
  -- Supabase Auth hook. Nullable so an invite row or a pipeline/system row can
  -- exist without a login. dnw.users.auth_user_id is the precedent, left
  -- deliberately unused there for exactly this moment.
  auth_user_id           uuid        constraint uq_cm_members_auth unique,
  kind                   text        not null default 'human'
                         constraint ck_cm_members_kind check (kind in ('human','pipeline','system')),
  -- NULLABLE until onboarding. Provisioning (the auth callback) creates the row
  -- before the person has chosen a handle; community.activate_member() sets it
  -- once, and nothing can change it afterwards.
  handle                 text
                         constraint ck_cm_members_handle_lower check (handle = lower(handle))
                         constraint ck_cm_members_handle_shape check (handle ~ '^[a-z0-9][a-z0-9_-]{1,38}$'),
  display_name           text,
  -- ---- shared profile ----
  bio                    text        constraint ck_cm_members_bio check (length(bio) <= 2000),
  website_url            text,
  location_city          text,
  location_state         text,
  roles                  text[]      not null default '{}'
                         constraint ck_cm_members_roles check (
                           roles <@ array['developer','data_contributor','researcher',
                                          'fundraiser','program_officer','nonprofit_staff',
                                          'funder_staff','consultant','journalist',
                                          'student','other']::text[]),
  -- ---- practitioner block (development director / program officer) ----
  job_title              text,
  -- SOFT corpus ref, NO foreign key: the corpus re-ingests and rewrites rows,
  -- and a cross-schema FK would either block the pipeline (RESTRICT) or destroy
  -- member data (CASCADE). dnw_0004's doctrine. Snapshot travels with it.
  org_affiliation_org_id uuid,
  org_affiliation_name   text,
  org_affiliation_ein    text,
  org_affiliation_city   text,
  org_affiliation_state  text,
  years_in_field         smallint    constraint ck_cm_members_years check (years_in_field between 0 and 70),
  focus_areas            text[]      not null default '{}',
  geographic_focus       text[]      not null default '{}',
  -- ---- developer block ----
  github_login           text        constraint uq_cm_members_github unique,
  -- ---- directory + privacy ----
  visibility             text        not null default 'members'
                         constraint ck_cm_members_visibility check (visibility in ('private','members','public')),
  -- FALSE, and this is the most consequential default in the schema. Which
  -- funders a development director follows is competitive intelligence about
  -- their organization's strategy. Public-by-default here is unrecoverable.
  follows_public         boolean     not null default false,
  listed_in_directory    boolean     not null default true,
  attribution_opt_out    boolean     not null default false,
  -- ---- trust + moderation (maintainer-owned) ----
  trust_tier             smallint    not null default 0
                         constraint ck_cm_members_tier check (trust_tier between 0 and 3),
  role                   text        not null default 'member'
                         constraint ck_cm_members_role check (role in ('member','maintainer')),
  status                 text        not null default 'invited'
                         constraint ck_cm_members_status check (status in
                           ('invited','active','suspended','banned','deleted')),
  invited_by             uuid        constraint fk_cm_members_inviter references community.members(id),
  -- ---- licensing / terms ----
  license_grant          text        constraint ck_cm_members_license check (license_grant in ('cc0_contributor')),
  license_granted_at     timestamptz,
  tos_version            text,
  last_seen_at           timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- NULLs are distinct in a unique constraint, so many un-onboarded rows coexist.
  constraint uq_cm_members_handle unique (tenant_id, handle),
  -- Route segments that would collide with a real page. Structural, not a
  -- lint rule: /members/me must never resolve to a person.
  constraint ck_cm_members_handle_reserved check (
    handle is null or handle not in (
      'me','new','edit','settings','admin','review','api','auth','sign-in','sign-out',
      'onboarding','members','member','collections','collection','contributions',
      'org','person','filing','filings','programs','program','data','browse','search',
      'about','help','support','root','system','null','undefined','static','public')),
  -- An active human is COMPLETE: has a handle, has granted CC0, has accepted a
  -- ToS version. Makes "half-onboarded but participating" unrepresentable.
  constraint ck_cm_members_active_complete check (
    kind <> 'human' or status <> 'active'
    or (handle is not null and license_granted_at is not null
        and license_grant is not null and tos_version is not null))
);
create index ix_cm_members_active on community.members (status) where status = 'active';
create index ix_cm_members_roles  on community.members using gin (roles);
create index ix_cm_members_focus  on community.members using gin (focus_areas);
create index ix_cm_members_affil  on community.members (org_affiliation_org_id)
  where org_affiliation_org_id is not null;
create trigger trg_cm_members_updated before update on community.members
  for each row execute function community.set_updated_at();

-- SELF-PROMOTION IS UNREPRESENTABLE, not merely discouraged. The schema's
-- default privilege granted a TABLE-level UPDATE at CREATE TABLE; revoke it
-- and re-grant only the profile columns. trust_tier, role, status, kind,
-- handle, invited_by and license_granted_at are NOT in this list, so no route
-- bug can escalate a member — the privilege simply is not held.
revoke update on community.members from community_app;
grant update (display_name, bio, website_url, location_city, location_state,
              roles, job_title, org_affiliation_org_id, org_affiliation_name,
              org_affiliation_ein, org_affiliation_city, org_affiliation_state,
              years_in_field, focus_areas, geographic_focus, github_login,
              visibility, follows_public, listed_in_directory,
              attribution_opt_out, last_seen_at, updated_at)
  on community.members to community_app;
-- Deletion is a status, never a DELETE: contributions are attributed and the
-- audit log references the row.
revoke delete on community.members from community_app;

grant select on community.members to funder_rw;
grant update (handle, trust_tier, role, status, kind, deleted_at, updated_at)
  on community.members to funder_rw;

-- ---------------------------------------------------------------------------
-- member_private: the only place an address lives in this database.
-- ---------------------------------------------------------------------------
create table community.member_private (
  member_id         uuid        constraint pk_cm_member_private primary key
                    constraint fk_cm_mp_member references community.members(id) on delete cascade,
  tenant_id         text        not null default 'ofdb',
  email             text,                      -- convenience copy; auth.users is source of record
  email_verified_at timestamptz,
  notify_by_email   boolean     not null default true,
  signup_ip_hash    text,                      -- purged at 90 days (community_0005)
  last_ip_hash      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger trg_cm_member_private_updated before update on community.member_private
  for each row execute function community.set_updated_at();

-- The schema default privilege gave community_app table-level SELECT/UPDATE
-- here at CREATE TABLE. Revoke the TABLE grant and enumerate: a column-level
-- revoke against a table-level grant is a NO-OP (see community_0001).
revoke select, update, delete on community.member_private from community_app;
grant select (member_id, email, email_verified_at, notify_by_email)
  on community.member_private to community_app;
grant update (email, email_verified_at, notify_by_email, last_ip_hash, updated_at)
  on community.member_private to community_app;
-- signup_ip_hash is in NEITHER list. funder_ro holds nothing in this schema at
-- all, so the analyst pool cannot even name this table; the column list is the
-- second line of defence, not the first.
grant select on community.member_private to funder_rw;

-- ---------------------------------------------------------------------------
-- invites + allowlist_domains: the phase-1 posture.
--
-- community_app gets NO SELECT on either. It calls the security-definer
-- predicates below instead, so no community page can render an invite list —
-- or enumerate who was invited and has not yet joined — even by accident.
-- ---------------------------------------------------------------------------
create table community.invites (
  id          uuid        constraint pk_cm_invites primary key default gen_random_uuid(),
  tenant_id   text        not null default 'ofdb',
  email       text        not null,
  email_norm  text        not null generated always as (lower(btrim(email))) stored,
  note        text,
  invited_by  uuid        constraint fk_cm_invites_inviter references community.members(id),
  accepted_by uuid        constraint fk_cm_invites_member references community.members(id),
  accepted_at timestamptz,
  revoked_at  timestamptz,
  expires_at  timestamptz not null default now() + interval '30 days',
  created_at  timestamptz not null default now(),
  constraint uq_cm_invites_email unique (tenant_id, email_norm)
);
revoke all on community.invites from community_app;
grant select, insert, update, delete on community.invites to funder_rw;

create table community.allowlist_domains (
  domain     text        constraint pk_cm_allowlist primary key,
  tenant_id  text        not null default 'ofdb',
  note       text,
  added_by   uuid        constraint fk_cm_allowlist_member references community.members(id),
  created_at timestamptz not null default now()
);
revoke all on community.allowlist_domains from community_app;
grant select, insert, delete on community.allowlist_domains to funder_rw;

-- ---------------------------------------------------------------------------
-- The three doors. All security definer, all search_path = '', all revoked
-- from public — a definer function reachable by PUBLIC is the classic
-- privilege-escalation shape, and revoking it costs nothing.
-- ---------------------------------------------------------------------------

-- 1. PURE PREDICATE, no side effects. The OTP-request path calls this and then
--    returns the SAME generic "check your email" either way. Never branch the
--    user-visible message on the result: that is account enumeration.
create or replace function community.may_sign_up(p_email text) returns boolean
language plpgsql security definer stable
set search_path = ''
as $$
declare
  v_mode  text;
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
begin
  select s.value #>> '{}' into v_mode from community.settings s where s.key = 'signup_mode';
  v_mode := coalesce(v_mode, 'invite');

  if v_mode = 'open' then
    return true;
  end if;

  -- An already-active member always gets back in, invite consumed or not.
  if exists (
       select 1 from community.member_private mp
       join community.members m on m.id = mp.member_id
       where pg_catalog.lower(pg_catalog.btrim(mp.email)) = v_email
         and m.status = 'active')
  then
    return true;
  end if;

  if exists (
       select 1 from community.invites i
       where i.email_norm = v_email
         and i.revoked_at is null
         and i.expires_at > pg_catalog.now())
  then
    return true;
  end if;

  if v_mode = 'allowlist' and exists (
       select 1 from community.allowlist_domains d
       where d.domain = pg_catalog.split_part(v_email, '@', 2))
  then
    return true;
  end if;

  return false;
end $$;

-- 2. SIDE-EFFECTING. The auth-callback path calls this AFTER the code
--    exchange, to bind the invite to the member row it just provisioned.
create or replace function community.claim_invite(p_email text, p_member_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_ok    boolean := false;
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

  -- Carry the invite chain onto the member: "invited by @zach" is a real trust
  -- signal in an allowlist community.
  update community.members m
     set invited_by = i.invited_by
    from community.invites i
   where m.id = p_member_id
     and i.email_norm = v_email
     and m.invited_by is null
     and i.invited_by is not null;

  return true;
end $$;

-- 3. THE ONE LEGAL SELF-TRANSITION. Onboarding must take a member from
--    'invited' to 'active', but community_app holds no UPDATE grant on status,
--    handle, or license_granted_at — deliberately, so nothing can un-suspend or
--    self-promote. This definer function is the single narrow exception, and
--    `and status = 'invited'` is the whole security property: it runs once, it
--    is one-way, and a suspended or banned member cannot call it to come back.
create or replace function community.activate_member(
  p_member_id   uuid,
  p_handle      text,
  p_display_name text,
  p_tos_version text
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_ok boolean := false;
begin
  update community.members
     set handle             = pg_catalog.lower(pg_catalog.btrim(p_handle)),
         display_name       = p_display_name,
         status             = 'active',
         license_grant      = 'cc0_contributor',
         license_granted_at = pg_catalog.now(),
         tos_version        = p_tos_version,
         updated_at         = pg_catalog.now()
   where id = p_member_id
     and status = 'invited'
     and kind = 'human'
   returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

revoke all on function community.may_sign_up(text) from public;
revoke all on function community.claim_invite(text, uuid) from public;
revoke all on function community.activate_member(uuid, text, text, text) from public;
grant execute on function community.may_sign_up(text) to community_app;
grant execute on function community.claim_invite(text, uuid) to community_app;
grant execute on function community.activate_member(uuid, text, text, text) to community_app;
grant execute on function community.may_sign_up(text) to funder_rw;

-- ---------------------------------------------------------------------------
-- Verification (run by hand).
-- ---------------------------------------------------------------------------
--   begin; set local role community_app;
--     insert into community.members (auth_user_id) values (gen_random_uuid())
--       returning id;                                              -- ok (no handle yet)
--     update community.members set trust_tier = 3;                 -- MUST fail (no column grant)
--     update community.members set status = 'active';              -- MUST fail (no column grant)
--     update community.members set handle = 'x';                   -- MUST fail (no column grant)
--     update community.members set bio = 'hello';                  -- ok
--     delete from community.members;                               -- MUST fail
--     select * from community.invites;                             -- MUST fail
--     select * from community.allowlist_domains;                   -- MUST fail
--     select signup_ip_hash from community.member_private;         -- MUST fail
--     select email from community.member_private;                  -- ok
--     select community.may_sign_up('nobody@example.com');          -- ok, returns false
--   rollback;
--
--   -- The reserved-handle guard and the completeness guard:
--   begin;
--     insert into community.members (handle) values ('me');        -- MUST fail
--     insert into community.members (handle, status) values ('a','active'); -- MUST fail
--   rollback;
