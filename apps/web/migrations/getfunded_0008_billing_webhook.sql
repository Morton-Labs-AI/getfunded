-- getfunded_0008_billing_webhook.sql
--
-- Two SECURITY DEFINER doors for code paths that run with no signed-in user,
-- where Row Level Security would otherwise block every write:
--
--   getfunded.apply_subscription(...)  the Stripe webhook (app/api/webhooks/stripe)
--   getfunded.verify_api_key(hash)     public API key authentication (lib/api/keys.ts)
--
-- plus a partial unique index on getfunded.events so one Stripe event id is
-- recorded exactly once ('stripe:' || event.id), which is what makes webhook
-- redelivery idempotent.
--
-- Depends on: getfunded.workspaces, getfunded.subscriptions, getfunded.events,
-- getfunded.api_keys (earlier migrations). Owned by postgres; EXECUTE granted
-- to getfunded_app only. search_path is pinned empty, so every reference is
-- schema-qualified.

-- 1. Idempotency key for Stripe deliveries ---------------------------------

create unique index if not exists ux_events_stripe_event_name
  on getfunded.events (name)
  where name like 'stripe:%';

-- 2. apply_subscription ----------------------------------------------------
--
-- One call per Stripe event. Parameters:
--   p_event_name              'stripe:' || event.id; recorded in getfunded.events first.
--                             A second delivery returns outcome 'duplicate' and changes nothing.
--                             null skips the idempotency check (internal/admin use).
--   p_workspace_id            from checkout metadata / client_reference_id when known, else null:
--                             the workspace is then found by stripe_customer_id, then by
--                             stripe_subscription_id.
--   p_stripe_customer_id      written to workspaces.stripe_customer_id when still null.
--   p_stripe_subscription_id  null for events that carry no subscription (nothing is upserted then).
--   p_plan                    'starter' | 'pro' | 'team' | 'enterprise' resolved from the Stripe
--                             price id by the app; null keeps the stored plan (invoice.payment_failed).
--   p_status                  'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid'; null keeps.
--   p_current_period_start/end, p_cancel_at_period_end, p_raw   null keeps the stored value.
--   p_props                   telemetry props stored on the events row.
--
-- Effect: upsert getfunded.subscriptions (pk workspace_id) and set
-- workspaces.plan = the paid plan while status is trialing/active/past_due,
-- 'free' otherwise. billing_anchor_day follows the Stripe period start day
-- (1 when the workspace falls back to free). A canceled/unpaid event for a
-- subscription id that is NOT the workspace's current, entitled one is
-- reported as 'stale' and ignored, so an old subscription's final events
-- cannot downgrade a workspace that re-subscribed.
--
-- Returns one row: (outcome, workspace_id, plan) with outcome in
-- 'applied' | 'duplicate' | 'unknown_workspace' | 'stale'.

create or replace function getfunded.apply_subscription(
  p_event_name text,
  p_workspace_id uuid,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_plan text,
  p_status text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_raw jsonb,
  p_props jsonb default '{}'::jsonb
) returns table (outcome text, workspace_id uuid, plan text)
language plpgsql
security definer
set search_path = ''
as $$
-- The output columns (outcome, workspace_id, plan) share names with table
-- columns; every local variable is v_/p_-prefixed, so an ambiguous name is
-- always the column.
#variable_conflict use_column
declare
  v_ws              uuid;
  v_existing_sub    text;
  v_existing_status text;
  v_existing_plan   text;
  v_plan            text;
  v_status          text;
  v_effective       text;
  v_anchor          smallint;
begin
  if p_status is not null
     and p_status not in ('trialing', 'active', 'past_due', 'canceled', 'unpaid') then
    raise exception 'apply_subscription: invalid status %', p_status
      using errcode = '22023';
  end if;
  if p_plan is not null
     and p_plan not in ('starter', 'pro', 'team', 'enterprise') then
    raise exception 'apply_subscription: invalid plan %', p_plan
      using errcode = '22023';
  end if;

  -- Resolve the workspace: explicit id, then customer, then subscription.
  v_ws := p_workspace_id;
  if v_ws is null and p_stripe_customer_id is not null then
    select w.id into v_ws
    from getfunded.workspaces w
    where w.stripe_customer_id = p_stripe_customer_id
    limit 1;
  end if;
  if v_ws is null and p_stripe_subscription_id is not null then
    select s.workspace_id into v_ws
    from getfunded.subscriptions s
    where s.stripe_subscription_id = p_stripe_subscription_id
    limit 1;
  end if;

  -- Idempotency: record the delivery first. A duplicate stops here.
  if p_event_name is not null then
    insert into getfunded.events (workspace_id, name, props)
    values (v_ws, p_event_name, coalesce(p_props, '{}'::jsonb))
    on conflict (name) where name like 'stripe:%' do nothing;
    if not found then
      return query select 'duplicate'::text, v_ws, null::text;
      return;
    end if;
  end if;

  if v_ws is null then
    return query select 'unknown_workspace'::text, null::uuid, null::text;
    return;
  end if;

  select s.stripe_subscription_id, s.status, s.plan
    into v_existing_sub, v_existing_status, v_existing_plan
  from getfunded.subscriptions s
  where s.workspace_id = v_ws;

  -- A terminal event for a subscription that is no longer the current one.
  if v_existing_sub is not null
     and p_stripe_subscription_id is not null
     and v_existing_sub <> p_stripe_subscription_id
     and p_status in ('canceled', 'unpaid')
     and v_existing_status in ('trialing', 'active', 'past_due') then
    return query select 'stale'::text, v_ws, v_existing_plan;
    return;
  end if;

  v_plan   := coalesce(p_plan, v_existing_plan);
  v_status := coalesce(p_status, v_existing_status, 'active');

  if p_stripe_subscription_id is not null then
    insert into getfunded.subscriptions
      (workspace_id, stripe_subscription_id, plan, status,
       current_period_start, current_period_end, cancel_at_period_end, raw)
    values
      (v_ws, p_stripe_subscription_id, coalesce(v_plan, 'free'), v_status,
       p_current_period_start, p_current_period_end,
       coalesce(p_cancel_at_period_end, false), coalesce(p_raw, '{}'::jsonb))
    on conflict (workspace_id) do update set
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan                   = coalesce(p_plan, getfunded.subscriptions.plan),
      status                 = v_status,
      current_period_start   = coalesce(p_current_period_start, getfunded.subscriptions.current_period_start),
      current_period_end     = coalesce(p_current_period_end, getfunded.subscriptions.current_period_end),
      cancel_at_period_end   = coalesce(p_cancel_at_period_end, getfunded.subscriptions.cancel_at_period_end),
      raw                    = coalesce(p_raw, getfunded.subscriptions.raw);
  end if;

  if v_status in ('trialing', 'active', 'past_due') and v_plan is not null then
    v_effective := v_plan;
  else
    v_effective := 'free';
  end if;

  v_anchor := case
    when v_effective <> 'free' and p_current_period_start is not null
      then extract(day from (p_current_period_start at time zone 'UTC'))::smallint
    else null
  end;

  update getfunded.workspaces w
  set plan               = v_effective,
      stripe_customer_id = coalesce(w.stripe_customer_id, p_stripe_customer_id),
      billing_anchor_day = case
                             when v_effective = 'free' then 1
                             else coalesce(v_anchor, w.billing_anchor_day, 1)
                           end,
      version            = w.version + 1
  where w.id = v_ws;

  return query select 'applied'::text, v_ws, v_effective;
  return;
end
$$;

-- @roles-begin
revoke all on function getfunded.apply_subscription(
  text, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, jsonb
) from public;
grant execute on function getfunded.apply_subscription(
  text, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, jsonb
) to getfunded_app;
-- @roles-end

comment on function getfunded.apply_subscription(
  text, uuid, text, text, text, text, timestamptz, timestamptz, boolean, jsonb, jsonb
) is 'Stripe webhook door: records the event id (idempotent), upserts subscriptions and sets workspaces.plan. Called by lib/billing/webhook.ts as the system.';

-- 3. verify_api_key --------------------------------------------------------
--
-- Looks up an unrevoked key by SHA-256 hash for a live workspace, touches
-- last_used_at at most once a minute (keeps the hot path cheap), and returns
-- what the app needs to authorise the request: key id, workspace, name,
-- scopes, the creating member (API routes run withUser(created_by) so RLS
-- applies) and the workspace plan (the app checks `can(plan, 'api')`).
-- Returns zero rows for an unknown or revoked key.

create or replace function getfunded.verify_api_key(p_hash text)
returns table (
  id uuid,
  workspace_id uuid,
  name text,
  scopes text[],
  created_by uuid,
  plan text
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_key_id uuid;
begin
  if p_hash is null or length(p_hash) <> 64 then
    return;
  end if;

  select k.id into v_key_id
  from getfunded.api_keys k
  join getfunded.workspaces w on w.id = k.workspace_id
  where k.key_hash = p_hash
    and k.revoked_at is null
    and w.deleted_at is null;

  if v_key_id is null then
    return;
  end if;

  update getfunded.api_keys k
  set last_used_at = now()
  where k.id = v_key_id
    and (k.last_used_at is null or k.last_used_at < now() - interval '1 minute');

  return query
    select k.id, k.workspace_id, k.name, k.scopes, k.created_by, w.plan
    from getfunded.api_keys k
    join getfunded.workspaces w on w.id = k.workspace_id
    where k.id = v_key_id;
  return;
end
$$;

-- @roles-begin
revoke all on function getfunded.verify_api_key(text) from public;
grant execute on function getfunded.verify_api_key(text) to getfunded_app;
-- @roles-end

comment on function getfunded.verify_api_key(text)
  is 'API key door: hash -> key id, workspace, scopes, creator, plan; touches last_used_at. Called by lib/api/keys.ts with no user context.';
