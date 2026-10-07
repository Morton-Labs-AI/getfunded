-- 0002: core entity tables.
--
-- Provenance convention (the "PROV" columns), on every fact table:
--   raw_file_id           NOT NULL FK -> internal.raw_files
--   source_record_locator NOT NULL text, e.g.
--     'row:EIN=943168068' | 'xpath:/Return/ReturnData/IRS990PF/...Grp[17]'
--     | 'accession:0001234567-26-000123'
--   raw_source            jsonb — the untouched source record. Present only on
--     low-volume tables (organizations, people, funding_programs); omitted on
--     high-volume tables (funding_events) where locator + staged file suffice.
--
-- Identifier normalization (enforced in Python, documented here):
--   ein  = 9 digits, zero-padded    cik = digits, leading zeros stripped
--   crd  = digits                   uei = 12-char uppercase alphanumeric
--   duns = 9 digits                 ror/openalex/crossref = bare ID, not URL

-- ---------------------------------------------------------------------------
-- organizations: canonical org. NO external-ID columns — all external
-- identifiers live in org_identifiers (the multi-source crosswalk).
-- ---------------------------------------------------------------------------
create table internal.organizations (
  id               uuid constraint pk_organizations primary key default gen_random_uuid(),
  name             text not null,
  legal_name       text,
  name_normalized  text not null,
  org_type         text not null
                   constraint ck_orgs_type check (org_type in
                     ('private_foundation','public_charity','vc','pe','family_office',
                      'angel_group','accelerator','corporate_vc','investment_adviser',
                      'fund','gov_agency','company','other')),
  street           text,
  city             text,
  state            text,
  zip              text,
  country          text not null default 'US',
  website          text,
  -- nonprofit-world columns (IRS BMF / 990)
  ntee_code        text,
  subsection_code  text,
  foundation_code  text,
  ruling_date      date,
  asset_amount     numeric(18,2),
  income_amount    numeric(18,2),
  revenue_amount   numeric(18,2),
  -- capital-world columns (SEC ADV / curation)
  aum              numeric(18,2),
  fund_size        numeric(18,2),
  check_size_min   numeric(16,2),
  check_size_max   numeric(16,2),
  is_era           boolean,
  focus_areas       text[] not null default '{}',
  investment_stages text[] not null default '{}',
  geographic_focus  text[] not null default '{}',
  thesis_text      text,
  status           text not null default 'active'
                   constraint ck_orgs_status check (status in ('active','inactive','unknown')),
  last_verified_at timestamptz,
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(legal_name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(thesis_text,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(city,'') || ' ' || coalesce(state,'')), 'C')
  ) stored,
  raw_file_id            bigint not null
                         constraint fk_orgs_raw_file references internal.raw_files(id),
  source_record_locator  text not null,
  raw_source             jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index ix_orgs_search    on internal.organizations using gin (search_tsv);
create index ix_orgs_name_trgm on internal.organizations using gin (name gin_trgm_ops);
create index ix_orgs_name_norm on internal.organizations (name_normalized);
create index ix_orgs_type      on internal.organizations (org_type);
create index ix_orgs_state     on internal.organizations (state);
create index ix_orgs_focus     on internal.organizations using gin (focus_areas);

-- ---------------------------------------------------------------------------
-- org_identifiers: the load-bearing crosswalk. One org per external identifier.
-- confidence 1.0 = asserted by the source itself; < 1.0 = inferred link
-- (Phase-2 Splink output lands here without schema change).
-- ---------------------------------------------------------------------------
create table internal.org_identifiers (
  id         bigint generated always as identity
             constraint pk_org_identifiers primary key,
  org_id     uuid not null
             constraint fk_org_identifiers_org references internal.organizations(id) on delete cascade,
  id_type    text not null
             constraint ck_org_identifiers_type check (id_type in
               ('ein','cik','crd','sec_file_number','uei','duns',
                'ror','lei','sam_entity_id','openalex_funder','crossref_funder')),
  id_value   text not null,
  confidence real not null default 1.0
             constraint ck_org_identifiers_confidence check (confidence > 0 and confidence <= 1),
  raw_file_id           bigint not null
                        constraint fk_org_identifiers_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint uq_org_identifiers unique (id_type, id_value)
);

create index ix_org_identifiers_org on internal.org_identifiers (org_id);

-- ---------------------------------------------------------------------------
-- people: no universal external ID exists, so source_natural_key (source-scoped)
-- makes re-ingest idempotent. Cross-source person dedup is a Phase-2 Splink job;
-- Phase 1 tolerates one person-row per source.
-- ---------------------------------------------------------------------------
create table internal.people (
  id                   uuid constraint pk_people primary key default gen_random_uuid(),
  full_name            text not null,
  first_name           text,
  last_name            text,
  primary_org_id       uuid
                       constraint fk_people_org references internal.organizations(id),
  primary_title        text,
  is_individual_funder boolean not null default false,
  bio_url              text,
  linkedin_url         text,
  source_natural_key   text,
  raw_file_id            bigint not null
                         constraint fk_people_raw_file references internal.raw_files(id),
  source_record_locator  text not null,
  raw_source             jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index uq_people_natural_key on internal.people (source_natural_key)
  where source_natural_key is not null;
create index ix_people_name_trgm on internal.people using gin (full_name gin_trgm_ops);
create index ix_people_org       on internal.people (primary_org_id);

-- ---------------------------------------------------------------------------
-- funding_programs: federal solicitations (SBIR topics, INFUSE, BAAs) are
-- temporal offer-objects administered by an agency org — not orgs (they expire,
-- recur, have ceilings) and not events (no money moved yet).
-- ---------------------------------------------------------------------------
create table internal.funding_programs (
  id                   uuid constraint pk_funding_programs primary key default gen_random_uuid(),
  administering_org_id uuid not null
                       constraint fk_programs_org references internal.organizations(id),
  name                 text not null,
  program_type         text not null
                       constraint ck_programs_type check (program_type in
                         ('sbir','sttr','federal_grant','baa','prize','fellowship','other')),
  program_code         text,
  description          text,
  eligibility          text,
  award_floor          numeric(16,2),
  award_ceiling        numeric(16,2),
  non_dilutive         boolean not null default true,
  funds_lab_not_company boolean not null default false,  -- INFUSE-style: funds a lab on your behalf
  open_date            date,
  close_date           date,
  status               text not null default 'unknown'
                       constraint ck_programs_status check
                         (status in ('open','closed','forecasted','recurring','unknown')),
  url                  text,
  source_record_key    text not null constraint uq_programs_record_key unique,
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(name,'')), 'A') ||
    setweight(to_tsvector('english', coalesce(description,'')), 'B') ||
    setweight(to_tsvector('english', coalesce(eligibility,'')), 'C')
  ) stored,
  raw_file_id            bigint not null
                         constraint fk_programs_raw_file references internal.raw_files(id),
  source_record_locator  text not null,
  raw_source             jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index ix_programs_search on internal.funding_programs using gin (search_tsv);
create index ix_programs_org    on internal.funding_programs (administering_org_id);
create index ix_programs_open   on internal.funding_programs (status, close_date);

-- ---------------------------------------------------------------------------
-- funding_events: money that moved. Funder is nullable because a Form D filing
-- is a real funding event (issuer raised money) with unnamed investors.
-- recipient_org_id stays NULL in Phase 1 — resolution is a Phase-2 Splink job;
-- recipient_name is always preserved as-reported.
-- NO raw_source column (high volume) — locator + staged file is the provenance.
-- ---------------------------------------------------------------------------
create table internal.funding_events (
  id                uuid constraint pk_funding_events primary key default gen_random_uuid(),
  event_type        text not null
                    constraint ck_events_type check (event_type in
                      ('grant','sbir_award','sttr_award','federal_grant','federal_contract',
                       'reg_d_offering','equity_investment','other')),
  funder_org_id     uuid
                    constraint fk_events_funder_org references internal.organizations(id),
  funder_person_id  uuid
                    constraint fk_events_funder_person references internal.people(id),
  program_id        uuid
                    constraint fk_events_program references internal.funding_programs(id),
  recipient_org_id  uuid
                    constraint fk_events_recipient references internal.organizations(id),
  recipient_name    text not null,
  recipient_city    text,
  recipient_state   text,
  event_date        date,
  fiscal_year       smallint,
  amount            numeric(16,2),
  currency          char(3) not null default 'USD',
  purpose_text      text,
  source_record_key text not null constraint uq_events_record_key unique,
  search_tsv tsvector generated always as (
    to_tsvector('english', coalesce(purpose_text,'') || ' ' || coalesce(recipient_name,''))
  ) stored,
  raw_file_id            bigint not null
                         constraint fk_events_raw_file references internal.raw_files(id),
  source_record_locator  text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_events_has_funder check (
    funder_org_id is not null or funder_person_id is not null or event_type = 'reg_d_offering')
);

create index ix_events_funder    on internal.funding_events (funder_org_id);
create index ix_events_recipient on internal.funding_events (recipient_org_id);
create index ix_events_program   on internal.funding_events (program_id);
create index ix_events_date      on internal.funding_events (event_date desc);
create index ix_events_search    on internal.funding_events using gin (search_tsv);

-- ---------------------------------------------------------------------------
-- contact_channels: the privacy-critical table. Three structural safety layers:
--   1. publishability DEFAULTS to internal_only — publishing is an explicit act.
--   2. ck_contact_red_private makes red+public unrepresentable.
--   3. License-guard trigger: rows from a non-republishable source can never be
--      public, no matter what an agent writes.
-- ---------------------------------------------------------------------------
create table internal.contact_channels (
  id               bigint generated always as identity
                   constraint pk_contact_channels primary key,
  org_id           uuid
                   constraint fk_contact_org references internal.organizations(id) on delete cascade,
  person_id        uuid
                   constraint fk_contact_person references internal.people(id) on delete cascade,
  channel_type     text not null
                   constraint ck_contact_type check (channel_type in
                     ('email','phone','url','form','social','address')),
  value            text not null,
  is_role_based    boolean not null default false,
  privacy_tier     text not null
                   constraint ck_contact_tier check (privacy_tier in ('green','yellow','red')),
  publishability   text not null default 'internal_only'
                   constraint ck_contact_publishability check
                     (publishability in ('public','internal_only')),
  last_verified_at timestamptz,
  raw_file_id            bigint not null
                         constraint fk_contact_raw_file references internal.raw_files(id),
  source_record_locator  text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_contact_one_owner   check (num_nonnulls(org_id, person_id) = 1),
  constraint ck_contact_red_private check (not (privacy_tier = 'red' and publishability = 'public')),
  constraint uq_contact unique nulls not distinct (org_id, person_id, channel_type, value)
);

create index ix_contact_org    on internal.contact_channels (org_id);
create index ix_contact_person on internal.contact_channels (person_id);

create function internal.tg_contact_license_guard() returns trigger
language plpgsql as $$
begin
  if new.publishability = 'public' and not exists (
    select 1 from internal.raw_files rf
    join internal.licensing_map lm using (license_code)
    where rf.id = new.raw_file_id and lm.republishable
  ) then
    raise exception 'contact channel from non-republishable source (raw_file %) cannot be public',
      new.raw_file_id;
  end if;
  return new;
end $$;

create trigger trg_contact_license_guard
  before insert or update on internal.contact_channels
  for each row execute function internal.tg_contact_license_guard();

-- ---------------------------------------------------------------------------
-- relationships: person->org and org->org edges only, FK-enforced endpoints
-- (no polymorphic pairs). No person<->person, no strength, no co-funder edges
-- in Phase 1.
-- ---------------------------------------------------------------------------
create table internal.relationships (
  id             bigint generated always as identity
                 constraint pk_relationships primary key,
  from_person_id uuid
                 constraint fk_rel_from_person references internal.people(id) on delete cascade,
  from_org_id    uuid
                 constraint fk_rel_from_org references internal.organizations(id) on delete cascade,
  to_org_id      uuid not null
                 constraint fk_rel_to_org references internal.organizations(id) on delete cascade,
  rel_type       text not null
                 constraint ck_rel_type check (rel_type in
                   ('officer_of','director_of','trustee_of','owner_of','executive_of',
                    'poc_for','adviser_to','manages_fund','parent_of')),
  title          text,
  start_date     date,
  end_date       date,
  confidence     real not null default 1.0
                 constraint ck_rel_confidence check (confidence > 0 and confidence <= 1),
  raw_file_id            bigint not null
                         constraint fk_rel_raw_file references internal.raw_files(id),
  source_record_locator  text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_rel_one_from check (num_nonnulls(from_person_id, from_org_id) = 1),
  constraint uq_rel unique nulls not distinct (from_person_id, from_org_id, to_org_id, rel_type)
);

create index ix_rel_to          on internal.relationships (to_org_id);
create index ix_rel_from_person on internal.relationships (from_person_id);
create index ix_rel_from_org    on internal.relationships (from_org_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger trg_orgs_updated_at            before update on internal.organizations
  for each row execute function internal.tg_set_updated_at();
create trigger trg_org_identifiers_updated_at before update on internal.org_identifiers
  for each row execute function internal.tg_set_updated_at();
create trigger trg_people_updated_at          before update on internal.people
  for each row execute function internal.tg_set_updated_at();
create trigger trg_programs_updated_at        before update on internal.funding_programs
  for each row execute function internal.tg_set_updated_at();
create trigger trg_events_updated_at          before update on internal.funding_events
  for each row execute function internal.tg_set_updated_at();
create trigger trg_contact_updated_at         before update on internal.contact_channels
  for each row execute function internal.tg_set_updated_at();
create trigger trg_rel_updated_at             before update on internal.relationships
  for each row execute function internal.tg_set_updated_at();
