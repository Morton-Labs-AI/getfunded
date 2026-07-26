-- 0008: hybrid semantic search — the aggregate-then-embed corpus + RRF retrieval.
--
-- Design (measured 2026-07-25): organizations.thesis_text is empty (10 rows)
-- and grant purposes average 26 chars, so the semantic unit is the AGGREGATED
-- entity document, never the individual grant:
--   foundation (90,787 with >=1 grant): "revealed thesis" — top purposes by
--     summed amount + top recipients + geography;
--   company (34,464 SBIR awardees): deduped award titles;
--   adviser (23,638): name/type/funds (name-carried signal, accepted);
--   program (16): full curated descriptions.
-- Both hybrid legs (HNSW vector + FTS) run over THIS corpus, so keyword search
-- finally sees giving behavior at the org level. Individual-grant FTS remains
-- on funding_events for evidence queries.
--
-- Embeddings: voyage-3.5, output_dimension=512, halfvec (~150MB + ~200MB HNSW
-- at 149k docs — sized for Small compute). embedding is NULL until embedded:
-- build and embed are separately restartable. Docs are DERIVED rows — their
-- provenance is the underlying facts; embedding runs are ledgered, not
-- raw-file-registered.

create extension if not exists vector with schema extensions;

create table internal.search_documents (
  id           bigint generated always as identity
               constraint pk_search_documents primary key,
  org_id       uuid
               constraint fk_sd_org references internal.organizations(id) on delete cascade,
  program_id   uuid
               constraint fk_sd_program references internal.funding_programs(id) on delete cascade,
  doc_kind     text not null
               constraint ck_sd_kind check (doc_kind in ('foundation','company','adviser','program')),
  doc_text     text not null,
  doc_hash     char(64) not null,
  -- denormalized filter columns, rebuilt with the doc (enable filtered HNSW)
  org_type     text,
  state        text,
  size_amount  numeric(18,2),
  embedding    extensions.halfvec(512),
  model        text not null default 'voyage-3.5-512',
  token_count  int,
  embedded_at  timestamptz,
  search_tsv   tsvector generated always as (to_tsvector('english', doc_text)) stored,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ck_sd_one_owner check (num_nonnulls(org_id, program_id) = 1),
  constraint uq_sd_owner unique nulls not distinct (org_id, program_id)
);

create index ix_sd_fts  on internal.search_documents using gin (search_tsv);
create index ix_sd_kind on internal.search_documents (doc_kind, org_type);
-- NOTE: the HNSW index is created by `funderdb embed sync` AFTER the initial
-- bulk embed (with session maintenance_work_mem raised), not here:
--   create index ix_sd_hnsw on internal.search_documents
--     using hnsw (embedding extensions.halfvec_cosine_ops)
--     with (m = 16, ef_construction = 64);

grant select on internal.search_documents to funder_ro;

create trigger trg_sd_updated_at before update on internal.search_documents
  for each row execute function internal.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- hybrid_search: HNSW top-50 ∪ FTS top-50 → Reciprocal Rank Fusion (k=60).
-- Callable by funder_ro (the UI and the analyst's tools).
-- ---------------------------------------------------------------------------
create or replace function internal.hybrid_search(
  q_text      text,
  q_vec       extensions.halfvec(512),
  match_limit int default 20,
  kinds       text[] default null,
  org_types   text[] default null,
  state_in    text default null,
  min_size    numeric default null
) returns table (
  doc_id      bigint,
  org_id      uuid,
  program_id  uuid,
  doc_kind    text,
  name        text,
  org_type    text,
  state       text,
  size_amount numeric,
  vec_rank    int,
  fts_rank    int,
  rrf         float4,
  snippet     text
)
language plpgsql stable
set search_path = ''
as $$
begin
  perform pg_catalog.set_config('hnsw.ef_search', '60', true);
  perform pg_catalog.set_config('hnsw.iterative_scan', 'relaxed_order', true);
  return query
  with vec as (
    select t.id, row_number() over (order by t.dist) as r
    from (
      select sd.id, sd.embedding operator(extensions.<=>) q_vec as dist
      from internal.search_documents sd
      where sd.embedding is not null
        and (kinds     is null or sd.doc_kind = any(kinds))
        and (org_types is null or sd.org_type = any(org_types))
        and (state_in  is null or sd.state = state_in)
        and (min_size  is null or sd.size_amount >= min_size)
      order by sd.embedding operator(extensions.<=>) q_vec
      limit 50
    ) t
  ),
  fts as (
    select sd.id, row_number() over
             (order by ts_rank_cd(sd.search_tsv, q.query) desc) as r
    from internal.search_documents sd,
         websearch_to_tsquery('english', q_text) q(query)
    where sd.search_tsv @@ q.query
      and (kinds     is null or sd.doc_kind = any(kinds))
      and (org_types is null or sd.org_type = any(org_types))
      and (state_in  is null or sd.state = state_in)
      and (min_size  is null or sd.size_amount >= min_size)
    order by ts_rank_cd(sd.search_tsv, q.query) desc
    limit 50
  )
  select sd.id, sd.org_id, sd.program_id, sd.doc_kind,
         coalesce(o.name, fp.name),
         sd.org_type, sd.state, sd.size_amount,
         vec.r::int, fts.r::int,
         (coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + fts.r), 0))::float4,
         left(sd.doc_text, 240)
  from vec
  full outer join fts using (id)
  join internal.search_documents sd on sd.id = coalesce(vec.id, fts.id)
  left join internal.organizations    o  on o.id  = sd.org_id
  left join internal.funding_programs fp on fp.id = sd.program_id
  order by 11 desc, sd.size_amount desc nulls last
  limit match_limit;
end $$;

grant execute on function internal.hybrid_search to funder_ro;
