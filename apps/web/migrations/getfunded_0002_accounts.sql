-- getfunded_0002: accounts and plans.
--
-- users, workspaces, members, invites, subscriptions, api_keys, plus the two
-- doors that cross RLS on purpose: provision_user() (first sign-in) and
-- accept_invite() (join by bearer token).
--
-- Rows in users and workspaces are born only inside provision_user(): the app
-- holds no INSERT grant on either. Plan state is never written by the app
-- directly either (no UPDATE grant on workspaces.plan / billing_anchor_day;
-- subscriptions has no app INSERT/UPDATE grant): it flows through the Stripe
-- webhook door getfunded.apply_subscription() in getfunded_0008. Likewise API
-- key authentication (no signed-in user) goes through getfunded.verify_api_key()
-- in 0008; here the app may only manage keys as a workspace admin.

-- ---------------------------------------------------------------------------
-- users: one row per Supabase Auth user. id = auth.users.id.
-- ---------------------------------------------------------------------------
create table if not exists getfunded.users (
  id           uuid        primary key,
  email        citext      not null unique,
  display_name text,
  last_seen_at timestamptz,
  is_steward   boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1
);

-- The FK to auth.users exists wherever Supabase Auth exists (and in the test
-- harness, which stubs it). A vanilla Postgres without an auth schema still
-- replays cleanly.
do $$
begin
  if to_regclass('auth.users') is not null and not exists (
    select 1 from pg_constraint where conname = 'fk_getfunded_users_auth'
  ) then
    alter table getfunded.users
      add constraint fk_getfunded_users_auth
      foreign key (id) references auth.users(id) on delete cascade;
  elsif to_regclass('auth.users') is null then
    raise notice 'getfunded_0002: auth.users not found; users.id is unconstrained';
  end if;
end $$;

drop trigger if exists trg_users_updated on getfunded.users;
create trigger trg_users_updated before update on getfunded.users
  for each row execute function getfunded.set_updated_at();

alter table getfunded.users enable row level security;
alter table getfunded.users force row level security;

-- ---------------------------------------------------------------------------
-- workspaces
-- ---------------------------------------------------------------------------
create table if not exists getfunded.workspaces (
  id                 uuid        primary key default gen_random_uuid(),
  slug               citext      not null unique,
  name               text        not null,
  plan               text        not null default 'free'
                     constraint ck_workspaces_plan
                     check (plan in ('free', 'starter', 'pro', 'team', 'enterprise', 'unlimited')),
  billing_anchor_day smallint    not null default 1
                     constraint ck_workspaces_anchor check (billing_anchor_day between 1 and 31),
  stripe_customer_id text        unique,
  profile            jsonb       not null default '{}'::jsonb
                     constraint ck_workspaces_profile check (jsonb_typeof(profile) = 'object'),
  settings           jsonb       not null default '{}'::jsonb
                     constraint ck_workspaces_settings check (jsonb_typeof(settings) = 'object'),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  version            int         not null default 1,
  constraint ck_workspaces_slug check (length(slug) between 1 and 80 and slug ~ '^[a-z0-9][a-z0-9-]*$')
);

drop trigger if exists trg_workspaces_updated on getfunded.workspaces;
create trigger trg_workspaces_updated before update on getfunded.workspaces
  for each row execute function getfunded.set_updated_at();

alter table getfunded.workspaces enable row level security;
alter table getfunded.workspaces force row level security;

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create table if not exists getfunded.members (
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  user_id      uuid        not null references getfunded.users(id) on delete cascade,
  role         text        not null default 'member'
               constraint ck_members_role check (role in ('owner', 'admin', 'member')),
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1,
  primary key (workspace_id, user_id)
);
create index if not exists ix_members_user on getfunded.members (user_id);

drop trigger if exists trg_members_updated on getfunded.members;
create trigger trg_members_updated before update on getfunded.members
  for each row execute function getfunded.set_updated_at();

alter table getfunded.members enable row level security;
alter table getfunded.members force row level security;

-- ---------------------------------------------------------------------------
-- invites: token shown once, stored hashed (getfunded.hash_token).
-- ---------------------------------------------------------------------------
create table if not exists getfunded.invites (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  email        citext      not null,
  role         text        not null default 'member'
               constraint ck_invites_role check (role in ('admin', 'member')),
  token_hash   text        not null unique,
  expires_at   timestamptz not null default now() + interval '7 days',
  accepted_at  timestamptz,
  invited_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1
);
create index if not exists ix_invites_workspace on getfunded.invites (workspace_id);

drop trigger if exists trg_invites_updated on getfunded.invites;
create trigger trg_invites_updated before update on getfunded.invites
  for each row execute function getfunded.set_updated_at();

alter table getfunded.invites enable row level security;
alter table getfunded.invites force row level security;

-- ---------------------------------------------------------------------------
-- subscriptions: written only by the Stripe webhook handler (0008's door).
-- ---------------------------------------------------------------------------
create table if not exists getfunded.subscriptions (
  workspace_id           uuid        primary key references getfunded.workspaces(id) on delete cascade,
  stripe_subscription_id text        unique,
  plan                   text        not null
                         constraint ck_subscriptions_plan
                         check (plan in ('free', 'starter', 'pro', 'team', 'enterprise', 'unlimited')),
  status                 text        not null
                         constraint ck_subscriptions_status
                         check (status in ('trialing', 'active', 'past_due', 'canceled', 'unpaid')),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean     not null default false,
  raw                    jsonb       not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  version                int         not null default 1
);

drop trigger if exists trg_subscriptions_updated on getfunded.subscriptions;
create trigger trg_subscriptions_updated before update on getfunded.subscriptions
  for each row execute function getfunded.set_updated_at();

alter table getfunded.subscriptions enable row level security;
alter table getfunded.subscriptions force row level security;

-- ---------------------------------------------------------------------------
-- api_keys: Team and above; plaintext shown once, key_hash = hash_token(key).
-- ---------------------------------------------------------------------------
create table if not exists getfunded.api_keys (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  name         text        not null,
  key_prefix   text        not null,
  key_hash     text        not null unique,
  scopes       text[]      not null default '{read}',
  created_by   uuid        references getfunded.users(id) on delete set null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1
);
create index if not exists ix_api_keys_workspace on getfunded.api_keys (workspace_id);

drop trigger if exists trg_api_keys_updated on getfunded.api_keys;
create trigger trg_api_keys_updated before update on getfunded.api_keys
  for each row execute function getfunded.set_updated_at();

alter table getfunded.api_keys enable row level security;
alter table getfunded.api_keys force row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
-- users: your own row, and the rows of people who share a workspace with you.
drop policy if exists p_users_select on getfunded.users;
create policy p_users_select on getfunded.users for select using (
  id = getfunded.current_user_id()
  or getfunded.is_steward()
  or exists (
    select 1 from getfunded.members m
    where m.user_id = users.id and getfunded.is_member(m.workspace_id)
  )
);
drop policy if exists p_users_update on getfunded.users;
create policy p_users_update on getfunded.users for update
  using (id = getfunded.current_user_id())
  with check (id = getfunded.current_user_id());
-- No INSERT or DELETE policy: rows are born in provision_user().

-- workspaces: members read; admins update; nobody inserts or deletes directly.
drop policy if exists p_workspaces_select on getfunded.workspaces;
create policy p_workspaces_select on getfunded.workspaces for select using (
  getfunded.is_member(id) or getfunded.is_steward()
);
drop policy if exists p_workspaces_update on getfunded.workspaces;
create policy p_workspaces_update on getfunded.workspaces for update
  using (getfunded.is_admin(id))
  with check (getfunded.is_admin(id));

-- members: members read; admins manage; a member may remove themself.
drop policy if exists p_members_select on getfunded.members;
create policy p_members_select on getfunded.members for select using (
  getfunded.is_member(workspace_id) or getfunded.is_steward()
);
drop policy if exists p_members_insert on getfunded.members;
create policy p_members_insert on getfunded.members for insert
  with check (getfunded.is_admin(workspace_id));
drop policy if exists p_members_update on getfunded.members;
create policy p_members_update on getfunded.members for update
  using (getfunded.is_admin(workspace_id))
  with check (getfunded.is_admin(workspace_id));
drop policy if exists p_members_delete on getfunded.members;
create policy p_members_delete on getfunded.members for delete using (
  getfunded.is_admin(workspace_id) or user_id = getfunded.current_user_id()
);

-- invites: admins only. Acceptance goes through accept_invite().
drop policy if exists p_invites_select on getfunded.invites;
create policy p_invites_select on getfunded.invites for select
  using (getfunded.is_admin(workspace_id));
drop policy if exists p_invites_insert on getfunded.invites;
create policy p_invites_insert on getfunded.invites for insert
  with check (getfunded.is_admin(workspace_id));
drop policy if exists p_invites_update on getfunded.invites;
create policy p_invites_update on getfunded.invites for update
  using (getfunded.is_admin(workspace_id))
  with check (getfunded.is_admin(workspace_id));
drop policy if exists p_invites_delete on getfunded.invites;
create policy p_invites_delete on getfunded.invites for delete
  using (getfunded.is_admin(workspace_id));

-- subscriptions: members read; writes only through the webhook door (0008).
drop policy if exists p_subscriptions_select on getfunded.subscriptions;
create policy p_subscriptions_select on getfunded.subscriptions for select using (
  getfunded.is_member(workspace_id) or getfunded.is_steward()
);

-- api_keys: admins manage. Key authentication goes through verify_api_key() (0008).
drop policy if exists p_api_keys_select on getfunded.api_keys;
create policy p_api_keys_select on getfunded.api_keys for select
  using (getfunded.is_admin(workspace_id));
drop policy if exists p_api_keys_insert on getfunded.api_keys;
create policy p_api_keys_insert on getfunded.api_keys for insert
  with check (getfunded.is_admin(workspace_id));
drop policy if exists p_api_keys_update on getfunded.api_keys;
create policy p_api_keys_update on getfunded.api_keys for update
  using (getfunded.is_admin(workspace_id))
  with check (getfunded.is_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Doors
-- ---------------------------------------------------------------------------

-- First sign-in: user row, personal workspace (slug from the display name),
-- owner membership, in one transaction. Idempotent: a repeat call refreshes
-- email/last_seen_at and returns the existing personal workspace.
create or replace function getfunded.provision_user(auth_user_id uuid, email text, display_name text)
returns table (user_id uuid, workspace_id uuid, is_new boolean)
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_email  text := lower(btrim(coalesce(email, '')));
  v_name   text := nullif(btrim(coalesce(display_name, '')), '');
  v_uid    uuid;
  v_ws     uuid;
  v_new    boolean := false;
  v_base   text;
  v_slug   text;
  v_i      int := 1;
begin
  if auth_user_id is null then
    raise exception 'provision_user: auth_user_id is required';
  end if;
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'provision_user: a valid email is required';
  end if;

  select u.id into v_uid from getfunded.users u where u.id = auth_user_id for update;

  if v_uid is null then
    insert into getfunded.users (id, email, display_name, last_seen_at)
    values (auth_user_id, v_email, v_name, now())
    returning getfunded.users.id into v_uid;
    v_new := true;
  else
    update getfunded.users u
       set email        = v_email,
           display_name = coalesce(u.display_name, v_name),
           last_seen_at = now()
     where u.id = v_uid;
  end if;

  -- The personal workspace: the earliest one this user owns.
  select m.workspace_id into v_ws
  from getfunded.members m
  join getfunded.workspaces w on w.id = m.workspace_id
  where m.user_id = v_uid and w.deleted_at is null
  order by (m.role = 'owner') desc, m.created_at asc
  limit 1;

  if v_ws is null then
    v_base := getfunded.slugify(coalesce(v_name, split_part(v_email, '@', 1)));
    v_slug := v_base;
    while exists (select 1 from getfunded.workspaces w where w.slug = v_slug) loop
      v_i := v_i + 1;
      v_slug := v_base || '-' || v_i;
    end loop;

    insert into getfunded.workspaces (slug, name, plan)
    values (v_slug, coalesce(v_name, split_part(v_email, '@', 1)), 'free')
    returning getfunded.workspaces.id into v_ws;

    insert into getfunded.members (workspace_id, user_id, role)
    values (v_ws, v_uid, 'owner');
  end if;

  user_id      := v_uid;
  workspace_id := v_ws;
  is_new       := v_new;
  return next;
end $$;

-- Join a workspace with a bearer token. Hashes, checks expiry and reuse,
-- inserts the membership for current_user_id(), returns the workspace id.
create or replace function getfunded.accept_invite(token text)
returns uuid
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_uid uuid := getfunded.current_user_id();
  v_inv getfunded.invites%rowtype;
begin
  if v_uid is null then
    raise exception 'accept_invite: not signed in' using errcode = '28000';
  end if;
  if token is null or btrim(token) = '' then
    raise exception 'invite_invalid';
  end if;

  select * into v_inv from getfunded.invites i
  where i.token_hash = getfunded.hash_token(token)
  for update;

  if not found then
    raise exception 'invite_invalid';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'invite_used';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'invite_expired';
  end if;

  insert into getfunded.members (workspace_id, user_id, role, invited_by)
  values (v_inv.workspace_id, v_uid, v_inv.role, v_inv.invited_by)
  on conflict (workspace_id, user_id) do nothing;

  update getfunded.invites set accepted_at = now() where id = v_inv.id;

  return v_inv.workspace_id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
grant select on getfunded.users to getfunded_app;
grant update (display_name, last_seen_at) on getfunded.users to getfunded_app;

grant select on getfunded.workspaces to getfunded_app;
grant update (slug, name, stripe_customer_id, profile, settings, deleted_at, version)
  on getfunded.workspaces to getfunded_app;

grant select, insert, update, delete on getfunded.members to getfunded_app;
grant select, insert, update, delete on getfunded.invites to getfunded_app;
grant select on getfunded.subscriptions to getfunded_app;
grant select, insert, update on getfunded.api_keys to getfunded_app;

revoke all on function getfunded.provision_user(uuid, text, text) from public;
revoke all on function getfunded.accept_invite(text) from public;

grant execute on function getfunded.provision_user(uuid, text, text) to getfunded_app;
grant execute on function getfunded.accept_invite(text) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     select * from getfunded.provision_user('<auth uuid>', 'a@example.org', 'A');
--     select set_config('app.user_id', '<auth uuid>', true);
--     update getfunded.workspaces set plan = 'enterprise';   -- MUST fail (column grant)
--     insert into getfunded.workspaces (slug, name) values ('x', 'x');  -- MUST fail
--   rollback;
