-- 0012: richer foundation profiles — org-to-org similarity + website-derived facts.
--
-- similar_orgs (measured 2026-08-01, prototype): a doc vector sits inside its
-- own kind cluster, so the kind-only NN scan is HNSW-safe (recall@10 = 10/10
-- across 6 seeds incl. Topfer 4f205ebb, ~50ms warm). Selective extra filters
-- break HNSW recall (60% at 0.5% selectivity; ef_search=1000 does not rescue
-- it), so ANY caller filter takes the exact `+ 0.0` path (~305ms warm) — the
-- 0011 doctrine. Program-kind docs are unreachable as seeds (org_id IS NULL
-- on program docs), so no program branch is needed.
--
-- org_web_facts: user-confirmed extractions from a funder's own website.
-- Internal-only by construction: source snapshots carry license
-- 'publisher_website' (republishable=false), NO public.* view selects from
-- this table, and organizations.website is NOT backfilled — the org row's
-- provenance is its BMF file and that row is published; a website-derived
-- value there would surface a non-republishable-sourced fact in public.*.
-- The UI renders coalesce(web_facts.website_url, organizations.website).

-- ---------------------------------------------------------------------------
-- licensing: funder-website snapshots. Extracted facts are internal display
-- only. Verbatim page excerpts are confined to raw_source jsonb (the
-- low-volume-table convention; never selected by public views).
-- ---------------------------------------------------------------------------
insert into internal.licensing_map
  (license_code, license_name, republishable, attribution_required, notes) values
  ('publisher_website', 'Publisher website content (all rights reserved)', false, false,
   'Funder/foundation websites fetched for profile enrichment (dataset funder_website). '
   'Page content is the publisher''s copyright: snapshots stay in data/raw/funder_website/, '
   'extracted facts live only in internal.org_web_facts, and neither ever surfaces in '
   'public.* views or dataset exports. robots.txt respected at fetch time.');

-- ---------------------------------------------------------------------------
-- org_web_facts: append-only, user-reviewed website extractions. Rows exist
-- only AFTER the human decision — the UI previews an extraction without
-- writing; confirm/reject inserts the row. Re-enrichment inserts a new row
-- and flips the prior confirmed row to 'superseded' in the same transaction
-- (UI-side); uq_owf_confirmed makes the invariant structural. people jsonb
-- is display-only: website staff never enter internal.people until the
-- people ER precision gate lands.
-- ---------------------------------------------------------------------------
create table internal.org_web_facts (
  id                    bigint generated always as identity
                        constraint pk_org_web_facts primary key,
  org_id                uuid not null
                        constraint fk_owf_org references internal.organizations(id) on delete cascade,
  website_url           text not null,   -- final URL after redirects, user-confirmed
  focus_areas           text[] not null default '{}',
  giving_priorities     text,
  application_info      text,            -- process / deadlines / eligibility, prose
  application_url       text,            -- direct "how to apply" page when found
  accepts_unsolicited   boolean,         -- null = the site does not say
  geographic_focus      text[] not null default '{}',
  people                jsonb,           -- [{full_name,title,role,source_page}] display-only
  extracted_summary     text,
  extraction_model      text not null,
  extraction_confidence real
                        constraint ck_owf_confidence
                        check (extraction_confidence > 0 and extraction_confidence <= 1),
  extracted_at          timestamptz not null,
  status                text not null
                        constraint ck_owf_status
                        check (status in ('confirmed','rejected','superseded')),
  reviewed_by           text not null default 'human:zach',
  reviewed_at           timestamptz not null default now(),
  created_by            text not null default 'ui',
  notes                 text,
  raw_source            jsonb,           -- per-field verbatim excerpts: {field:{page,excerpt}}
  raw_file_id           bigint not null
                        constraint fk_owf_raw_file references internal.raw_files(id),
  source_record_locator text not null,   -- 'url:<final_seed_url>'
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index ix_owf_org on internal.org_web_facts (org_id);
create unique index uq_owf_confirmed on internal.org_web_facts (org_id)
  where status = 'confirmed';

create trigger trg_owf_updated_at before update on internal.org_web_facts
  for each row execute function internal.tg_set_updated_at();

grant select on internal.org_web_facts to funder_ro;
-- (write path: the dev-only admin role owns its writes; no grant needed here)

-- ---------------------------------------------------------------------------
-- similar_orgs: seed = the org's own doc embedding, same doc_kind implied.
-- ---------------------------------------------------------------------------
create function internal.similar_orgs(
  src_org_id  uuid,
  match_limit int default 12,
  state_in    text default null,
  org_types   text[] default null,
  min_size    numeric default null,
  max_size    numeric default null
) returns table (
  org_id      uuid,
  name        text,
  org_type    text,
  state       text,
  size_amount numeric,
  dist        float4
)
language plpgsql stable
set search_path = ''
as $$
declare
  src_vec  extensions.halfvec(512);
  src_kind text;
  filtered boolean := state_in is not null or org_types is not null
                      or min_size is not null or max_size is not null;
begin
  select sd.embedding, sd.doc_kind into src_vec, src_kind
  from internal.search_documents sd
  where sd.org_id = src_org_id and sd.embedding is not null;
  if src_vec is null then
    return;  -- org has no embedded doc: empty result, no error
  end if;

  perform pg_catalog.set_config('hnsw.ef_search', '60', true);
  perform pg_catalog.set_config('hnsw.iterative_scan', 'relaxed_order', true);

  if filtered then
    -- Exact path: `+ 0.0` defeats the HNSW index (0011 doctrine). Canonical
    -- exclusion joins inline — exactness is unaffected by join placement.
    return query
    select sd.org_id, o.name, sd.org_type, sd.state, sd.size_amount,
           ((sd.embedding operator(extensions.<=>) src_vec) + 0.0)::float4
    from internal.search_documents sd
    join internal.organizations o
      on o.id = sd.org_id and o.canonical_org_id is null
    where sd.embedding is not null
      and sd.doc_kind = src_kind
      and sd.org_id <> src_org_id
      and (state_in  is null or sd.state = state_in)
      and (org_types is null or sd.org_type = any(org_types))
      and (min_size  is null or sd.size_amount >= min_size)
      and (max_size  is null or sd.size_amount <= max_size)
    order by (sd.embedding operator(extensions.<=>) src_vec) + 0.0
    limit match_limit;
  else
    -- HNSW path. The inner scan touches ONLY search_documents so the planner
    -- keeps the index scan; kind + self/merged exclusions are applied outside
    -- over an over-fetched candidate set (nearest hit is the src doc itself,
    -- dist 0, dropped here; merged-away orgs are a small fraction).
    return query
    with nn as (
      select sd.org_id as cand_org_id, sd.org_type as cand_org_type,
             sd.state as cand_state, sd.size_amount as cand_size,
             (sd.embedding operator(extensions.<=>) src_vec)::float4 as d
      from internal.search_documents sd
      where sd.embedding is not null
        and sd.doc_kind = src_kind
      order by sd.embedding operator(extensions.<=>) src_vec
      limit match_limit * 4 + 8
    )
    select nn.cand_org_id, o.name, nn.cand_org_type, nn.cand_state,
           nn.cand_size, nn.d
    from nn
    join internal.organizations o
      on o.id = nn.cand_org_id and o.canonical_org_id is null
    where nn.cand_org_id <> src_org_id
    order by nn.d
    limit match_limit;
  end if;
end $$;

grant execute on function internal.similar_orgs to funder_ro;
