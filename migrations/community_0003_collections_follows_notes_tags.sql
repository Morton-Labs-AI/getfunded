-- community_0003: saved lists, follows, notes, tags.
--
-- CORPUS REFERENCES ARE SOFT (dnw_0004 doctrine). Every org_id column carries an
-- internal.organizations id but has NO foreign key: the corpus re-ingests and
-- may rewrite or delete rows, and a cross-schema FK would either block the
-- pipeline (RESTRICT) or destroy member data (CASCADE). Each row snapshots
-- org_name/ein/org_type/city/state at save time. The snapshot is also the
-- survival strategy for the day entity resolution applies and rewrites
-- canonical_org_id: a reconciliation keyed on EIN re-points every row.
--
-- org_id is NULLABLE everywhere: a member may save a funder that is not in the
-- corpus yet. The alternative — fabricating a corpus row — violates one-way flow.
--
-- PUBLISHING IS AN AFFIRMATIVE ACT. collections.visibility and notes.visibility
-- both default to 'private'. This is the direct analogue of
-- internal.contact_channels.publishability defaulting to 'internal_only' (0002):
-- nothing a member writes becomes visible to anyone else by omission.

-- ---------------------------------------------------------------------------
-- collections
-- ---------------------------------------------------------------------------
create table community.collections (
  id              uuid        constraint pk_cm_collections primary key default gen_random_uuid(),
  tenant_id       text        not null default 'ofdb',
  owner_member_id uuid        not null
                  constraint fk_cm_collections_owner references community.members(id) on delete cascade,
  name            text        not null
                  constraint ck_cm_coll_name check (length(btrim(name)) between 1 and 120),
  slug            text        not null
                  constraint ck_cm_coll_slug_shape check (slug = community.norm_slug(slug)),
  description     text        constraint ck_cm_coll_desc check (length(description) <= 2000),
  visibility      text        not null default 'private'
                  constraint ck_cm_coll_visibility check (visibility in ('private','unlisted','members','public')),
  is_default      boolean     not null default false,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_cm_coll_slug unique (tenant_id, owner_member_id, slug)
);
-- Exactly one "Saved" list per member — the implicit destination of the Save
-- button, so saving never asks which list first.
create unique index uq_cm_coll_default on community.collections (owner_member_id)
  where is_default;
create index ix_cm_coll_owner on community.collections (owner_member_id)
  where archived_at is null;
create index ix_cm_coll_public on community.collections (visibility, updated_at desc)
  where visibility in ('members','public') and archived_at is null;
create trigger trg_cm_coll_updated before update on community.collections
  for each row execute function community.set_updated_at();

-- ---------------------------------------------------------------------------
-- collection_items
-- ---------------------------------------------------------------------------
create table community.collection_items (
  id            uuid        constraint pk_cm_ci primary key default gen_random_uuid(),
  tenant_id     text        not null default 'ofdb',
  collection_id uuid        not null
                constraint fk_cm_ci_collection references community.collections(id) on delete cascade,
  org_id        uuid,                        -- SOFT corpus ref; NULL = off-corpus
  org_name      text        not null,        -- snapshot at save time
  ein           text,
  org_type      text,
  city          text,
  state         text,
  note          text        constraint ck_cm_ci_note check (length(note) <= 2000),
  position      integer,
  added_by      uuid        constraint fk_cm_ci_member references community.members(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- One card per corpus org per list; off-corpus items are exempt so a member can
-- add several unmatched prospects. dnw_0004's uq_dnw_sf_org shape.
create unique index uq_cm_ci_org on community.collection_items (collection_id, org_id)
  where org_id is not null;
create index ix_cm_ci_org        on community.collection_items (org_id);
create index ix_cm_ci_collection on community.collection_items (collection_id, position, created_at);
create trigger trg_cm_ci_updated before update on community.collection_items
  for each row execute function community.set_updated_at();

-- ---------------------------------------------------------------------------
-- follows: one table, exactly-one-target enforced by num_nonnulls — the
-- internal.contact_channels ck_contact_one_owner idiom, with the same
-- `unique nulls not distinct` shape as uq_contact.
-- ---------------------------------------------------------------------------
create table community.follows (
  id                   bigint      generated always as identity
                       constraint pk_cm_follows primary key,
  tenant_id            text        not null default 'ofdb',
  follower_member_id   uuid        not null
                       constraint fk_cm_follows_member references community.members(id) on delete cascade,
  target_type          text        not null
                       constraint ck_cm_follows_type check (target_type in ('org','member','collection')),
  target_org_id        uuid,                        -- SOFT corpus ref
  target_org_name      text,                        -- snapshot
  target_member_id     uuid        constraint fk_cm_follows_target_member
                       references community.members(id) on delete cascade,
  target_collection_id uuid        constraint fk_cm_follows_target_coll
                       references community.collections(id) on delete cascade,
  created_at           timestamptz not null default now(),
  constraint ck_cm_follows_one_target check (
    num_nonnulls(target_org_id, target_member_id, target_collection_id) = 1),
  constraint ck_cm_follows_type_match check (
    (target_type = 'org'        and target_org_id        is not null) or
    (target_type = 'member'     and target_member_id     is not null) or
    (target_type = 'collection' and target_collection_id is not null)),
  constraint ck_cm_follows_not_self check (
    target_member_id is null or target_member_id <> follower_member_id),
  constraint uq_cm_follows unique nulls not distinct
    (tenant_id, follower_member_id, target_org_id, target_member_id, target_collection_id)
);
create index ix_cm_follows_org      on community.follows (target_org_id) where target_org_id is not null;
create index ix_cm_follows_member   on community.follows (target_member_id) where target_member_id is not null;
create index ix_cm_follows_follower on community.follows (follower_member_id, created_at desc);

-- ---------------------------------------------------------------------------
-- notes: PRACTITIONER KNOWLEDGE. This is where the nonprofit development
-- director's contribution lands, and it needs no corpus write at all.
--
-- THIS IS EXPRESSION, NOT A LICENSED FACT. It has no raw_file_id and can never
-- satisfy the raw_files -> licensing_map join that every public.* view performs,
-- so it is STRUCTURALLY ineligible for the public projection: there is no view
-- that could select it without inventing a fake raw_file. No public.* view is
-- created over this table and export.py's TABLES list is not touched.
--
-- basis + occurred_on are what make a claim reviewable rather than an opinion.
-- Practitioner knowledge decays: a 2019 "they're responsive" is not a 2026 fact,
-- and an undated claim cannot be adjudicated. The composer asks in this order —
-- what happened, how you know, when — because that order is the design.
-- ---------------------------------------------------------------------------
create table community.notes (
  id               uuid        constraint pk_cm_notes primary key default gen_random_uuid(),
  tenant_id        text        not null default 'ofdb',
  author_member_id uuid        not null
                   constraint fk_cm_notes_author references community.members(id) on delete cascade,
  -- Anchored on the ORG, not on a collection item, so a note survives an unsave.
  org_id           uuid,                       -- SOFT corpus ref
  org_name         text        not null,       -- snapshot
  ein              text,
  kind             text        not null default 'note'
                   constraint ck_cm_notes_kind check (kind in
                     ('note','experience','process_tip','warning','correction_hint')),
  body             text        not null
                   constraint ck_cm_notes_body check (length(btrim(body)) between 1 and 4000),
  basis            text
                   constraint ck_cm_notes_basis check (basis in
                     ('applied_and_heard_back','spoke_with_staff','attended_briefing',
                      'read_their_materials','secondhand','document_correction')),
  basis_detail     text        constraint ck_cm_notes_basis_detail check (length(basis_detail) <= 300),
  occurred_on      date,
  visibility       text        not null default 'private'
                   constraint ck_cm_notes_visibility check (visibility in ('private','members','public')),
  edited_at        timestamptz,
  -- Moderation tombstone: body is nulled, the row is kept so the audit trail and
  -- any flags that referenced it still resolve.
  redacted_at      timestamptz,
  redacted_reason  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A note anyone else can see must say HOW the author knows and WHEN. Private
  -- scratch notes are exempt — that is the whole difference between a private
  -- reminder and a published claim about a real institution.
  constraint ck_cm_notes_shared_is_evidenced check (
    visibility = 'private' or redacted_at is not null
    or (basis is not null and occurred_on is not null))
);
create index ix_cm_notes_org on community.notes (org_id, created_at desc)
  where redacted_at is null;
create index ix_cm_notes_author on community.notes (author_member_id, created_at desc);
create index ix_cm_notes_shared on community.notes (org_id, visibility, created_at desc)
  where redacted_at is null and visibility in ('members','public');
create trigger trg_cm_notes_updated before update on community.notes
  for each row execute function community.set_updated_at();

-- Redaction is a maintainer act, never a member one.
revoke update on community.notes from community_app;
grant update (body, kind, basis, basis_detail, occurred_on, visibility, edited_at, updated_at)
  on community.notes to community_app;
grant select on community.notes to funder_rw;
grant update (redacted_at, redacted_reason, body, updated_at) on community.notes to funder_rw;

-- ---------------------------------------------------------------------------
-- tags: a folksonomy with a per-member vote, so a count is a real count rather
-- than one loud member applying the same label fifty times.
-- ---------------------------------------------------------------------------
create table community.tags (
  id         uuid        constraint pk_cm_tags primary key default gen_random_uuid(),
  tenant_id  text        not null default 'ofdb',
  label      text        not null constraint ck_cm_tags_label check (length(btrim(label)) between 2 and 60),
  slug       text        not null generated always as (community.norm_slug(label)) stored,
  kind       text        not null default 'other'
             constraint ck_cm_tags_kind check (kind in ('subject','geography','practice','process','other')),
  is_curated boolean     not null default false,
  created_by uuid        constraint fk_cm_tags_creator references community.members(id),
  created_at timestamptz not null default now(),
  constraint uq_cm_tags_slug unique (tenant_id, slug)
);
-- Renaming or merging a tag rewrites meaning for everyone who applied it.
revoke update, delete on community.tags from community_app;
grant select, update, delete on community.tags to funder_rw;

create table community.org_tags (
  id         bigint      generated always as identity constraint pk_cm_org_tags primary key,
  tenant_id  text        not null default 'ofdb',
  org_id     uuid        not null,          -- SOFT corpus ref
  org_name   text        not null,          -- snapshot
  tag_id     uuid        not null
             constraint fk_cm_org_tags_tag references community.tags(id) on delete cascade,
  member_id  uuid        not null
             constraint fk_cm_org_tags_member references community.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint uq_cm_org_tags unique (tenant_id, org_id, tag_id, member_id)
);
create index ix_cm_org_tags_org on community.org_tags (org_id);
create index ix_cm_org_tags_tag on community.org_tags (tag_id);
-- Add or remove your own vote; never rewrite one.
revoke update on community.org_tags from community_app;

-- ---------------------------------------------------------------------------
-- Verification (run by hand).
-- ---------------------------------------------------------------------------
--   begin; set local role community_app;
--     -- duplicate corpus org in one list MUST fail; two off-corpus rows are ok
--     -- follow yourself MUST fail (ck_cm_follows_not_self)
--     -- two targets on one follow MUST fail (ck_cm_follows_one_target)
--     -- shared note without basis/occurred_on MUST fail (ck_cm_notes_shared_is_evidenced)
--     -- update notes set redacted_at MUST fail (no column grant)
--     -- update tags set label MUST fail (no grant)
--   rollback;
