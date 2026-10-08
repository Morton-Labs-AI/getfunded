-- getfunded_0007: steward and telemetry.
--
-- flags (readable by everyone, written by the steward), events (append-only
-- product telemetry; anonymous rows allowed; pruned after 12 months), and
-- plan_overrides (steward-granted exceptions for pilot nonprofits).

create table if not exists getfunded.flags (
  key        text        primary key,
  value      jsonb       not null,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

drop trigger if exists trg_flags_updated on getfunded.flags;
create trigger trg_flags_updated before update on getfunded.flags
  for each row execute function getfunded.set_updated_at();

alter table getfunded.flags enable row level security;
alter table getfunded.flags force row level security;

-- Seed rows. Idempotent: an operator's later change is not overwritten.
insert into getfunded.flags (key, value) values
  ('ai_enabled',  'true'::jsonb),
  ('signup_mode', '"open"'::jsonb)
on conflict (key) do nothing;

create table if not exists getfunded.events (
  id           bigserial   primary key,
  workspace_id uuid,
  user_id      uuid,
  name         text        not null constraint ck_events_name check (length(name) between 1 and 120),
  props        jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists ix_events_created on getfunded.events (created_at);
create index if not exists ix_events_ws on getfunded.events (workspace_id, created_at desc);

alter table getfunded.events enable row level security;
alter table getfunded.events force row level security;

create table if not exists getfunded.plan_overrides (
  workspace_id    uuid        primary key references getfunded.workspaces(id) on delete cascade,
  monthly_credits int         constraint ck_plan_overrides_credits check (monthly_credits is null or monthly_credits >= 0),
  members         int         constraint ck_plan_overrides_members check (members is null or members >= 0),
  note            text,
  set_by          uuid,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

drop trigger if exists trg_plan_overrides_updated on getfunded.plan_overrides;
create trigger trg_plan_overrides_updated before update on getfunded.plan_overrides
  for each row execute function getfunded.set_updated_at();

alter table getfunded.plan_overrides enable row level security;
alter table getfunded.plan_overrides force row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
drop policy if exists p_flags_select on getfunded.flags;
create policy p_flags_select on getfunded.flags for select using (true);
drop policy if exists p_flags_insert on getfunded.flags;
create policy p_flags_insert on getfunded.flags for insert with check (getfunded.is_steward());
drop policy if exists p_flags_update on getfunded.flags;
create policy p_flags_update on getfunded.flags for update
  using (getfunded.is_steward()) with check (getfunded.is_steward());

-- events: anyone may record an event about themself (or anonymously); members
-- read their workspace's events; the steward reads all.
drop policy if exists p_events_select on getfunded.events;
create policy p_events_select on getfunded.events for select using (
  getfunded.is_steward()
  or (workspace_id is not null and getfunded.is_member(workspace_id))
);
drop policy if exists p_events_insert on getfunded.events;
create policy p_events_insert on getfunded.events for insert with check (
  (user_id is null or user_id = getfunded.current_user_id())
  and (workspace_id is null or getfunded.is_member(workspace_id))
);

drop policy if exists p_plan_overrides_select on getfunded.plan_overrides;
create policy p_plan_overrides_select on getfunded.plan_overrides for select using (
  getfunded.is_member(workspace_id) or getfunded.is_steward()
);
drop policy if exists p_plan_overrides_insert on getfunded.plan_overrides;
create policy p_plan_overrides_insert on getfunded.plan_overrides for insert
  with check (getfunded.is_steward());
drop policy if exists p_plan_overrides_update on getfunded.plan_overrides;
create policy p_plan_overrides_update on getfunded.plan_overrides for update
  using (getfunded.is_steward()) with check (getfunded.is_steward());
drop policy if exists p_plan_overrides_delete on getfunded.plan_overrides;
create policy p_plan_overrides_delete on getfunded.plan_overrides for delete
  using (getfunded.is_steward());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
grant select, insert, update on getfunded.flags to getfunded_app;
grant select, insert on getfunded.events to getfunded_app;
grant usage, select on sequence getfunded.events_id_seq to getfunded_app;
grant select, insert, update, delete on getfunded.plan_overrides to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     select value from getfunded.flags where key = 'ai_enabled';   -- true
--     insert into getfunded.events (name) values ('db_ping');        -- works, anonymous
--     delete from getfunded.events;                                  -- MUST fail
--   rollback;
-- Prune (operator cron): delete from getfunded.events where created_at < now() - interval '12 months';
