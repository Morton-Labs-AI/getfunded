-- 0011: hybrid_search — filtered queries take an EXACT vector leg.
--
-- Regression found by `funderdb eval semantic` (2026-07-29): the HNSW build
-- (2026-07-26) silently broke kind-filtered semantic search. The index scan
-- yields GLOBAL nearest tuples which are then post-filtered; the embedding
-- space clusters by doc_kind, so for minority kinds the global-nearest
-- neighborhood contains ~none of them — kinds=['adviser'] returned 0 vector
-- rows (recorded E2: Lowercarbon #30), kinds=['foundation','program']
-- surfaced 0 of the 4 fusion programs (recorded E1b: all 4 on top). Even
-- hnsw.iterative_scan='relaxed_order' cannot cross the cluster gap within
-- max_scan_tuples. Every recorded E-series result was measured on the
-- pre-index exact path.
--
-- Fix: when ANY filter is present, defeat the index with `(dist) + 0.0` so
-- the leg ranks EXACTLY within the filtered universe (the recorded, correct
-- semantics; ~150-800ms, inside the <1s budget). Unfiltered queries keep
-- the 52ms HNSW path. enable_indexscan=off was rejected: it would also
-- degrade the PK joins in the same statement.

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
declare
  filtered boolean := kinds is not null or org_types is not null
                      or state_in is not null or min_size is not null;
begin
  perform pg_catalog.set_config('hnsw.ef_search', '60', true);
  perform pg_catalog.set_config('hnsw.iterative_scan', 'relaxed_order', true);
  if filtered then
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
        -- `+ 0.0` defeats the HNSW index: exact ranking within the filter.
        order by (sd.embedding operator(extensions.<=>) q_vec) + 0.0
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
  else
    return query
    with vec as (
      select t.id, row_number() over (order by t.dist) as r
      from (
        select sd.id, sd.embedding operator(extensions.<=>) q_vec as dist
        from internal.search_documents sd
        where sd.embedding is not null
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
  end if;
end $$;

grant execute on function internal.hybrid_search to funder_ro;
