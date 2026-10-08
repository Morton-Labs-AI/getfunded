-- getfunded_0009: the steward surface (/admin, /api/admin, /api/cron).
--
-- Three things, all additive and idempotent:
--
--  1. Named steward policies. The base policies in 0002, 0003 and 0007 already
--     carry `or getfunded.is_steward()` inline. These are SEPARATE permissive
--     policies (`p_<table>_steward_<verb>`), so a later rewrite of a base policy
--     can never silently drop the steward's read of accounts, plans, usage and
--     telemetry. Stewards read account/plan/usage/telemetry tables only: never
--     customer content (saved_funders, contacts, messages, knowledge, ...).
--
--  2. Doors for things the app role may not do directly:
--       set_steward(user, bool)   stewards flip users.is_steward (no app UPDATE grant on it)
--       claim_steward(emails[])   the SIGNED-IN user becomes a steward when their email is
--                                 in the list the app passes (ADMIN_EMAILS). Promotes the
--                                 caller only, never anyone else, never demotes. This is the
--                                 bootstrap: without it the first steward would need psql.
--       daily_maintenance(..)     the cron: prune events older than the retention, mark
--                                 'sending' messages stuck longer than the stale window as
--                                 'failed' (with a send_outcomes row), record 'cron:daily'.
--                                 events has no DELETE grant and the cron has no user, so a
--                                 door is the only honest path.
--
--  3. Two indexes the cross-workspace aggregates want (created_at on usage_ledger
--     and users). Cheap, and they keep /admin fast as the ledger grows.
--
-- No new tables. No new seeded flags (the 'banner' flag is absent until a
-- steward writes it; absent means no banner).

-- ---------------------------------------------------------------------------
-- 1. Steward policies (additive)
-- ---------------------------------------------------------------------------
drop policy if exists p_users_steward_select on getfunded.users;
create policy p_users_steward_select on getfunded.users for select
  using (getfunded.is_steward());

drop policy if exists p_workspaces_steward_select on getfunded.workspaces;
create policy p_workspaces_steward_select on getfunded.workspaces for select
  using (getfunded.is_steward());

drop policy if exists p_members_steward_select on getfunded.members;
create policy p_members_steward_select on getfunded.members for select
  using (getfunded.is_steward());

drop policy if exists p_subscriptions_steward_select on getfunded.subscriptions;
create policy p_subscriptions_steward_select on getfunded.subscriptions for select
  using (getfunded.is_steward());

drop policy if exists p_api_keys_steward_select on getfunded.api_keys;
create policy p_api_keys_steward_select on getfunded.api_keys for select
  using (getfunded.is_steward());

drop policy if exists p_usage_steward_select on getfunded.usage_ledger;
create policy p_usage_steward_select on getfunded.usage_ledger for select
  using (getfunded.is_steward());

drop policy if exists p_events_steward_select on getfunded.events;
create policy p_events_steward_select on getfunded.events for select
  using (getfunded.is_steward());

drop policy if exists p_plan_overrides_steward_select on getfunded.plan_overrides;
create policy p_plan_overrides_steward_select on getfunded.plan_overrides for select
  using (getfunded.is_steward());
drop policy if exists p_plan_overrides_steward_insert on getfunded.plan_overrides;
create policy p_plan_overrides_steward_insert on getfunded.plan_overrides for insert
  with check (getfunded.is_steward());
drop policy if exists p_plan_overrides_steward_update on getfunded.plan_overrides;
create policy p_plan_overrides_steward_update on getfunded.plan_overrides for update
  using (getfunded.is_steward()) with check (getfunded.is_steward());
drop policy if exists p_plan_overrides_steward_delete on getfunded.plan_overrides;
create policy p_plan_overrides_steward_delete on getfunded.plan_overrides for delete
  using (getfunded.is_steward());

drop policy if exists p_flags_steward_select on getfunded.flags;
create policy p_flags_steward_select on getfunded.flags for select
  using (getfunded.is_steward());
drop policy if exists p_flags_steward_insert on getfunded.flags;
create policy p_flags_steward_insert on getfunded.flags for insert
  with check (getfunded.is_steward());
drop policy if exists p_flags_steward_update on getfunded.flags;
create policy p_flags_steward_update on getfunded.flags for update
  using (getfunded.is_steward()) with check (getfunded.is_steward());

-- ---------------------------------------------------------------------------
-- 2. Indexes for cross-workspace aggregates
-- ---------------------------------------------------------------------------
create index if not exists ix_usage_created on getfunded.usage_ledger (created_at desc);
create index if not exists ix_users_created on getfunded.users (created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Doors
-- ---------------------------------------------------------------------------

-- set_steward: a steward grants or removes steward access for a user.
-- Refuses when the caller is not a steward (42501), when the target is missing
-- ('user_not_found'), and when a steward tries to remove their own access
-- ('steward_self_demote', 42501) so the last steward cannot lock everyone out.
-- Records a 'steward:set' event.
create or replace function getfunded.set_steward(p_user_id uuid, p_is_steward boolean)
returns boolean
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_caller uuid := getfunded.current_user_id();
  v_value  boolean := coalesce(p_is_steward, false);
begin
  if v_caller is null then
    raise exception 'set_steward: not signed in' using errcode = '28000';
  end if;
  if not getfunded.is_steward() then
    raise exception 'set_steward: forbidden' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'set_steward: user id is required';
  end if;
  if p_user_id = v_caller and not v_value then
    raise exception 'steward_self_demote' using errcode = '42501',
      hint = 'Ask another steward to remove your access.';
  end if;

  update getfunded.users u set is_steward = v_value where u.id = p_user_id;
  if not found then
    raise exception 'user_not_found';
  end if;

  insert into getfunded.events (user_id, name, props)
  values (v_caller, 'steward:set', jsonb_build_object('target_user_id', p_user_id, 'is_steward', v_value));

  return v_value;
end $$;

-- claim_steward: the signed-in user becomes a steward when their email is in
-- p_emails. The app passes ADMIN_EMAILS; the door promotes THE CALLER ONLY and
-- never demotes anyone. Returns the caller's steward status afterwards.
-- Anonymous callers get false. Records a 'steward:claimed' event on promotion.
create or replace function getfunded.claim_steward(p_emails text[])
returns boolean
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_uid uuid := getfunded.current_user_id();
  v_n   int  := 0;
begin
  if v_uid is null then
    return false;
  end if;
  if p_emails is not null and cardinality(p_emails) > 0 then
    update getfunded.users u
       set is_steward = true
     where u.id = v_uid
       and not u.is_steward
       and lower(u.email::text) in (
         select lower(btrim(e)) from unnest(p_emails) as e where btrim(coalesce(e, '')) <> ''
       );
    get diagnostics v_n = row_count;
    if v_n > 0 then
      insert into getfunded.events (user_id, name, props)
      values (v_uid, 'steward:claimed', '{}'::jsonb);
    end if;
  end if;
  return exists (select 1 from getfunded.users u where u.id = v_uid and u.is_steward);
end $$;

-- daily_maintenance: the /api/cron/daily job, in one transaction.
--   events_pruned  rows of getfunded.events older than p_event_retention (default 12 months)
--   sends_failed   messages stuck in 'sending' longer than p_stale_send_after (default 1 hour),
--                  set to 'failed' with an error note and a send_outcomes 'failed' row, so the
--                  outreach runner can reconcile them instead of retrying blindly
-- Records a 'cron:daily' event with both counts. Guards refuse a retention under
-- 30 days or a stale window under 5 minutes so a typo cannot wipe telemetry or
-- fail in-flight sends.
create or replace function getfunded.daily_maintenance(
  p_event_retention  interval default interval '12 months',
  p_stale_send_after interval default interval '1 hour'
) returns table (events_pruned bigint, sends_failed bigint)
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_pruned bigint := 0;
  v_failed bigint := 0;
begin
  if p_event_retention is null or p_event_retention < interval '30 days' then
    raise exception 'daily_maintenance: event retention must be at least 30 days';
  end if;
  if p_stale_send_after is null or p_stale_send_after < interval '5 minutes' then
    raise exception 'daily_maintenance: stale send window must be at least 5 minutes';
  end if;

  delete from getfunded.events e where e.created_at < now() - p_event_retention;
  get diagnostics v_pruned = row_count;

  with stale as (
    update getfunded.messages m
       set status = 'failed',
           error  = coalesce(m.error,
                      'The send did not finish within ' || p_stale_send_after::text ||
                      '. Marked failed by daily maintenance so it can be checked and resent.')
     where m.status = 'sending'
       and m.updated_at < now() - p_stale_send_after
     returning m.id, m.workspace_id
  )
  insert into getfunded.send_outcomes (message_id, workspace_id, outcome, provider_payload)
  select s.id, s.workspace_id, 'failed',
         jsonb_build_object('reason', 'stale_sending', 'reconciled_by', 'cron:daily')
  from stale s;
  get diagnostics v_failed = row_count;

  insert into getfunded.events (name, props)
  values ('cron:daily', jsonb_build_object('events_pruned', v_pruned, 'sends_failed', v_failed));

  events_pruned := v_pruned;
  sends_failed  := v_failed;
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
revoke all on function getfunded.set_steward(uuid, boolean) from public;
revoke all on function getfunded.claim_steward(text[]) from public;
revoke all on function getfunded.daily_maintenance(interval, interval) from public;

grant execute on function getfunded.set_steward(uuid, boolean) to getfunded_app;
grant execute on function getfunded.claim_steward(text[]) to getfunded_app;
grant execute on function getfunded.daily_maintenance(interval, interval) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     select set_config('app.user_id', '<steward uuid>', true);
--     select count(*) from getfunded.workspaces;                  -- every live workspace
--     select getfunded.set_steward('<other uuid>', true);          -- true
--     select getfunded.set_steward('<steward uuid>', false);       -- MUST fail (steward_self_demote)
--     select * from getfunded.daily_maintenance();                 -- (0, 0) on a quiet day
--     delete from getfunded.events;                                -- MUST fail (no grant)
--   rollback;
