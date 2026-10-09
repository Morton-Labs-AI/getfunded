-- getfunded_0016: notifications, and the door that turns funder signals into them.
--
-- WHY. Corpus migration 0032 gives the database dated, sourced funder news
-- (internal.funder_signals, read by this app since getfunded_0015). News is
-- only useful if it reaches the person it concerns while it is still news.
-- This file adds:
--
--   notifications             one row per person per thing worth their
--                             attention; today one kind of thing, a funder
--                             signal. Read state is per person.
--   notification_preferences  per person per workspace: alerts on saved
--                             funders, discovery alerts (funders you have NOT
--                             saved whose news matches your profile), the
--                             score floor, and an e-mail digest cadence that
--                             the app records but does not yet send.
--   signal_cursors            per workspace: the last signal id the door has
--                             looked at. Idempotent re-runs, no re-notifying.
--   signal_sector_keywords    reference rows: which words in a workspace's
--                             program areas and keywords map to which corpus
--                             sector. Data, so a steward can tune it.
--   sync_signal_notifications(p_limit, p_discovery_for_all)
--                             the SECURITY DEFINER door the scheduler calls
--                             with no user (/api/cron/signals).
--
-- RELEVANCE IS A SCORE WITH REASONS, NOT A FEELING. For every new published
-- signal and every organization it is about, each workspace gets a score:
--
--   +50  the organization is on the workspace's saved list (archived rows
--        do not count)               reason 'saved'
--   +15  and this member owns it     reason 'owner'   (per member)
--   +20  the signal says nonprofits are eligible          reason 'eligible'
--   +15  a signal sector matches the workspace's program areas or keywords
--        through signal_sector_keywords                   reason 'sector'
--   +10  the signal is actionable: a new commitment, program, open call,
--        deadline or strategy change                      reason 'actionable'
--    +5  the stated amount is $10M or more                reason 'amount'
--    +5  a stated geography names the workspace's state   reason 'geography'
--
-- A saved funder notifies when the score reaches the member's floor (default
-- 50, so a save alone is enough). An unsaved funder is a DISCOVERY and needs
-- 40 without the save: eligibility plus a sector match plus something
-- actionable or large. Discovery alerts are a paid feature (docs/PLANS.md):
-- the door takes p_discovery_for_all so a self-install (SELF_HOSTED=true,
-- where every workspace reads as Unlimited in the app but 'free' in the
-- column) gets them too. The reasons are stored on the row so the bell can
-- say why, in words, and nobody has to re-derive the score.
--
-- The door writes notifications and, for saved funders, one `system`
-- activity on the funder ("Signal: <headline>"), so the signal is part of the
-- funder's history, not only of the bell. Both inserts are allowed ONLY
-- inside the door: the insert policies check the transaction-local setting
-- app.door = 'sync_signal_notifications', which the door sets and nothing
-- else can (the app role has no INSERT grant on notifications at all).
--
-- WHAT THIS FILE DOES NOT DO. It does not send e-mail. email_digest is
-- recorded so the preference exists before the sender does; the digest
-- builder reads it when there is a transactional sender in the app (there is
-- none today: outreach goes through the user's own Gmail, and that is not a
-- channel for system mail).

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------
create table if not exists getfunded.notifications (
  id              bigserial   primary key,
  workspace_id    uuid        not null references getfunded.workspaces(id) on delete cascade,
  user_id         uuid        not null references getfunded.users(id) on delete cascade,
  kind            text        not null
                  constraint ck_notifications_kind
                  check (kind in ('funder_signal', 'signal_discovery', 'system')),
  signal_id       bigint,                           -- soft ref: internal.funder_signals.id
  org_id          uuid,                             -- soft corpus ref
  saved_funder_id uuid        references getfunded.saved_funders(id) on delete set null,
  title           text        not null,
  body            text,
  href            text        not null,
  score           smallint    not null default 0,
  reasons         jsonb       not null default '[]'::jsonb
                  constraint ck_notifications_reasons check (jsonb_typeof(reasons) = 'array'),
  read_at         timestamptz,
  dismissed_at    timestamptz,
  created_at      timestamptz not null default now()
);
-- One notification per person per signal (NULL signal_id rows are not deduplicated).
create unique index if not exists uq_notifications_user_signal
  on getfunded.notifications (user_id, signal_id) where signal_id is not null;
create index if not exists ix_notifications_user_unread
  on getfunded.notifications (user_id, created_at desc) where read_at is null;
create index if not exists ix_notifications_user
  on getfunded.notifications (user_id, created_at desc);
create index if not exists ix_notifications_ws
  on getfunded.notifications (workspace_id, created_at desc);

alter table getfunded.notifications enable row level security;
alter table getfunded.notifications force row level security;

drop policy if exists p_notifications_select on getfunded.notifications;
create policy p_notifications_select on getfunded.notifications for select
  using (user_id = getfunded.current_user_id() and getfunded.is_member(workspace_id));
drop policy if exists p_notifications_update on getfunded.notifications;
create policy p_notifications_update on getfunded.notifications for update
  using (user_id = getfunded.current_user_id())
  with check (user_id = getfunded.current_user_id());
drop policy if exists p_notifications_insert_door on getfunded.notifications;
create policy p_notifications_insert_door on getfunded.notifications for insert
  with check (current_setting('app.door', true) = 'sync_signal_notifications');

-- The door also writes a system activity on the saved funder. A second insert
-- policy (policies are OR-ed) lets it, and only it, insert without a user.
drop policy if exists p_activities_insert_door on getfunded.activities;
create policy p_activities_insert_door on getfunded.activities for insert
  with check (current_setting('app.door', true) = 'sync_signal_notifications');

-- ---------------------------------------------------------------------------
-- notification_preferences
-- ---------------------------------------------------------------------------
create table if not exists getfunded.notification_preferences (
  workspace_id     uuid        not null references getfunded.workspaces(id) on delete cascade,
  user_id          uuid        not null references getfunded.users(id) on delete cascade,
  signal_alerts    boolean     not null default true,
  discovery_alerts boolean     not null default true,
  min_score        smallint    not null default 50
                   constraint ck_notification_prefs_score check (min_score between 0 and 100),
  email_digest     text        not null default 'off'
                   constraint ck_notification_prefs_digest check (email_digest in ('off', 'daily', 'weekly')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  version          int         not null default 1,
  primary key (workspace_id, user_id)
);

drop trigger if exists trg_notification_prefs_updated on getfunded.notification_preferences;
create trigger trg_notification_prefs_updated before update on getfunded.notification_preferences
  for each row execute function getfunded.set_updated_at();

alter table getfunded.notification_preferences enable row level security;
alter table getfunded.notification_preferences force row level security;

drop policy if exists p_notification_prefs_select on getfunded.notification_preferences;
create policy p_notification_prefs_select on getfunded.notification_preferences for select
  using (user_id = getfunded.current_user_id() and getfunded.is_member(workspace_id));
drop policy if exists p_notification_prefs_insert on getfunded.notification_preferences;
create policy p_notification_prefs_insert on getfunded.notification_preferences for insert
  with check (user_id = getfunded.current_user_id() and getfunded.is_member(workspace_id));
drop policy if exists p_notification_prefs_update on getfunded.notification_preferences;
create policy p_notification_prefs_update on getfunded.notification_preferences for update
  using (user_id = getfunded.current_user_id())
  with check (user_id = getfunded.current_user_id() and getfunded.is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- signal_cursors (written by the door only)
-- ---------------------------------------------------------------------------
create table if not exists getfunded.signal_cursors (
  workspace_id   uuid        primary key references getfunded.workspaces(id) on delete cascade,
  last_signal_id bigint      not null default 0,
  last_run_at    timestamptz,
  updated_at     timestamptz not null default now()
);

alter table getfunded.signal_cursors enable row level security;
alter table getfunded.signal_cursors force row level security;

drop policy if exists p_signal_cursors_select on getfunded.signal_cursors;
create policy p_signal_cursors_select on getfunded.signal_cursors for select
  using (getfunded.is_member(workspace_id));
drop policy if exists p_signal_cursors_door on getfunded.signal_cursors;
create policy p_signal_cursors_door on getfunded.signal_cursors for all
  using (current_setting('app.door', true) = 'sync_signal_notifications')
  with check (current_setting('app.door', true) = 'sync_signal_notifications');

-- ---------------------------------------------------------------------------
-- signal_sector_keywords: reference data. A keyword is matched case-
-- insensitively as a substring of each program area and keyword in
-- workspaces.profile. Sector values are the corpus vocabulary (0032).
-- ---------------------------------------------------------------------------
create table if not exists getfunded.signal_sector_keywords (
  sector  text not null,
  keyword text not null,
  primary key (sector, keyword)
);

alter table getfunded.signal_sector_keywords enable row level security;
alter table getfunded.signal_sector_keywords force row level security;
drop policy if exists p_signal_sector_keywords_select on getfunded.signal_sector_keywords;
create policy p_signal_sector_keywords_select on getfunded.signal_sector_keywords for select using (true);

insert into getfunded.signal_sector_keywords (sector, keyword) values
  ('climate', 'climate'), ('climate', 'carbon'), ('climate', 'emission'), ('climate', 'resilience'),
  ('clean_energy', 'clean energy'), ('clean_energy', 'renewable'), ('clean_energy', 'solar'),
  ('clean_energy', 'energy transition'), ('clean_energy', 'decarboni'), ('clean_energy', 'energy'),
  ('nuclear_energy', 'nuclear'), ('nuclear_energy', 'fusion'), ('nuclear_energy', 'fission'),
  ('environment_conservation', 'conservation'), ('environment_conservation', 'environment'),
  ('environment_conservation', 'biodiversity'), ('environment_conservation', 'water'),
  ('health', 'health'), ('health', 'medical'), ('health', 'hospital'), ('health', 'mental'),
  ('health', 'organ'), ('health', 'donor'), ('health', 'patient'),
  ('education', 'education'), ('education', 'school'), ('education', 'student'), ('education', 'literacy'),
  ('housing', 'housing'), ('housing', 'homeless'), ('housing', 'shelter'),
  ('economic_opportunity', 'economic'), ('economic_opportunity', 'workforce'), ('economic_opportunity', 'jobs'),
  ('economic_opportunity', 'small business'), ('economic_opportunity', 'financial'),
  ('journalism_media', 'journalism'), ('journalism_media', 'news'), ('journalism_media', 'media'),
  ('democracy_civic', 'democracy'), ('democracy_civic', 'civic'), ('democracy_civic', 'voting'),
  ('arts_culture', 'arts'), ('arts_culture', 'culture'), ('arts_culture', 'museum'), ('arts_culture', 'music'),
  ('science_research', 'research'), ('science_research', 'science'), ('science_research', 'laboratory'),
  ('criminal_justice', 'justice'), ('criminal_justice', 'incarcerat'), ('criminal_justice', 'reentry'),
  ('international_development', 'international'), ('international_development', 'global'),
  ('international_development', 'humanitarian'),
  ('human_services', 'food'), ('human_services', 'hunger'), ('human_services', 'family'),
  ('human_services', 'youth'), ('human_services', 'senior'), ('human_services', 'disabilit')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The door.
-- ---------------------------------------------------------------------------
create or replace function getfunded.sync_signal_notifications(
  p_limit             int,
  p_discovery_for_all boolean
) returns table (workspaces_scanned int, signals_seen int, notifications_created int, activities_logged int)
language plpgsql security definer
set search_path = getfunded, pg_temp
as $$
declare
  v_ws      record;
  v_max     bigint;
  v_from    bigint;
  v_to      bigint;
  v_n       int;
  v_ws_n    int := 0;
  v_signals int := 0;
  v_notes   int := 0;
  v_acts    int := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'sync_signal_notifications: p_limit must be between 1 and 5000';
  end if;
  workspaces_scanned := 0; signals_seen := 0; notifications_created := 0; activities_logged := 0;

  -- No corpus (a web-only install, the PGlite harness): nothing to do, no error.
  if to_regclass('internal.funder_signals') is null then
    return next; return;
  end if;

  perform set_config('app.door', 'sync_signal_notifications', true);

  execute 'select max(id) from internal.funder_signals where status = ''published''' into v_max;
  if v_max is null then
    return next; return;
  end if;

  for v_ws in
    select w.id, w.plan, w.profile from getfunded.workspaces w where w.deleted_at is null order by w.created_at
  loop
    v_ws_n := v_ws_n + 1;

    -- A workspace's first run starts 30 days back, not at the beginning of time.
    if not exists (select 1 from getfunded.signal_cursors c where c.workspace_id = v_ws.id) then
      execute $q$
        select coalesce(max(id), 0) from internal.funder_signals
        where status = 'published'
          and coalesce(reviewed_at, discovered_at) < now() - interval '30 days'
      $q$ into v_from;
      insert into getfunded.signal_cursors (workspace_id, last_signal_id) values (v_ws.id, v_from)
      on conflict (workspace_id) do nothing;
    end if;
    select c.last_signal_id into v_from from getfunded.signal_cursors c where c.workspace_id = v_ws.id;

    execute $q$
      select coalesce(max(t.id), $1) from (
        select id from internal.funder_signals
        where status = 'published' and id > $1 and id <= $2
        order by id limit $3
      ) t
    $q$ into v_to using v_from, v_max, p_limit;

    if v_to > v_from then
      execute $q$
        with sig as (
          select s.id, s.headline, s.summary, s.signal_type, s.amount_usd,
                 s.eligible_recipients, s.sectors, s.geographies,
                 so.org_id, o.name as org_name
          from internal.funder_signals s
          join internal.funder_signal_orgs so on so.signal_id = s.id and so.role = 'subject'
          join internal.organizations o on o.id = so.org_id
          where s.status = 'published' and s.id > $2 and s.id <= $3
        ),
        ws_terms as (
          select lower(t) as term
          from jsonb_array_elements_text(
                 coalesce(case when jsonb_typeof($4->'program_areas') = 'array' then $4->'program_areas' end, '[]'::jsonb)
                 || coalesce(case when jsonb_typeof($4->'keywords') = 'array' then $4->'keywords' end, '[]'::jsonb)
               ) t
        ),
        ws_sectors as (
          select distinct k.sector
          from getfunded.signal_sector_keywords k
          where exists (select 1 from ws_terms t where t.term like '%' || lower(k.keyword) || '%')
        ),
        scored as (
          select sig.*, sf.id as saved_funder_id, sf.owner_id,
            (case when sf.id is not null then 50 else 0 end)
            + (case when 'nonprofit' = any(sig.eligible_recipients) then 20 else 0 end)
            + (case when exists (select 1 from ws_sectors x where x.sector = any(sig.sectors)) then 15 else 0 end)
            + (case when sig.signal_type in ('capital_commitment','program_launch','rfp_open','deadline','strategy_shift') then 10 else 0 end)
            + (case when sig.amount_usd >= 10000000 then 5 else 0 end)
            + (case when nullif($4->>'state', '') is not null
                         and exists (select 1 from unnest(sig.geographies) g where g ilike '%' || ($4->>'state') || '%')
                    then 5 else 0 end) as base_score,
            (case when sf.id is not null then jsonb_build_array(jsonb_build_object('code','saved','label','On your saved list')) else '[]'::jsonb end)
            || (case when 'nonprofit' = any(sig.eligible_recipients) then jsonb_build_array(jsonb_build_object('code','eligible','label','Nonprofits are eligible')) else '[]'::jsonb end)
            || (case when exists (select 1 from ws_sectors x where x.sector = any(sig.sectors)) then jsonb_build_array(jsonb_build_object('code','sector','label','Matches your program areas')) else '[]'::jsonb end)
            || (case when sig.signal_type in ('capital_commitment','program_launch','rfp_open','deadline','strategy_shift') then jsonb_build_array(jsonb_build_object('code','actionable','label','Something to act on')) else '[]'::jsonb end)
            || (case when sig.amount_usd >= 10000000 then jsonb_build_array(jsonb_build_object('code','amount','label','$10M or more')) else '[]'::jsonb end)
            || (case when nullif($4->>'state', '') is not null
                          and exists (select 1 from unnest(sig.geographies) g where g ilike '%' || ($4->>'state') || '%')
                     then jsonb_build_array(jsonb_build_object('code','geography','label','Names your state')) else '[]'::jsonb end) as reasons
          from sig
          left join getfunded.saved_funders sf
            on sf.workspace_id = $1 and sf.org_id = sig.org_id and sf.archived_at is null
        ),
        inserted as (
          insert into getfunded.notifications
            (workspace_id, user_id, kind, signal_id, org_id, saved_funder_id, title, body, href, score, reasons)
          select $1, m.user_id,
                 case when sc.saved_funder_id is not null then 'funder_signal' else 'signal_discovery' end,
                 sc.id, sc.org_id, sc.saved_funder_id,
                 sc.org_name || ': ' || coalesce(sc.headline, 'a new announcement'),
                 sc.summary,
                 '/app/funders/' || sc.org_id::text || '#signals',
                 sc.base_score + case when sc.owner_id is not null and sc.owner_id = m.user_id then 15 else 0 end,
                 sc.reasons || case when sc.owner_id is not null and sc.owner_id = m.user_id
                                    then jsonb_build_array(jsonb_build_object('code','owner','label','You own this funder'))
                                    else '[]'::jsonb end
          from scored sc
          join getfunded.members m on m.workspace_id = $1
          left join getfunded.notification_preferences p on p.workspace_id = $1 and p.user_id = m.user_id
          where coalesce(p.signal_alerts, true)
            and (
              (sc.saved_funder_id is not null
                and sc.base_score + case when sc.owner_id is not null and sc.owner_id = m.user_id then 15 else 0 end
                    >= coalesce(p.min_score, 50))
              or
              (sc.saved_funder_id is null
                and coalesce(p.discovery_alerts, true)
                and ($6 or $5 <> 'free')
                and sc.base_score >= 40)
            )
          on conflict do nothing
          returning 1
        )
        select count(*) from inserted
      $q$ into v_n using v_ws.id, v_from, v_to, v_ws.profile, v_ws.plan, p_discovery_for_all;
      v_notes := v_notes + v_n;

      -- One system activity per saved funder per signal: the signal joins the funder's history.
      execute $q$
        with sig as (
          select s.id, s.headline, s.url, s.signal_type, s.published_at, so.org_id
          from internal.funder_signals s
          join internal.funder_signal_orgs so on so.signal_id = s.id and so.role = 'subject'
          where s.status = 'published' and s.id > $2 and s.id <= $3
        ),
        inserted as (
          insert into getfunded.activities (workspace_id, saved_funder_id, kind, body, occurred_at, created_by, meta)
          select $1, sf.id, 'system',
                 'Signal: ' || coalesce(sig.headline, 'a new announcement'),
                 now(), null,
                 jsonb_build_object('kind', 'funder_signal', 'signal_id', sig.id, 'url', sig.url,
                                    'signal_type', sig.signal_type, 'published_at', sig.published_at)
          from sig
          join getfunded.saved_funders sf on sf.workspace_id = $1 and sf.org_id = sig.org_id and sf.archived_at is null
          where not exists (
            select 1 from getfunded.activities a
            where a.saved_funder_id = sf.id and a.kind = 'system' and (a.meta->>'signal_id') = sig.id::text)
          returning 1
        )
        select count(*) from inserted
      $q$ into v_n using v_ws.id, v_from, v_to;
      v_acts := v_acts + v_n;

      execute 'select count(*) from internal.funder_signals where status = ''published'' and id > $1 and id <= $2'
        into v_n using v_from, v_to;
      v_signals := v_signals + v_n;
    end if;

    update getfunded.signal_cursors c
       set last_signal_id = greatest(c.last_signal_id, v_to), last_run_at = now(), updated_at = now()
     where c.workspace_id = v_ws.id;
  end loop;

  insert into getfunded.events (name, props)
  values ('cron:signals', jsonb_build_object('workspaces', v_ws_n, 'signals', v_signals,
                                              'notifications', v_notes, 'activities', v_acts));

  workspaces_scanned := v_ws_n; signals_seen := v_signals;
  notifications_created := v_notes; activities_logged := v_acts;
  return next;
end $$;

-- @roles-begin
grant select, update (read_at, dismissed_at) on getfunded.notifications to getfunded_app;
grant usage, select on sequence getfunded.notifications_id_seq to getfunded_app;
grant select, insert, update on getfunded.notification_preferences to getfunded_app;
grant select on getfunded.signal_cursors to getfunded_app;
grant select on getfunded.signal_sector_keywords to getfunded_app;
revoke all on function getfunded.sync_signal_notifications(int, boolean) from public;
grant execute on function getfunded.sync_signal_notifications(int, boolean) to getfunded_app;
-- @roles-end

-- ---------------------------------------------------------------------------
-- Verification (by hand):
--   -- as getfunded_login, with app.user_id set to a member:
--   insert into getfunded.notifications (workspace_id, user_id, kind, title, href)
--     values ('<ws>', '<me>', 'system', 't', '/app');                     -- MUST fail (no grant, no policy)
--   update getfunded.notifications set read_at = now() where user_id = '<me>'; -- ok
--   update getfunded.notifications set title = 'x';                       -- MUST fail (column grant)
--   select * from getfunded.sync_signal_notifications(500, false);        -- one row of counts
--   select * from getfunded.sync_signal_notifications(500, false);        -- second run: 0 notifications
--   -- publish one more corpus signal for a saved org, run again: 1 per member.
--
-- Undo:
--   drop function getfunded.sync_signal_notifications(int, boolean);
--   drop policy p_activities_insert_door on getfunded.activities;
--   drop table getfunded.signal_sector_keywords, getfunded.signal_cursors,
--     getfunded.notification_preferences, getfunded.notifications;
--   delete from getfunded.schema_migrations where filename = 'getfunded_0016_notifications.sql';
-- ---------------------------------------------------------------------------
