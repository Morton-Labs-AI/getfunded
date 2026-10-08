-- getfunded_0011: sign-up gate doors, invite email binding, ledger reaper.
--
-- Four things, all additive and idempotent:
--
--  1. has_pending_invite(email)   SECURITY DEFINER door for the sign-in flow. The
--                                 steward flag `signup_mode = 'invite'` admits a
--                                 NEW account only when a pending invite names its
--                                 email, and `invites` is admin-only under RLS, so
--                                 the callback (which has no admin, often no user
--                                 row yet) needs a door. Returns true/false and
--                                 nothing else: no workspace, no inviter.
--
--  2. invite_preview(token)       SECURITY DEFINER door for /invite/<token>. The
--                                 signed-in holder of a token may see which
--                                 address the invitation was sent to, the
--                                 workspace name, the role and whether it is still
--                                 pending, so a person signed in with the wrong
--                                 account understands why accepting will fail.
--                                 Requires a signed-in user; unknown token = no row.
--
--  3. accept_invite(token)        REPLACED: now bound to the invited address. The
--                                 caller's getfunded.users.email must equal the
--                                 invite's email (citext, case-insensitive) or the
--                                 door raises 'invite_wrong_email'. Before this a
--                                 forwarded or leaked link joined whoever opened it.
--
--  4. daily_maintenance(..)       A three-argument overload whose return table gains
--                                 `ledger_reaped`: it also refunds usage_ledger rows
--                                 left 'reserved' longer than the window (a function
--                                 killed mid-call never settled them), with
--                                 meta.reaped = true so the usage page can tell them
--                                 apart. The 0009 two-argument door is re-pointed at
--                                 it with a one-hour window. A reservation that old is
--                                 never still in flight: the AI routes cap at 300 s.
--
-- No new tables, no new flags, no data rewrite.

-- Note on types: these doors take and return `text`, not `citext`, and compare
-- with lower(). Their search_path is pinned to `getfunded, pg_temp`, so the
-- citext type (schema `extensions` on Supabase, `public` elsewhere) cannot be
-- named inside them without hard-coding a schema. lower() on both sides gives
-- the same case-insensitive match the citext columns give everywhere else.

-- ---------------------------------------------------------------------------
-- 1. has_pending_invite
-- ---------------------------------------------------------------------------
create or replace function getfunded.has_pending_invite(p_email text)
returns boolean
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
begin
  if p_email is null or btrim(p_email) = '' then
    return false;
  end if;
  return exists (
    select 1 from getfunded.invites i
    where lower(i.email::text) = lower(btrim(p_email))
      and i.accepted_at is null
      and i.expires_at > now()
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2. invite_preview
-- ---------------------------------------------------------------------------
create or replace function getfunded.invite_preview(token text)
returns table (email text, workspace_name text, role text, status text)
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_uid uuid := getfunded.current_user_id();
begin
  if v_uid is null then
    raise exception 'invite_preview: not signed in' using errcode = '28000';
  end if;
  if token is null or btrim(token) = '' then
    return;
  end if;
  return query
    select i.email::text,
           w.name,
           i.role,
           case
             when i.accepted_at is not null then 'used'
             when i.expires_at <= now() then 'expired'
             else 'pending'
           end
    from getfunded.invites i
    join getfunded.workspaces w on w.id = i.workspace_id
    where i.token_hash = getfunded.hash_token(token);
end $$;

-- ---------------------------------------------------------------------------
-- 3. accept_invite, bound to the invited email
-- ---------------------------------------------------------------------------
create or replace function getfunded.accept_invite(token text)
returns uuid
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_uid   uuid := getfunded.current_user_id();
  v_inv   getfunded.invites%rowtype;
  v_email text;
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

  -- The invitation names an address. Only an account signed in with that
  -- address may accept it (case-insensitive, like the citext columns). The
  -- row stays pending so the right account can still use it.
  select u.email::text into v_email from getfunded.users u where u.id = v_uid;
  if v_email is null or lower(v_email) <> lower(v_inv.email::text) then
    raise exception 'invite_wrong_email'
      using hint = 'Sign in with the address the invitation was sent to.';
  end if;

  insert into getfunded.members (workspace_id, user_id, role, invited_by)
  values (v_inv.workspace_id, v_uid, v_inv.role, v_inv.invited_by)
  on conflict (workspace_id, user_id) do nothing;

  update getfunded.invites set accepted_at = now() where id = v_inv.id;

  return v_inv.workspace_id;
end $$;

-- ---------------------------------------------------------------------------
-- 4. daily_maintenance with the ledger reaper
-- ---------------------------------------------------------------------------
-- A THIRD argument and a third output column cannot be added to the 0009 door
-- in place: `create or replace` may not change a return type, and dropping the
-- function would make a replay of 0009 fail. So this is a new three-argument
-- overload (no defaults, so `daily_maintenance()` and the two-argument form
-- stay unambiguous), and the two-argument door below is re-pointed at it with
-- a one-hour reservation window. Both reap; the cron calls the three-argument
-- form and reads `ledger_reaped`.
create or replace function getfunded.daily_maintenance(
  p_event_retention         interval,
  p_stale_send_after        interval,
  p_stale_reservation_after interval
) returns table (events_pruned bigint, sends_failed bigint, ledger_reaped bigint)
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_pruned bigint := 0;
  v_failed bigint := 0;
  v_reaped bigint := 0;
begin
  if p_event_retention is null or p_event_retention < interval '30 days' then
    raise exception 'daily_maintenance: event retention must be at least 30 days';
  end if;
  if p_stale_send_after is null or p_stale_send_after < interval '5 minutes' then
    raise exception 'daily_maintenance: stale send window must be at least 5 minutes';
  end if;
  -- Must outlast any AI route (maxDuration 300 s) or a live call would be reaped.
  if p_stale_reservation_after is null or p_stale_reservation_after < interval '10 minutes' then
    raise exception 'daily_maintenance: stale reservation window must be at least 10 minutes';
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

  -- Reservations a killed function never settled: give the credits back and
  -- mark the row so the cost report can exclude it. The settle columns are
  -- the only ones touched, the same ones the app may update.
  update getfunded.usage_ledger l
     set status     = 'refunded',
         settled_at = now(),
         meta       = coalesce(l.meta, '{}'::jsonb) || jsonb_build_object('reaped', true, 'reaped_by', 'cron:daily')
   where l.status = 'reserved'
     and l.created_at < now() - p_stale_reservation_after;
  get diagnostics v_reaped = row_count;

  insert into getfunded.events (name, props)
  values ('cron:daily', jsonb_build_object('events_pruned', v_pruned, 'sends_failed', v_failed, 'ledger_reaped', v_reaped));

  events_pruned := v_pruned;
  sends_failed  := v_failed;
  ledger_reaped := v_reaped;
  return next;
end $$;

-- The 0009 door keeps its signature and return table; it now delegates, so a
-- caller of `daily_maintenance()` gets the reaper too (one-hour window).
create or replace function getfunded.daily_maintenance(
  p_event_retention  interval default interval '12 months',
  p_stale_send_after interval default interval '1 hour'
) returns table (events_pruned bigint, sends_failed bigint)
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
begin
  return query
    select d.events_pruned, d.sends_failed
    from getfunded.daily_maintenance(p_event_retention, p_stale_send_after, interval '1 hour') d;
end $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- @roles-begin
revoke all on function getfunded.has_pending_invite(text) from public;
revoke all on function getfunded.invite_preview(text) from public;
revoke all on function getfunded.accept_invite(text) from public;
revoke all on function getfunded.daily_maintenance(interval, interval, interval) from public;

grant execute on function getfunded.has_pending_invite(text) to getfunded_app;
grant execute on function getfunded.invite_preview(text) to getfunded_app;
grant execute on function getfunded.accept_invite(text) to getfunded_app;
grant execute on function getfunded.daily_maintenance(interval, interval, interval) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification:
--   begin; set local role getfunded_app;
--     select getfunded.has_pending_invite('invited@example.org');          -- true while pending
--     select set_config('app.user_id', '<other uuid>', true);
--     select getfunded.accept_invite('<token sent to invited@example.org>'); -- MUST fail (invite_wrong_email)
--     select * from getfunded.invite_preview('<token>');                   -- email, workspace, role, 'pending'
--     select * from getfunded.daily_maintenance(interval '12 months', interval '1 hour', interval '1 hour');
--                                                                          -- (0, 0, 0) on a quiet day
--     select * from getfunded.daily_maintenance();                         -- (0, 0): the 0009 shape, same work
--   rollback;
