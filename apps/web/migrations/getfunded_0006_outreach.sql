-- getfunded_0006: outreach.
--
-- contacts, sender_identities, secrets, messages, suppressions, send_outcomes
-- and the read_secret() door.
--
-- secrets hold AES-256-GCM ciphertext (key = SECRETS_KEY in the app). The app
-- role has SELECT on the metadata columns only: ciphertext, iv and tag are
-- readable solely through read_secret(), which admits the owner or a
-- workspace admin. send_outcomes is append-only.

-- ---------------------------------------------------------------------------
-- contacts: the workspace's own rows. Corpus public contacts are copied here
-- with source = 'filing_part_xv' only when the user clicks "Use this contact".
-- ---------------------------------------------------------------------------
create table if not exists getfunded.contacts (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references getfunded.workspaces(id) on delete cascade,
  saved_funder_id uuid        references getfunded.saved_funders(id) on delete set null,
  full_name       text        not null,
  title           text,
  email           citext,
  phone           text,
  source          text        not null default 'manual'
                  constraint ck_contacts_source check (source in ('filing_part_xv', 'manual', 'import', 'web')),
  source_url      text,
  publishability  text,
  created_by      uuid        references getfunded.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         int         not null default 1
);
create index if not exists ix_contacts_ws on getfunded.contacts (workspace_id);
create index if not exists ix_contacts_funder on getfunded.contacts (saved_funder_id);

drop trigger if exists trg_contacts_updated on getfunded.contacts;
create trigger trg_contacts_updated before update on getfunded.contacts
  for each row execute function getfunded.set_updated_at();

alter table getfunded.contacts enable row level security;
alter table getfunded.contacts force row level security;

-- ---------------------------------------------------------------------------
-- sender_identities: tokens live in secrets, never here.
-- ---------------------------------------------------------------------------
create table if not exists getfunded.sender_identities (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  user_id      uuid        not null references getfunded.users(id) on delete cascade,
  email        citext      not null,
  display_name text,
  provider     text        not null default 'gmail'
               constraint ck_sender_provider check (provider in ('gmail')),
  status       text        not null default 'connected'
               constraint ck_sender_status check (status in ('connected', 'disconnected', 'error')),
  daily_cap    int         not null default 50 constraint ck_sender_cap check (daily_cap between 0 and 2000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1,
  constraint uq_sender_identity unique (workspace_id, user_id, email)
);

drop trigger if exists trg_sender_identities_updated on getfunded.sender_identities;
create trigger trg_sender_identities_updated before update on getfunded.sender_identities
  for each row execute function getfunded.set_updated_at();

alter table getfunded.sender_identities enable row level security;
alter table getfunded.sender_identities force row level security;

-- ---------------------------------------------------------------------------
-- secrets
-- ---------------------------------------------------------------------------
create table if not exists getfunded.secrets (
  id            uuid        primary key default gen_random_uuid(),
  workspace_id  uuid        not null references getfunded.workspaces(id) on delete cascade,
  owner_user_id uuid        not null references getfunded.users(id) on delete cascade,
  kind          text        not null
                constraint ck_secrets_kind check (kind in ('gmail_refresh_token', 'api_key_hash')),
  ciphertext    bytea       not null,
  iv            bytea       not null,
  tag           bytea       not null,
  key_version   int         not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  version       int         not null default 1
);
create index if not exists ix_secrets_owner on getfunded.secrets (workspace_id, owner_user_id, kind);

drop trigger if exists trg_secrets_updated on getfunded.secrets;
create trigger trg_secrets_updated before update on getfunded.secrets
  for each row execute function getfunded.set_updated_at();

alter table getfunded.secrets enable row level security;
alter table getfunded.secrets force row level security;

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
create table if not exists getfunded.messages (
  id                  uuid        primary key default gen_random_uuid(),
  workspace_id        uuid        not null references getfunded.workspaces(id) on delete cascade,
  saved_funder_id     uuid        references getfunded.saved_funders(id) on delete set null,
  contact_id          uuid        references getfunded.contacts(id) on delete set null,
  sender_identity_id  uuid        references getfunded.sender_identities(id) on delete set null,
  channel             text        not null default 'email'
                      constraint ck_messages_channel check (channel in ('email', 'letter', 'linkedin', 'other')),
  subject             text,
  body                text        not null default '',
  draft_source        text        not null default 'template'
                      constraint ck_messages_draft_source check (draft_source in ('template', 'ai')),
  ai_analysis_id      uuid        references getfunded.ai_analyses(id) on delete set null,
  status              text        not null default 'draft'
                      constraint ck_messages_status check (status in (
                        'draft', 'approved', 'sending', 'sent', 'failed', 'canceled', 'recorded')),
  approved_by         uuid        references getfunded.users(id) on delete set null,
  approved_at         timestamptz,
  idempotency_key     text        unique,
  provider_message_id text,
  thread_id           text,
  sent_at             timestamptz,
  error               text,
  created_by          uuid        references getfunded.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             int         not null default 1,
  constraint ck_messages_approval check (status not in ('approved', 'sending', 'sent') or approved_by is not null)
);
create index if not exists ix_messages_ws_status on getfunded.messages (workspace_id, status, created_at desc);
create index if not exists ix_messages_funder on getfunded.messages (saved_funder_id);
create index if not exists ix_messages_contact on getfunded.messages (contact_id);

drop trigger if exists trg_messages_updated on getfunded.messages;
create trigger trg_messages_updated before update on getfunded.messages
  for each row execute function getfunded.set_updated_at();

alter table getfunded.messages enable row level security;
alter table getfunded.messages force row level security;

-- ---------------------------------------------------------------------------
-- suppressions: checked at approve time and at send time.
-- ---------------------------------------------------------------------------
create table if not exists getfunded.suppressions (
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  kind         text        not null constraint ck_suppressions_kind check (kind in ('email', 'domain')),
  value        citext      not null,
  reason       text,
  created_by   uuid        references getfunded.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, kind, value)
);

alter table getfunded.suppressions enable row level security;
alter table getfunded.suppressions force row level security;

-- ---------------------------------------------------------------------------
-- send_outcomes (append-only)
-- ---------------------------------------------------------------------------
create table if not exists getfunded.send_outcomes (
  id               bigserial   primary key,
  message_id       uuid        not null references getfunded.messages(id) on delete cascade,
  workspace_id     uuid        not null references getfunded.workspaces(id) on delete cascade,
  outcome          text        not null
                   constraint ck_send_outcome check (outcome in ('accepted', 'bounced', 'replied', 'failed')),
  provider_payload jsonb       not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists ix_send_outcomes_message on getfunded.send_outcomes (message_id, created_at);

alter table getfunded.send_outcomes enable row level security;
alter table getfunded.send_outcomes force row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
drop policy if exists p_contacts_select on getfunded.contacts;
create policy p_contacts_select on getfunded.contacts for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_contacts_insert on getfunded.contacts;
create policy p_contacts_insert on getfunded.contacts for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_contacts_update on getfunded.contacts;
create policy p_contacts_update on getfunded.contacts for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_contacts_delete on getfunded.contacts;
create policy p_contacts_delete on getfunded.contacts for delete
  using (getfunded.is_member(workspace_id));

-- sender identities: visible to the workspace; managed by their user or an admin.
drop policy if exists p_sender_select on getfunded.sender_identities;
create policy p_sender_select on getfunded.sender_identities for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_sender_insert on getfunded.sender_identities;
create policy p_sender_insert on getfunded.sender_identities for insert
  with check (getfunded.is_member(workspace_id) and user_id = getfunded.current_user_id());
drop policy if exists p_sender_update on getfunded.sender_identities;
create policy p_sender_update on getfunded.sender_identities for update
  using (getfunded.is_member(workspace_id)
         and (user_id = getfunded.current_user_id() or getfunded.is_admin(workspace_id)))
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_sender_delete on getfunded.sender_identities;
create policy p_sender_delete on getfunded.sender_identities for delete
  using (user_id = getfunded.current_user_id() or getfunded.is_admin(workspace_id));

-- secrets: owner or admin sees the row exists; only the owner writes it.
drop policy if exists p_secrets_select on getfunded.secrets;
create policy p_secrets_select on getfunded.secrets for select
  using (owner_user_id = getfunded.current_user_id() or getfunded.is_admin(workspace_id));
drop policy if exists p_secrets_insert on getfunded.secrets;
create policy p_secrets_insert on getfunded.secrets for insert
  with check (getfunded.is_member(workspace_id) and owner_user_id = getfunded.current_user_id());
drop policy if exists p_secrets_update on getfunded.secrets;
create policy p_secrets_update on getfunded.secrets for update
  using (owner_user_id = getfunded.current_user_id())
  with check (owner_user_id = getfunded.current_user_id());
drop policy if exists p_secrets_delete on getfunded.secrets;
create policy p_secrets_delete on getfunded.secrets for delete
  using (owner_user_id = getfunded.current_user_id() or getfunded.is_admin(workspace_id));

drop policy if exists p_messages_select on getfunded.messages;
create policy p_messages_select on getfunded.messages for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_messages_insert on getfunded.messages;
create policy p_messages_insert on getfunded.messages for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_messages_update on getfunded.messages;
create policy p_messages_update on getfunded.messages for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_messages_delete on getfunded.messages;
create policy p_messages_delete on getfunded.messages for delete
  using (getfunded.is_member(workspace_id) and status in ('draft', 'canceled'));

drop policy if exists p_suppressions_select on getfunded.suppressions;
create policy p_suppressions_select on getfunded.suppressions for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_suppressions_insert on getfunded.suppressions;
create policy p_suppressions_insert on getfunded.suppressions for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_suppressions_delete on getfunded.suppressions;
create policy p_suppressions_delete on getfunded.suppressions for delete
  using (getfunded.is_member(workspace_id));

drop policy if exists p_send_outcomes_select on getfunded.send_outcomes;
create policy p_send_outcomes_select on getfunded.send_outcomes for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_send_outcomes_insert on getfunded.send_outcomes;
create policy p_send_outcomes_insert on getfunded.send_outcomes for insert
  with check (getfunded.is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- read_secret: the only path to ciphertext. Owner or workspace admin.
-- ---------------------------------------------------------------------------
create or replace function getfunded.read_secret(secret_id uuid)
returns table (ciphertext bytea, iv bytea, tag bytea, key_version int)
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_ws    uuid;
  v_owner uuid;
  v_uid   uuid := getfunded.current_user_id();
begin
  select s.workspace_id, s.owner_user_id into v_ws, v_owner
  from getfunded.secrets s
  where s.id = read_secret.secret_id;

  if not found then
    raise exception 'secret_not_found';
  end if;
  if v_uid is null or not (v_owner = v_uid or getfunded.is_admin(v_ws)) then
    raise exception 'read_secret: forbidden' using errcode = '42501';
  end if;

  return query
    select s.ciphertext, s.iv, s.tag, s.key_version
    from getfunded.secrets s
    where s.id = read_secret.secret_id;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
grant select, insert, update, delete on getfunded.contacts to getfunded_app;
grant select, insert, update, delete on getfunded.sender_identities to getfunded_app;

-- secrets: metadata columns only; ciphertext/iv/tag come through read_secret().
grant select (id, workspace_id, owner_user_id, kind, key_version, created_at, updated_at, version)
  on getfunded.secrets to getfunded_app;
grant insert, update, delete on getfunded.secrets to getfunded_app;

grant select, insert, update, delete on getfunded.messages to getfunded_app;
grant select, insert, delete on getfunded.suppressions to getfunded_app;
grant select, insert on getfunded.send_outcomes to getfunded_app;
grant usage, select on sequence getfunded.send_outcomes_id_seq to getfunded_app;

revoke all on function getfunded.read_secret(uuid) from public;
grant execute on function getfunded.read_secret(uuid) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     select set_config('app.user_id', '<member uuid>', true);
--     select ciphertext from getfunded.secrets;             -- MUST fail (column grant)
--     select * from getfunded.read_secret('<own secret>');  -- one row
--     update getfunded.send_outcomes set outcome = 'x';     -- MUST fail
--   rollback;
