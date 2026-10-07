-- 0009: entity resolution — a NON-DESTRUCTIVE linkage layer.
--
-- Nothing is ever merged, deleted, or repointed. Duplicates keep their rows and
-- their provenance; `canonical_*_id` (derived, recomputed on every apply) names
-- the survivor, and the resolve views let consumers opt in with one predicate
-- instead of a query rewrite. Every machine decision is auditable in
-- entity_links; human decisions (accepted/rejected) permanently override the
-- model and are never touched by a re-run.
--
-- Three jobs, run in this order (encoded as refusal checks in the CLI):
--   funds       ADV Schedule D 7B1 fund  <->  Form D fund issuer   (Splink)
--   people      cross-source person clustering                      (Splink)
--   recipients  as-reported grant recipient -> existing org    (deterministic)

-- ---------------------------------------------------------------------------
-- norm_name: the SQL twin of Python funderdb.normalize.normalize_name.
-- Parity is property-tested (scripts/norm-parity-test) — join equality across
-- the two implementations depends on it.
-- ---------------------------------------------------------------------------
create or replace function internal.norm_name(t text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select pg_catalog.btrim(
           pg_catalog.regexp_replace(
             pg_catalog.regexp_replace(pg_catalog.upper(t), '[^\w\s&-]', ' ', 'g'),
             '\s+', ' ', 'g'))
$$;

-- ---------------------------------------------------------------------------
-- entity_links: the evidence layer. One row per candidate pair.
-- ---------------------------------------------------------------------------
create table internal.entity_links (
  id                bigint generated always as identity
                    constraint pk_entity_links primary key,
  entity_type       text not null
                    constraint ck_links_entity check (entity_type in ('organization','person')),
  job               text not null,
  id_a              uuid not null,
  id_b              uuid not null,
  method            text not null,        -- 'splink:<job>@<model-sha12>' | 'deterministic:<rule>'
  match_weight      real,
  match_probability real,
  features          jsonb,                -- gamma vector / evidence snapshot for review
  status            text not null default 'auto'
                    constraint ck_links_status
                    check (status in ('auto','pending','accepted','rejected')),
  decided_by        text,
  decided_at        timestamptz,
  raw_file_id       bigint not null
                    constraint fk_links_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ck_links_ordered check (id_a < id_b),
  constraint uq_entity_links unique (job, id_a, id_b)
);

create index ix_links_a      on internal.entity_links (id_a);
create index ix_links_b      on internal.entity_links (id_b);
create index ix_links_status on internal.entity_links (job, status);

create trigger trg_links_updated_at before update on internal.entity_links
  for each row execute function internal.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Derived canonical pointers. NULL = this row IS canonical (or unresolved).
-- ---------------------------------------------------------------------------
alter table internal.organizations
  add column canonical_org_id uuid
  constraint fk_orgs_canonical references internal.organizations(id);
alter table internal.people
  add column canonical_person_id uuid
  constraint fk_people_canonical references internal.people(id);

create index ix_orgs_canonical on internal.organizations (canonical_org_id)
  where canonical_org_id is not null;
create index ix_people_canonical on internal.people (canonical_person_id)
  where canonical_person_id is not null;

-- ---------------------------------------------------------------------------
-- recipient_matches: as-reported grant recipient -> existing org.
-- Deterministic tiers, NOT Splink: >90% of the 1.07M distinct recipient names
-- have no true candidate in the DB (open-world), and the as-reported side
-- carries no second feature (990-PF grant rows have no recipient EIN), so
-- probabilistic EM has nothing to learn from. Unmatched stays NULL forever —
-- no stub orgs.
-- ---------------------------------------------------------------------------
create table internal.recipient_matches (
  id          bigint generated always as identity
              constraint pk_recipient_matches primary key,
  recipient_name_normalized text not null,
  recipient_state text,
  org_id      uuid not null
              constraint fk_recipient_matches_org references internal.organizations(id),
  method      text not null,            -- 'tier1'..'tier4'
  confidence  real not null
              constraint ck_recipient_conf check (confidence > 0 and confidence <= 1),
  status      text not null default 'auto'
              constraint ck_recipient_status
              check (status in ('auto','pending','accepted','rejected')),
  raw_file_id bigint not null
              constraint fk_recipient_matches_raw_file references internal.raw_files(id),
  source_record_locator text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_recipient_matches
    unique nulls not distinct (recipient_name_normalized, recipient_state)
);

create index ix_recipient_matches_org on internal.recipient_matches (org_id);

create trigger trg_recipient_matches_updated_at before update on internal.recipient_matches
  for each row execute function internal.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- er_labels: hand labels backing the >0.9 precision gate.
-- ---------------------------------------------------------------------------
create table internal.er_labels (
  id          bigint generated always as identity
              constraint pk_er_labels primary key,
  job         text not null,
  id_a        uuid,
  id_b        uuid,
  recipient_name_normalized text,
  org_id      uuid,
  label       text not null
              constraint ck_er_label check (label in ('match','not_match','unsure')),
  labeled_by  text not null default 'human:zach',
  notes       text,
  created_at  timestamptz not null default now(),
  constraint uq_er_labels unique nulls not distinct
    (job, id_a, id_b, recipient_name_normalized, org_id)
);

-- ---------------------------------------------------------------------------
-- Resolve views: consumers switch a table name or add one predicate.
-- ---------------------------------------------------------------------------
create view internal.org_resolve as
  select id as org_id, coalesce(canonical_org_id, id) as canonical_id
  from internal.organizations;

create view internal.person_resolve as
  select id as person_id, coalesce(canonical_person_id, id) as canonical_id
  from internal.people;

-- One row per real-world entity.
create view internal.organizations_canonical as
  select * from internal.organizations where canonical_org_id is null;

create view internal.people_canonical as
  select * from internal.people where canonical_person_id is null;

-- The crosswalk benefit of merging: a CIK lookup reaches the canonical ADV fund.
create view internal.org_identifiers_canonical as
  select r.canonical_id as org_id, i.id_type, i.id_value, i.confidence
  from internal.org_identifiers i
  join internal.org_resolve r on r.org_id = i.org_id;

grant select on internal.entity_links, internal.recipient_matches,
                internal.er_labels, internal.org_resolve, internal.person_resolve,
                internal.organizations_canonical, internal.people_canonical,
                internal.org_identifiers_canonical
  to funder_ro;
grant execute on function internal.norm_name(text) to funder_ro;
