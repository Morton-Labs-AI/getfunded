-- getfunded_0005: AI output, append-only.
--
-- ai_analyses is INSERT + SELECT only for the app: no UPDATE grant at all,
-- not even on is_latest. The latest pointer flips through
-- mark_latest_analysis(), a SECURITY DEFINER door, and a partial unique index
-- keeps exactly one latest per (workspace, org, kind, is_mock). Mock output
-- (is_mock = true) is its own namespace and is never reused for a real request.
-- ai_feedback is append-only too.

create table if not exists getfunded.ai_analyses (
  id                uuid        primary key default gen_random_uuid(),
  workspace_id      uuid        not null references getfunded.workspaces(id) on delete cascade,
  saved_funder_id   uuid        references getfunded.saved_funders(id) on delete set null,
  org_id            uuid        not null,
  kind              text        not null
                    constraint ck_ai_kind check (kind in ('fit', 'research', 'summary')),
  model             text        not null,
  prompt_version    text        not null,
  weights_version   text,
  input_fingerprint text        not null,
  evidence          jsonb       not null default '{}'::jsonb,
  output            jsonb       not null,
  score             numeric     constraint ck_ai_score check (score is null or score between 0 and 100),
  rating            text,
  is_latest         boolean     not null default false,
  is_mock           boolean     not null default false,
  usage_ledger_id   bigint      references getfunded.usage_ledger(id) on delete set null,
  created_by        uuid        references getfunded.users(id) on delete set null,
  created_at        timestamptz not null default now()
  -- no updated_at, no version: append-only by design
);
create unique index if not exists uq_ai_latest
  on getfunded.ai_analyses (workspace_id, org_id, kind, is_mock) where is_latest;
create index if not exists ix_ai_ws_org on getfunded.ai_analyses (workspace_id, org_id, kind, created_at desc);
create index if not exists ix_ai_funder on getfunded.ai_analyses (saved_funder_id, created_at desc);

alter table getfunded.ai_analyses enable row level security;
alter table getfunded.ai_analyses force row level security;

create table if not exists getfunded.ai_feedback (
  id            bigserial   primary key,
  analysis_id   uuid        not null references getfunded.ai_analyses(id) on delete cascade,
  workspace_id  uuid        not null references getfunded.workspaces(id) on delete cascade,
  verdict       text        not null
                constraint ck_ai_feedback_verdict check (verdict in ('accepted', 'edited', 'dismissed')),
  edited_output jsonb,
  created_by    uuid        references getfunded.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists ix_ai_feedback_analysis on getfunded.ai_feedback (analysis_id);

alter table getfunded.ai_feedback enable row level security;
alter table getfunded.ai_feedback force row level security;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
drop policy if exists p_ai_select on getfunded.ai_analyses;
create policy p_ai_select on getfunded.ai_analyses for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_ai_insert on getfunded.ai_analyses;
create policy p_ai_insert on getfunded.ai_analyses for insert
  with check (getfunded.is_member(workspace_id));

drop policy if exists p_ai_feedback_select on getfunded.ai_feedback;
create policy p_ai_feedback_select on getfunded.ai_feedback for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_ai_feedback_insert on getfunded.ai_feedback;
create policy p_ai_feedback_insert on getfunded.ai_feedback for insert
  with check (getfunded.is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- mark_latest_analysis: flips is_latest within (workspace_id, org_id, kind,
-- is_mock). The caller must be a member of the analysis's workspace.
-- ---------------------------------------------------------------------------
create or replace function getfunded.mark_latest_analysis(analysis_id uuid) returns void
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_ws   uuid;
  v_org  uuid;
  v_kind text;
  v_mock boolean;
begin
  select a.workspace_id, a.org_id, a.kind, a.is_mock
    into v_ws, v_org, v_kind, v_mock
  from getfunded.ai_analyses a
  where a.id = mark_latest_analysis.analysis_id;

  if not found then
    raise exception 'analysis_not_found';
  end if;
  if not getfunded.is_member(v_ws) then
    raise exception 'mark_latest_analysis: not a member of workspace %', v_ws using errcode = '42501';
  end if;

  update getfunded.ai_analyses a
     set is_latest = false
   where a.workspace_id = v_ws and a.org_id = v_org and a.kind = v_kind and a.is_mock = v_mock
     and a.is_latest and a.id <> mark_latest_analysis.analysis_id;

  update getfunded.ai_analyses a
     set is_latest = true
   where a.id = mark_latest_analysis.analysis_id and not a.is_latest;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
grant select, insert on getfunded.ai_analyses to getfunded_app;
grant select, insert on getfunded.ai_feedback to getfunded_app;
grant usage, select on sequence getfunded.ai_feedback_id_seq to getfunded_app;

revoke all on function getfunded.mark_latest_analysis(uuid) from public;
grant execute on function getfunded.mark_latest_analysis(uuid) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     update getfunded.ai_analyses set is_latest = false;   -- MUST fail (no grant)
--     delete from getfunded.ai_analyses;                    -- MUST fail
--   rollback;
