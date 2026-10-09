-- 0032: funder signals — dated, sourced news about a funder, linked to its org.
--
-- WHY. Filings are a lagging indicator: a 990-PF describes what a foundation
-- did eighteen months ago. A press release is a leading indicator: on
-- 2026-10 the MacArthur Foundation announced it was dedicating $750 million
-- to impact investments, serving both nonprofits (grants, PRIs) and for-profit
-- companies (MRIs). Nothing in the corpus could carry that fact, so no app
-- built on it could tell a fundraiser "a funder you track just changed what it
-- funds". This file adds the fact table, the watch list that feeds it, and
-- the org links that let every workspace app join a signal to its own saved
-- funders. Loaded by `funderdb signals ...` (src/funderdb/signals/).
--
-- NUMBERING. open-funder-db (the upstream of this corpus) stops at 0024; this
-- fork carries 0025-0031. This file is 0032 in BOTH repositories so the two
-- never collide on a subtree sync; upstream simply has a gap 0025-0031 until
-- those files are ported (see docs/FUNDER-SIGNALS.md).
--
-- DOCTRINE
--
--   1. Two files, two licences. The row's raw_file_id points at OUR run
--      manifest (licence cc_by: the URL, headline, date, amount and the
--      classification are facts we compiled). snapshot_raw_file_id points at
--      the publisher's page (licence publisher_website, republishable=false).
--      public.funder_signals therefore passes the licensing_map filter like
--      every other public view, while the publisher's expression never does:
--      verbatim excerpts live only in raw_source, which no view selects.
--   2. Nothing is published without a decision. A row is born 'candidate'.
--      It becomes 'published' by a human (the Greenbook admin console, or
--      `funderdb signals publish`) or by the pipeline's explicit
--      `--auto-publish` flag above a confidence floor, and that flag writes
--      reviewed_by = 'model:<id>' so the two are never confused. A model may
--      set 'rejected' only as triage ("this page is not a funding signal"),
--      and a human can reopen it.
--   3. The model classifies; it never invents. Every classified field must be
--      backed by a verbatim excerpt in raw_source.evidence, and amount_usd is
--      NULL unless the page states a dollar figure. summary is our own
--      two-sentence paraphrase and is labelled AI wherever it renders.
--   4. Org links are soft facts with a method. 'source_feed' (the watch list
--      says this newsroom belongs to org X), 'ein' (a human supplied it),
--      'name' (one exact normalized-name match, never more), 'manual',
--      'model' (the classifier named it; lowest confidence). Workspace apps
--      join on org_id and decide for themselves what is relevant.
--   5. The classification vocabulary is a CHECK, not a convention. Apps
--      compare arrays, so a misspelt sector would silently match nothing.

-- ---------------------------------------------------------------------------
-- 1. Watch list: where signals come from.
-- ---------------------------------------------------------------------------
create table if not exists internal.signal_sources (
  id                    bigint generated always as identity
                        constraint pk_signal_sources primary key,
  slug                  text not null
                        constraint uq_signal_sources_slug unique,
  publisher             text not null,
  org_id                uuid
                        constraint fk_signal_sources_org
                        references internal.organizations(id) on delete set null,
  org_ein               char(9)
                        constraint ck_signal_sources_ein check (org_ein is null or org_ein ~ '^[0-9]{9}$'),
  source_kind           text not null
                        constraint ck_signal_sources_kind
                        check (source_kind in ('rss','atom','html_index','manual')),
  url                   text not null,
  link_pattern          text,                 -- html_index: regex a discovered link must match
  fetch_interval_hours  integer not null default 24
                        constraint ck_signal_sources_interval check (fetch_interval_hours >= 1),
  enabled               boolean not null default true,
  last_fetched_at       timestamptz,
  last_status           integer,
  last_etag             text,
  last_modified         text,
  last_error            text,
  notes                 text,
  raw_file_id           bigint not null
                        constraint fk_signal_sources_raw_file references internal.raw_files(id),
  source_record_locator text not null,         -- 'row:slug=<slug>'
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table internal.signal_sources is
  'Newsrooms, press-release indexes and feeds polled by `funderdb signals poll`. org_id is resolved from org_ein at load time; a source with no org still yields candidates, linked later by hand.';

drop trigger if exists trg_signal_sources_updated_at on internal.signal_sources;
create trigger trg_signal_sources_updated_at before update on internal.signal_sources
  for each row execute function internal.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The fact table.
-- ---------------------------------------------------------------------------
create table if not exists internal.funder_signals (
  id                    bigint generated always as identity
                        constraint pk_funder_signals primary key,
  url                   text not null
                        constraint uq_funder_signals_url unique,   -- canonical: no fragment, no utm_*
  source_id             bigint
                        constraint fk_funder_signals_source
                        references internal.signal_sources(id) on delete set null,
  publisher             text,
  headline              text,
  published_at          date,
  discovered_at         timestamptz not null default now(),
  -- classification (NULL until `signals process` has run on the row)
  signal_type           text
                        constraint ck_funder_signals_type check (signal_type is null or signal_type in (
                          'capital_commitment',   -- a new pool of money is announced
                          'program_launch',       -- a new program, initiative or fund
                          'rfp_open',             -- an open call / application window
                          'deadline',             -- an application deadline set or moved
                          'grant_announced',      -- grants awarded (what they fund now)
                          'investment_announced', -- an impact/equity investment made
                          'fund_close',           -- a fund raised or closed (advisers)
                          'strategy_shift',       -- priorities change, a field is entered or exited
                          'leadership_change',    -- new president, MD, program officer
                          'partnership',          -- collaboration or consortium
                          'event',                -- convening, webinar, report launch
                          'other')),
  amount_usd            numeric(16,2)
                        constraint ck_funder_signals_amount check (amount_usd is null or amount_usd >= 0),
  amount_kind           text
                        constraint ck_funder_signals_amount_kind check (amount_kind is null or amount_kind in (
                          'total_commitment','annual_budget','per_award','single_award',
                          'fund_size','range','other')),
  instruments           text[] not null default '{}'
                        constraint ck_funder_signals_instruments check (instruments <@ array[
                          'grant','pri','mri','equity','debt','guarantee','prize',
                          'contract','technical_assistance','unspecified']::text[]),
  eligible_recipients   text[] not null default '{}'
                        constraint ck_funder_signals_recipients check (eligible_recipients <@ array[
                          'nonprofit','for_profit','fund','government','academic',
                          'individual','unspecified']::text[]),
  sectors               text[] not null default '{}'
                        constraint ck_funder_signals_sectors check (sectors <@ array[
                          'climate','clean_energy','nuclear_energy','energy_other',
                          'environment_conservation','health','education','housing',
                          'economic_opportunity','journalism_media','democracy_civic',
                          'arts_culture','science_research','criminal_justice',
                          'international_development','human_services','other']::text[]),
  geographies           text[] not null default '{}',   -- free text: countries, states, cities
  horizon_end           date,                           -- "through 2028" -> 2028-12-31
  summary               text,                           -- OUR two-sentence paraphrase (AI-labelled downstream)
  action_hint           text,                           -- who should act and how (AI-labelled downstream)
  relevance             text
                        constraint ck_funder_signals_relevance
                        check (relevance is null or relevance in ('high','medium','low','none')),
  extraction_model      text,
  extraction_confidence real
                        constraint ck_funder_signals_confidence
                        check (extraction_confidence is null
                               or (extraction_confidence > 0 and extraction_confidence <= 1)),
  extracted_at          timestamptz,
  -- lifecycle
  status                text not null default 'candidate'
                        constraint ck_funder_signals_status
                        check (status in ('candidate','published','rejected','superseded')),
  reviewed_by           text,                           -- 'human:<name>' | 'model:<id>'
  reviewed_at           timestamptz,
  notes                 text,
  submitted_by          text not null default 'pipeline', -- 'seed:signal_urls.csv' | 'feed:<slug>' | 'ui:<name>' | 'cli'
  discovery_note        text,                           -- how a human found it ("LinkedIn post by the MD")
  -- provenance
  raw_source            jsonb,                          -- {evidence:{field:excerpt}, http:{...}, mentioned_orgs:[...]}
  raw_file_id           bigint not null
                        constraint fk_funder_signals_raw_file references internal.raw_files(id),
  snapshot_raw_file_id  bigint
                        constraint fk_funder_signals_snapshot references internal.raw_files(id),
  source_record_locator text not null,                  -- 'url:<canonical url>'
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table internal.funder_signals is
  'One row per dated, sourced funder announcement. raw_file_id = our cc_by run manifest (facts); snapshot_raw_file_id = the publisher page (not republishable). Only status=published rows reach public.funder_signals.';
comment on column internal.funder_signals.summary is
  'Our own paraphrase, written by the classifier from the page text. Renders with the AI label in every app; never quoted as the publisher''s words.';
comment on column internal.funder_signals.amount_usd is
  'Only when the page states a figure in USD. Never derived, converted or estimated.';

create index if not exists ix_funder_signals_status_published
  on internal.funder_signals (status, published_at desc, id desc);
create index if not exists ix_funder_signals_review
  on internal.funder_signals (discovered_at desc) where status = 'candidate';
create index if not exists ix_funder_signals_source
  on internal.funder_signals (source_id);

drop trigger if exists trg_funder_signals_updated_at on internal.funder_signals;
create trigger trg_funder_signals_updated_at before update on internal.funder_signals
  for each row execute function internal.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Org links: which organizations a signal is about.
-- ---------------------------------------------------------------------------
create table if not exists internal.funder_signal_orgs (
  signal_id             bigint not null
                        constraint fk_fso_signal references internal.funder_signals(id) on delete cascade,
  org_id                uuid not null
                        constraint fk_fso_org references internal.organizations(id) on delete cascade,
  role                  text not null default 'subject'
                        constraint ck_fso_role check (role in ('subject','partner','recipient','investee')),
  match_method          text not null
                        constraint ck_fso_method
                        check (match_method in ('source_feed','ein','name','manual','model')),
  confidence            real not null default 1.0
                        constraint ck_fso_confidence check (confidence > 0 and confidence <= 1),
  created_at            timestamptz not null default now(),
  constraint pk_funder_signal_orgs primary key (signal_id, org_id, role)
);

create index if not exists ix_fso_org on internal.funder_signal_orgs (org_id, signal_id desc);

-- ---------------------------------------------------------------------------
-- 4. Grants. funder_ro reads; funder_rw is the review gate (Greenbook admin
-- console) and the pipeline's write identity when it does not run as owner.
-- ---------------------------------------------------------------------------
grant select on internal.signal_sources, internal.funder_signals, internal.funder_signal_orgs
  to funder_ro;
grant select, insert, update on internal.signal_sources, internal.funder_signals
  to funder_rw;
grant select, insert, delete on internal.funder_signal_orgs to funder_rw;
grant usage, select on sequence internal.signal_sources_id_seq, internal.funder_signals_id_seq
  to funder_rw;

-- ---------------------------------------------------------------------------
-- 5. Public views: facts only, published only, licence-filtered on the
-- compilation file (doctrine 1). raw_source, notes and the snapshot are
-- never selected.
-- ---------------------------------------------------------------------------
create or replace view public.funder_signals as
select
  s.id, s.url, s.publisher, s.headline, s.published_at, s.discovered_at,
  s.signal_type, s.amount_usd, s.amount_kind, s.instruments, s.eligible_recipients,
  s.sectors, s.geographies, s.horizon_end, s.summary, s.action_hint,
  s.extraction_model, s.extraction_confidence, s.reviewed_at,
  rf.dataset_name as source_dataset, rf.source_url, lm.license_code, lm.license_name
from internal.funder_signals s
join internal.raw_files rf on rf.id = s.raw_file_id
join internal.licensing_map lm on lm.license_code = rf.license_code
where lm.republishable and s.status = 'published';

create or replace view public.funder_signal_orgs as
select so.signal_id, so.org_id, so.role, so.match_method, so.confidence
from internal.funder_signal_orgs so
join internal.funder_signals s on s.id = so.signal_id
join internal.raw_files rf on rf.id = s.raw_file_id
join internal.licensing_map lm on lm.license_code = rf.license_code
where lm.republishable and s.status = 'published';

grant select on public.funder_signals, public.funder_signal_orgs to funder_ro;

-- 0024 hygiene: Supabase default privileges grant ALL on new views to anon
-- and authenticated; revoke the write-shaped ones, guarded on the roles
-- existing so the file replays on vanilla Postgres.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke insert, update, delete, truncate, references, trigger
      on public.funder_signals, public.funder_signal_orgs from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke insert, update, delete, truncate, references, trigger
      on public.funder_signals, public.funder_signal_orgs from authenticated;
  end if;
end $$;

-- Verification (run by hand after applying):
--   select count(*) from internal.funder_signals;                       -- 0 on a fresh DB
--   begin; set local role funder_ro;
--     insert into internal.funder_signals (url, raw_file_id, source_record_locator)
--       values ('x', 1, 'x');                                            -- MUST fail
--   rollback;
--   select 1 from information_schema.view_table_usage
--     where view_schema = 'public' and view_name = 'funder_signals'
--       and table_name = 'raw_files';                                    -- 1 row: licence-filtered
--   -- a candidate row must be invisible publicly:
--   -- insert one as owner with status='candidate', then
--   -- select count(*) from public.funder_signals;                       -- 0
