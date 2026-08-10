-- 0020: application posture + distribution scale as SEARCH filters.
--
-- Two denormalized columns on search_documents and two appended arguments on
-- hybrid_search, so "foundations that fund plasma physics AND accept
-- unsolicited applications AND actually paid out over $500k" is one call
-- instead of a post-filter.
--
-- WHY DENORMALIZED: the upsert in embed.py nulls a document's embedding only
-- when doc_hash changes. Filter columns are not part of doc_hash, so adding
-- them costs ZERO re-embedding. That asymmetry is the whole reason
-- search_documents already carries org_type/state/size_amount rather than
-- joining organizations at query time.
--
-- WHY DROP AND RECREATE: adding parameters does not replace a function, it
-- creates a second overload — and `create or replace` cannot change a return
-- type at all. Both new OUT columns are appended, so every existing consumer
-- that indexes positions 0..11 (benchmarks/expectations.py) stays valid, and
-- the two new columns land at 12 and 13. DROP destroys the grant, so it is
-- re-issued at the bottom.

alter table internal.search_documents
  add column app_posture text
    constraint ck_sd_app_posture
    check (app_posture in ('open', 'preselected_only', 'unknown')),
  add column annual_distributions numeric(18,2);

-- Partial: only embedded docs are ever reachable through the vector leg.
create index ix_sd_posture on internal.search_documents (app_posture)
  where embedding is not null;
create index ix_sd_distributions on internal.search_documents (annual_distributions)
  where embedding is not null;

comment on column internal.search_documents.app_posture is
  'Application posture from the latest PARSED 990-PF Part XV. NULL for company '
  'and adviser docs (not grantmakers). ''unknown'' is an ABSENCE of a '
  'statement, never a closed door — it covers every grantmaking public '
  'charity, which files 990 and therefore has no Part XV at all.';

comment on column internal.search_documents.annual_distributions is
  'Money actually paid out per year. coalesce(qualifying_distributions, '
  'charitable_disbursements, annualized observed grants) — the third term '
  'exists so grantmaking public charities, which have no Part XII, are not '
  'silently deleted by a min_distributions filter.';

drop function internal.hybrid_search(
  text, extensions.halfvec, int, text[], text[], text, numeric);

create function internal.hybrid_search(
  q_text            text,
  q_vec             extensions.halfvec(512),
  match_limit       int default 20,
  kinds             text[] default null,
  org_types         text[] default null,
  state_in          text default null,
  min_size          numeric default null,
  app_postures      text[] default null,
  min_distributions numeric default null
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
  snippet     text,
  app_posture text,
  annual_distributions numeric
)
language plpgsql stable
set search_path = ''
as $$
declare
  filtered boolean := kinds is not null or org_types is not null
                      or state_in is not null or min_size is not null
                      or app_postures is not null or min_distributions is not null;
  -- Both legs previously hard-capped at 50, so the full outer join could
  -- never yield more than ~100 rows however large match_limit was — browse
  -- asked for 200 and silently got ~100, and its "top N" label was wrong.
  leg_limit int := greatest(match_limit, 50);
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
          and (app_postures is null or sd.app_posture = any(app_postures))
          and (min_distributions is null
               or sd.annual_distributions >= min_distributions)
        -- `+ 0.0` defeats the HNSW index: exact ranking within the filter.
        order by (sd.embedding operator(extensions.<=>) q_vec) + 0.0
        limit leg_limit
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
        and (app_postures is null or sd.app_posture = any(app_postures))
        and (min_distributions is null
             or sd.annual_distributions >= min_distributions)
      order by ts_rank_cd(sd.search_tsv, q.query) desc
      limit leg_limit
    )
    select sd.id, sd.org_id, sd.program_id, sd.doc_kind,
           coalesce(o.name, fp.name),
           sd.org_type, sd.state, sd.size_amount,
           vec.r::int, fts.r::int,
           (coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + fts.r), 0))::float4,
           left(sd.doc_text, 240),
           sd.app_posture, sd.annual_distributions
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
        limit leg_limit
      ) t
    ),
    fts as (
      select sd.id, row_number() over
               (order by ts_rank_cd(sd.search_tsv, q.query) desc) as r
      from internal.search_documents sd,
           websearch_to_tsquery('english', q_text) q(query)
      where sd.search_tsv @@ q.query
      order by ts_rank_cd(sd.search_tsv, q.query) desc
      limit leg_limit
    )
    select sd.id, sd.org_id, sd.program_id, sd.doc_kind,
           coalesce(o.name, fp.name),
           sd.org_type, sd.state, sd.size_amount,
           vec.r::int, fts.r::int,
           (coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + fts.r), 0))::float4,
           left(sd.doc_text, 240),
           sd.app_posture, sd.annual_distributions
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
