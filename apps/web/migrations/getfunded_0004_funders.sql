-- getfunded_0004: funders in the workspace.
--
-- saved_funders, stage_history, activities, tasks, knowledge, imports,
-- collections, collection_items, and the move_stage() door.
--
-- org_id is a SOFT corpus reference (no FK into internal.*): the snapshot
-- carries name, ein, org_type, city, state and website so a corpus re-ingest
-- can never orphan a workspace row. stage_history and activities are
-- append-only: SELECT + INSERT grants, nothing else.

-- ---------------------------------------------------------------------------
-- saved_funders
-- ---------------------------------------------------------------------------
create table if not exists getfunded.saved_funders (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references getfunded.workspaces(id) on delete cascade,
  org_id          uuid        not null,
  snapshot        jsonb       not null default '{}'::jsonb
                  constraint ck_saved_funders_snapshot check (jsonb_typeof(snapshot) = 'object'),
  stage           text        not null default 'identified'
                  constraint ck_saved_funders_stage check (stage in (
                    'identified', 'researching', 'qualified', 'cultivating',
                    'loi_submitted', 'proposal_submitted', 'awarded', 'declined', 'parked')),
  tier            smallint    constraint ck_saved_funders_tier check (tier is null or tier between 1 and 3),
  owner_id        uuid        references getfunded.users(id) on delete set null,
  ask_amount      bigint      constraint ck_saved_funders_ask check (ask_amount is null or ask_amount >= 0),
  next_action     text,
  next_action_due date,
  source_detail   text,
  tags            text[]      not null default '{}',
  archived_at     timestamptz,
  created_by      uuid        references getfunded.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         int         not null default 1,
  constraint uq_saved_funders_org unique (workspace_id, org_id)
);
create index if not exists ix_saved_funders_ws_stage on getfunded.saved_funders (workspace_id, stage);
create index if not exists ix_saved_funders_ws_due on getfunded.saved_funders (workspace_id, next_action_due);

drop trigger if exists trg_saved_funders_updated on getfunded.saved_funders;
create trigger trg_saved_funders_updated before update on getfunded.saved_funders
  for each row execute function getfunded.set_updated_at();

alter table getfunded.saved_funders enable row level security;
alter table getfunded.saved_funders force row level security;

-- ---------------------------------------------------------------------------
-- stage_history (append-only)
-- ---------------------------------------------------------------------------
create table if not exists getfunded.stage_history (
  id              bigserial   primary key,
  saved_funder_id uuid        not null references getfunded.saved_funders(id) on delete cascade,
  workspace_id    uuid        not null references getfunded.workspaces(id) on delete cascade,
  from_stage      text,
  to_stage        text        not null,
  changed_by      uuid,
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists ix_stage_history_funder on getfunded.stage_history (saved_funder_id, created_at);

alter table getfunded.stage_history enable row level security;
alter table getfunded.stage_history force row level security;

-- ---------------------------------------------------------------------------
-- activities (append-only). system rows are written by the app and by
-- move_stage().
-- ---------------------------------------------------------------------------
create table if not exists getfunded.activities (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references getfunded.workspaces(id) on delete cascade,
  saved_funder_id uuid        references getfunded.saved_funders(id) on delete cascade,
  kind            text        not null
                  constraint ck_activities_kind
                  check (kind in ('note', 'email', 'call', 'meeting', 'letter', 'event', 'system')),
  body            text        not null default '',
  occurred_at     timestamptz not null default now(),
  created_by      uuid,
  meta            jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists ix_activities_funder on getfunded.activities (saved_funder_id, occurred_at desc);
create index if not exists ix_activities_ws on getfunded.activities (workspace_id, occurred_at desc);

alter table getfunded.activities enable row level security;
alter table getfunded.activities force row level security;

-- ---------------------------------------------------------------------------
-- tasks
-- ---------------------------------------------------------------------------
create table if not exists getfunded.tasks (
  id              uuid        primary key default gen_random_uuid(),
  workspace_id    uuid        not null references getfunded.workspaces(id) on delete cascade,
  saved_funder_id uuid        references getfunded.saved_funders(id) on delete set null,
  title           text        not null,
  details         text,
  due_date        date,
  assignee_id     uuid        references getfunded.users(id) on delete set null,
  status          text        not null default 'open'
                  constraint ck_tasks_status check (status in ('open', 'done', 'canceled')),
  completed_at    timestamptz,
  created_by      uuid        references getfunded.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         int         not null default 1
);
create index if not exists ix_tasks_ws_status on getfunded.tasks (workspace_id, status, due_date);

drop trigger if exists trg_tasks_updated on getfunded.tasks;
create trigger trg_tasks_updated before update on getfunded.tasks
  for each row execute function getfunded.set_updated_at();

alter table getfunded.tasks enable row level security;
alter table getfunded.tasks force row level security;

-- ---------------------------------------------------------------------------
-- knowledge: only approved=true rows ever enter a prompt (enforced in
-- lib/ai; the approval columns live here).
-- ---------------------------------------------------------------------------
create table if not exists getfunded.knowledge (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  kind         text        not null
               constraint ck_knowledge_kind check (kind in ('fact', 'program', 'outcome', 'boilerplate')),
  title        text        not null,
  body         text        not null,
  approved     boolean     not null default false,
  approved_by  uuid        references getfunded.users(id) on delete set null,
  approved_at  timestamptz,
  created_by   uuid        references getfunded.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1
);
create index if not exists ix_knowledge_ws on getfunded.knowledge (workspace_id, kind, approved);

drop trigger if exists trg_knowledge_updated on getfunded.knowledge;
create trigger trg_knowledge_updated before update on getfunded.knowledge
  for each row execute function getfunded.set_updated_at();

alter table getfunded.knowledge enable row level security;
alter table getfunded.knowledge force row level security;

-- ---------------------------------------------------------------------------
-- imports: the CSV import report. Never silently merges.
-- ---------------------------------------------------------------------------
create table if not exists getfunded.imports (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  filename     text        not null,
  row_count    int         not null default 0,
  matched      int         not null default 0,
  unmatched    int         not null default 0,
  report       jsonb       not null default '{}'::jsonb,
  created_by   uuid        references getfunded.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1
);
create index if not exists ix_imports_ws on getfunded.imports (workspace_id, created_at desc);

drop trigger if exists trg_imports_updated on getfunded.imports;
create trigger trg_imports_updated before update on getfunded.imports
  for each row execute function getfunded.set_updated_at();

alter table getfunded.imports enable row level security;
alter table getfunded.imports force row level security;

-- ---------------------------------------------------------------------------
-- collections and collection_items: named lists.
-- ---------------------------------------------------------------------------
create table if not exists getfunded.collections (
  id           uuid        primary key default gen_random_uuid(),
  workspace_id uuid        not null references getfunded.workspaces(id) on delete cascade,
  name         text        not null,
  description  text,
  is_shared    boolean     not null default true,
  created_by   uuid        references getfunded.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      int         not null default 1
);
create index if not exists ix_collections_ws on getfunded.collections (workspace_id);

drop trigger if exists trg_collections_updated on getfunded.collections;
create trigger trg_collections_updated before update on getfunded.collections
  for each row execute function getfunded.set_updated_at();

alter table getfunded.collections enable row level security;
alter table getfunded.collections force row level security;

create table if not exists getfunded.collection_items (
  collection_id   uuid        not null references getfunded.collections(id) on delete cascade,
  saved_funder_id uuid        not null references getfunded.saved_funders(id) on delete cascade,
  position        int         not null default 0,
  created_at      timestamptz not null default now(),
  primary key (collection_id, saved_funder_id)
);

alter table getfunded.collection_items enable row level security;
alter table getfunded.collection_items force row level security;

-- ---------------------------------------------------------------------------
-- Policies: members of the workspace, read and write.
-- ---------------------------------------------------------------------------
drop policy if exists p_saved_funders_select on getfunded.saved_funders;
create policy p_saved_funders_select on getfunded.saved_funders for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_saved_funders_insert on getfunded.saved_funders;
create policy p_saved_funders_insert on getfunded.saved_funders for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_saved_funders_update on getfunded.saved_funders;
create policy p_saved_funders_update on getfunded.saved_funders for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));

drop policy if exists p_stage_history_select on getfunded.stage_history;
create policy p_stage_history_select on getfunded.stage_history for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_stage_history_insert on getfunded.stage_history;
create policy p_stage_history_insert on getfunded.stage_history for insert
  with check (getfunded.is_member(workspace_id));

drop policy if exists p_activities_select on getfunded.activities;
create policy p_activities_select on getfunded.activities for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_activities_insert on getfunded.activities;
create policy p_activities_insert on getfunded.activities for insert
  with check (getfunded.is_member(workspace_id));

drop policy if exists p_tasks_select on getfunded.tasks;
create policy p_tasks_select on getfunded.tasks for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_tasks_insert on getfunded.tasks;
create policy p_tasks_insert on getfunded.tasks for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_tasks_update on getfunded.tasks;
create policy p_tasks_update on getfunded.tasks for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_tasks_delete on getfunded.tasks;
create policy p_tasks_delete on getfunded.tasks for delete
  using (getfunded.is_member(workspace_id));

drop policy if exists p_knowledge_select on getfunded.knowledge;
create policy p_knowledge_select on getfunded.knowledge for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_knowledge_insert on getfunded.knowledge;
create policy p_knowledge_insert on getfunded.knowledge for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_knowledge_update on getfunded.knowledge;
create policy p_knowledge_update on getfunded.knowledge for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_knowledge_delete on getfunded.knowledge;
create policy p_knowledge_delete on getfunded.knowledge for delete
  using (getfunded.is_admin(workspace_id));

drop policy if exists p_imports_select on getfunded.imports;
create policy p_imports_select on getfunded.imports for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_imports_insert on getfunded.imports;
create policy p_imports_insert on getfunded.imports for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_imports_update on getfunded.imports;
create policy p_imports_update on getfunded.imports for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));

drop policy if exists p_collections_select on getfunded.collections;
create policy p_collections_select on getfunded.collections for select using (
  getfunded.is_member(workspace_id)
  and (is_shared or created_by = getfunded.current_user_id())
);
drop policy if exists p_collections_insert on getfunded.collections;
create policy p_collections_insert on getfunded.collections for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_collections_update on getfunded.collections;
create policy p_collections_update on getfunded.collections for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_collections_delete on getfunded.collections;
create policy p_collections_delete on getfunded.collections for delete
  using (getfunded.is_member(workspace_id));

-- Item visibility is inherited from the collection: the EXISTS is itself
-- filtered by p_collections_select.
drop policy if exists p_collection_items_select on getfunded.collection_items;
create policy p_collection_items_select on getfunded.collection_items for select using (
  exists (select 1 from getfunded.collections c where c.id = collection_id)
);
drop policy if exists p_collection_items_insert on getfunded.collection_items;
create policy p_collection_items_insert on getfunded.collection_items for insert with check (
  exists (select 1 from getfunded.collections c where c.id = collection_id)
);
drop policy if exists p_collection_items_update on getfunded.collection_items;
create policy p_collection_items_update on getfunded.collection_items for update
  using (exists (select 1 from getfunded.collections c where c.id = collection_id))
  with check (exists (select 1 from getfunded.collections c where c.id = collection_id));
drop policy if exists p_collection_items_delete on getfunded.collection_items;
create policy p_collection_items_delete on getfunded.collection_items for delete using (
  exists (select 1 from getfunded.collections c where c.id = collection_id)
);

-- ---------------------------------------------------------------------------
-- move_stage: compare-and-swap stage move. Rejects a stale version with
-- 'stale_version' (detail {expected, actual}), writes the stage_history row
-- and a system activity, returns the new version.
-- ---------------------------------------------------------------------------
create or replace function getfunded.move_stage(
  saved_funder_id uuid,
  to_stage text,
  expected_version int,
  note text
) returns int
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_ws      uuid;
  v_from    text;
  v_version int;
  v_new     int;
  v_uid     uuid := getfunded.current_user_id();
begin
  if to_stage is null or to_stage not in (
    'identified', 'researching', 'qualified', 'cultivating',
    'loi_submitted', 'proposal_submitted', 'awarded', 'declined', 'parked') then
    raise exception 'move_stage: unknown stage %', to_stage;
  end if;

  select f.workspace_id, f.stage, f.version
    into v_ws, v_from, v_version
  from getfunded.saved_funders f
  where f.id = move_stage.saved_funder_id
  for update;

  if not found then
    raise exception 'saved_funder_not_found';
  end if;
  if not getfunded.is_member(v_ws) then
    raise exception 'move_stage: not a member of workspace %', v_ws using errcode = '42501';
  end if;
  if expected_version is not null and v_version <> expected_version then
    raise exception 'stale_version'
      using errcode = '40001',
            detail = jsonb_build_object('expected', expected_version, 'actual', v_version)::text,
            hint = 'Reload the funder and retry.';
  end if;

  if v_from = to_stage then
    return v_version;
  end if;

  update getfunded.saved_funders f
     set stage = to_stage, version = f.version + 1
   where f.id = move_stage.saved_funder_id
  returning f.version into v_new;

  insert into getfunded.stage_history (saved_funder_id, workspace_id, from_stage, to_stage, changed_by, note)
  values (move_stage.saved_funder_id, v_ws, v_from, to_stage, v_uid, nullif(btrim(coalesce(note, '')), ''));

  insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, created_by, meta)
  values (
    v_ws,
    move_stage.saved_funder_id,
    'system',
    format('Stage changed from %s to %s', v_from, to_stage)
      || coalesce(': ' || nullif(btrim(coalesce(note, '')), ''), ''),
    v_uid,
    jsonb_build_object('event', 'stage_change', 'from', v_from, 'to', to_stage,
                       'note', nullif(btrim(coalesce(note, '')), ''))
  );

  return v_new;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
grant select, insert, update on getfunded.saved_funders to getfunded_app;
grant select, insert on getfunded.stage_history to getfunded_app;
grant usage, select on sequence getfunded.stage_history_id_seq to getfunded_app;
grant select, insert on getfunded.activities to getfunded_app;
grant select, insert, update, delete on getfunded.tasks to getfunded_app;
grant select, insert, update, delete on getfunded.knowledge to getfunded_app;
grant select, insert, update on getfunded.imports to getfunded_app;
grant select, insert, update, delete on getfunded.collections to getfunded_app;
grant select, insert, update, delete on getfunded.collection_items to getfunded_app;

revoke all on function getfunded.move_stage(uuid, text, int, text) from public;
grant execute on function getfunded.move_stage(uuid, text, int, text) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     select set_config('app.user_id', '<member uuid>', true);
--     select getfunded.move_stage('<saved funder>', 'researching', 1, 'kickoff');  -- 2
--     select getfunded.move_stage('<saved funder>', 'qualified', 1, null);         -- MUST fail stale_version
--     update getfunded.stage_history set note = 'x';                                -- MUST fail
--   rollback;
