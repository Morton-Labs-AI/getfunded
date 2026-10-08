-- getfunded_0003: usage and limits — the cost-control boundary.
--
-- usage_ledger is append-plus-settle. reserve_credits() inserts a 'reserved'
-- row BEFORE the model call (inside the caller's transaction, under a lock on
-- the workspace row), and the app may then UPDATE only the settle columns
-- (status, model, input_tokens, output_tokens, latency_ms, settled_at, meta)
-- through column-level grants. credits, workspace_id, feature and period_start
-- are frozen at reservation. There is no DELETE grant.
--
-- rate_limits is reachable only through take_token(): RLS on, no policies.

create table if not exists getfunded.usage_ledger (
  id            bigserial   primary key,
  workspace_id  uuid        not null references getfunded.workspaces(id) on delete cascade,
  user_id       uuid        references getfunded.users(id) on delete set null,
  feature       text        not null
                constraint ck_usage_feature
                check (feature in ('filter', 'ask', 'draft', 'fit', 'research')),
  credits       int         not null constraint ck_usage_credits check (credits > 0),
  status        text        not null default 'reserved'
                constraint ck_usage_status check (status in ('reserved', 'settled', 'refunded')),
  model         text,
  input_tokens  int         constraint ck_usage_in check (input_tokens is null or input_tokens >= 0),
  output_tokens int         constraint ck_usage_out check (output_tokens is null or output_tokens >= 0),
  latency_ms    int         constraint ck_usage_latency check (latency_ms is null or latency_ms >= 0),
  period_start  date        not null,
  meta          jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);
create index if not exists ix_usage_ws_period on getfunded.usage_ledger (workspace_id, period_start, status);
create index if not exists ix_usage_ws_created on getfunded.usage_ledger (workspace_id, created_at desc);

alter table getfunded.usage_ledger enable row level security;
alter table getfunded.usage_ledger force row level security;

create table if not exists getfunded.rate_limits (
  key        text        constraint pk_rate_limits primary key,
  tokens     numeric     not null,
  updated_at timestamptz not null default now()
);
alter table getfunded.rate_limits enable row level security;
alter table getfunded.rate_limits force row level security;
-- No policies: the door below is the only path.

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------
drop policy if exists p_usage_select on getfunded.usage_ledger;
create policy p_usage_select on getfunded.usage_ledger for select using (
  getfunded.is_member(workspace_id) or getfunded.is_steward()
);
drop policy if exists p_usage_insert on getfunded.usage_ledger;
create policy p_usage_insert on getfunded.usage_ledger for insert
  with check (getfunded.is_member(workspace_id));
drop policy if exists p_usage_update on getfunded.usage_ledger;
create policy p_usage_update on getfunded.usage_ledger for update
  using (getfunded.is_member(workspace_id))
  with check (getfunded.is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- One query for the usage meter. security_invoker so RLS still applies.
-- Periods and "today" are computed on the UTC calendar day.
-- ---------------------------------------------------------------------------
create or replace view getfunded.v_usage_period
with (security_invoker = true)
as
select
  w.id as workspace_id,
  getfunded.period_start(w.billing_anchor_day, getfunded.utc_today()) as period_start,
  coalesce(sum(l.credits) filter (
    where l.status in ('reserved', 'settled')
      and l.period_start = getfunded.period_start(w.billing_anchor_day, getfunded.utc_today())
  ), 0)::int as credits_used,
  coalesce(sum(l.credits) filter (
    where l.status in ('reserved', 'settled')
      and l.created_at >= (getfunded.utc_today()::timestamp at time zone 'UTC')
  ), 0)::int as credits_today
from getfunded.workspaces w
left join getfunded.usage_ledger l
  on l.workspace_id = w.id
 and l.created_at >= ((getfunded.period_start(w.billing_anchor_day, getfunded.utc_today()) - 1)::timestamp at time zone 'UTC')
group by w.id, w.billing_anchor_day;

-- ---------------------------------------------------------------------------
-- reserve_credits: atomic reservation. Locks the workspace row, sums the
-- current period and the current UTC day, inserts the 'reserved' row or
-- raises quota_exceeded with a JSON detail {used, limit, period_end, scope}.
-- A null (or negative) limit means unlimited.
-- ---------------------------------------------------------------------------
create or replace function getfunded.reserve_credits(
  ws uuid,
  feature text,
  credits int,
  monthly_limit int,
  daily_limit int
) returns bigint
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_today      date        := getfunded.utc_today();
  v_day_start  timestamptz := v_today::timestamp at time zone 'UTC';
  v_anchor     smallint;
  v_ps         date;
  v_pe         date;
  v_used_month int;
  v_used_today int;
  v_id         bigint;
begin
  if credits is null or credits <= 0 then
    raise exception 'reserve_credits: credits must be positive';
  end if;
  if feature is null or feature not in ('filter', 'ask', 'draft', 'fit', 'research') then
    raise exception 'reserve_credits: unknown feature %', feature;
  end if;
  if not getfunded.is_member(ws) then
    raise exception 'reserve_credits: not a member of workspace %', ws using errcode = '42501';
  end if;

  select w.billing_anchor_day into v_anchor
  from getfunded.workspaces w
  where w.id = ws
  for update;
  if not found then
    raise exception 'workspace_not_found';
  end if;

  v_ps := getfunded.period_start(v_anchor, v_today);
  v_pe := getfunded.period_end(v_anchor, v_today);

  select coalesce(sum(l.credits), 0),
         coalesce(sum(l.credits) filter (where l.created_at >= v_day_start), 0)
    into v_used_month, v_used_today
  from getfunded.usage_ledger l
  where l.workspace_id = ws
    and l.status in ('reserved', 'settled')
    and l.period_start = v_ps;

  if monthly_limit is not null and monthly_limit >= 0 and v_used_month + credits > monthly_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'scope', 'monthly',
              'used', v_used_month,
              'limit', monthly_limit,
              'requested', credits,
              'period_end', v_pe)::text,
            hint = 'Monthly AI credit limit reached for this workspace.';
  end if;

  if daily_limit is not null and daily_limit >= 0 and v_used_today + credits > daily_limit then
    raise exception 'quota_exceeded'
      using errcode = 'P0001',
            detail = jsonb_build_object(
              'scope', 'daily',
              'used', v_used_today,
              'limit', daily_limit,
              'requested', credits,
              'period_end', v_today + 1)::text,
            hint = 'Daily AI credit cap reached for this workspace.';
  end if;

  insert into getfunded.usage_ledger (workspace_id, user_id, feature, credits, status, period_start)
  values (ws, getfunded.current_user_id(), feature, credits, 'reserved', v_ps)
  returning id into v_id;

  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- take_token: token bucket. Returns true and spends one token when the bucket
-- (capacity, refilled at refill_per_sec) has one; false otherwise.
-- ---------------------------------------------------------------------------
create or replace function getfunded.take_token(key text, capacity numeric, refill_per_sec numeric)
returns boolean
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_tokens  numeric;
  v_updated timestamptz;
  v_now     timestamptz := clock_timestamp();
begin
  if key is null or btrim(key) = '' then
    raise exception 'take_token: key is required';
  end if;
  if capacity is null or capacity <= 0 or refill_per_sec is null or refill_per_sec < 0 then
    raise exception 'take_token: capacity must be positive and refill_per_sec non-negative';
  end if;

  insert into getfunded.rate_limits as r (key, tokens, updated_at)
  values (take_token.key, capacity, v_now)
  on conflict on constraint pk_rate_limits do nothing;   -- not (key): the parameter is also called key

  select r.tokens, r.updated_at into v_tokens, v_updated
  from getfunded.rate_limits r
  where r.key = take_token.key
  for update;

  v_tokens := least(capacity,
                    v_tokens + greatest(0, extract(epoch from (v_now - v_updated))) * refill_per_sec);

  if v_tokens >= 1 then
    update getfunded.rate_limits r
       set tokens = v_tokens - 1, updated_at = v_now
     where r.key = take_token.key;
    return true;
  end if;

  update getfunded.rate_limits r
     set tokens = v_tokens, updated_at = v_now
   where r.key = take_token.key;
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
grant select, insert on getfunded.usage_ledger to getfunded_app;
grant update (status, model, input_tokens, output_tokens, latency_ms, settled_at, meta)
  on getfunded.usage_ledger to getfunded_app;
grant usage, select on sequence getfunded.usage_ledger_id_seq to getfunded_app;
grant select on getfunded.v_usage_period to getfunded_app;

revoke all on function getfunded.reserve_credits(uuid, text, int, int, int) from public;
revoke all on function getfunded.take_token(text, numeric, numeric) from public;
grant execute on function getfunded.reserve_credits(uuid, text, int, int, int) to getfunded_app;
grant execute on function getfunded.take_token(text, numeric, numeric) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     select set_config('app.user_id', '<member uuid>', true);
--     select getfunded.reserve_credits('<ws>', 'fit', 5, 25, 8);       -- bigint
--     update getfunded.usage_ledger set credits = 1;                    -- MUST fail
--     delete from getfunded.usage_ledger;                               -- MUST fail
--     select getfunded.take_token('ip:127.0.0.1:search', 30, 0.5);      -- true
--   rollback;
