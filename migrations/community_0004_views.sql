-- community_0004: the cross-plane join surfaces.
--
-- This is where corpus ⋈ community happens — IN POSTGRES, in one statement,
-- never stitched in Node. That is the whole point of one role spanning two
-- schemas (dnw.v_saved_funder_summary is the model).
--
-- EVERY VIEW IS security_invoker = true. Two reasons, both load-bearing:
--   1. RLS lands in community_0005. An owner-rights view LAUNDERS PAST every
--      policy — the caller's rights would not apply and a private collection
--      would be readable by anyone who could name the view. 0024 records the
--      corpus hitting exactly this with its public.* views.
--   2. It keeps the view honest: what you can see through it is what you can
--      see without it.
--
-- THE COROLLARY, and the reason for the definer function below: under RLS, an
-- invoker-rights view CANNOT COUNT. `select count(*) from community.follows
-- where target_org_id = $1` returns the number of times *the viewer* follows
-- that org — one or zero — not the number of members who do. Aggregates
-- therefore go through community.org_stats(), which is SECURITY DEFINER and
-- returns ONLY counts and tag labels: never a member id, never a handle, never
-- a row. A caller who lies about their identity gains nothing from it because
-- it takes no identity.

-- ---------------------------------------------------------------------------
-- The identity of the current request. NULL when unset, which makes every
-- policy in 0005 deny by default: forgetting set_config() yields an empty
-- result set, not someone else's data. Fail-closed is the only acceptable
-- direction for this function.
-- ---------------------------------------------------------------------------
create or replace function community.current_member_id() returns uuid
language sql stable
set search_path = ''
as $$
  select nullif(pg_catalog.current_setting('app.member_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------------
-- v_collection_item_summary — the dnw.v_saved_funder_summary analogue.
--
-- Every list surface reads THIS rather than re-deciding corpus semantics per
-- page. Three doctrines are encoded here once:
--   * grants_total counts event_type = 'grant' ONLY; grant_commitment is a
--     separate column, because a commitment is money promised, not money moved,
--     and summing them overstates giving.
--   * ALL corpus joins are LEFT, so an off-corpus item still renders.
--   * the LIVE org name sits beside the snapshot, so drift is visible rather
--     than silently hidden behind a stale label.
-- ---------------------------------------------------------------------------
create view community.v_collection_item_summary
with (security_invoker = true) as
select
  ci.id,
  ci.tenant_id,
  ci.collection_id,
  c.name            as collection_name,
  c.visibility      as collection_visibility,
  c.owner_member_id,
  m.handle          as owner_handle,
  ci.org_id,
  ci.org_name,                       -- snapshot at save time
  o.name            as org_name_live, -- drift is visible, not hidden
  o.canonical_org_id,                -- non-null => the corpus merged this away
  ci.ein,
  ci.org_type,
  ci.city,
  ci.state,
  ci.note,
  ci.position,
  ci.created_at,
  ci.updated_at,
  o.status          as org_status,
  o.website         as org_website,
  f.fy              as fin_fy,
  f.total_assets_eoy,
  f.qualifying_distributions,
  p.application_posture,
  g.n               as grants_n,
  g.total           as grants_total,
  g.last_fy         as grants_last_fy,
  gc.total          as future_grants_total
from community.collection_items ci
join community.collections c            on c.id = ci.collection_id
left join community.members m           on m.id = c.owner_member_id
left join internal.organizations o      on o.id = ci.org_id
left join internal.mv_org_latest_financials f   on f.org_id = ci.org_id
left join internal.mv_org_application_posture p on p.org_id = ci.org_id
left join internal.mv_funder_event_stats g
       on g.org_id = ci.org_id and g.event_type = 'grant'
left join internal.mv_funder_event_stats gc
       on gc.org_id = ci.org_id and gc.event_type = 'grant_commitment';

-- ---------------------------------------------------------------------------
-- org_stats — aggregates only. SECURITY DEFINER, and deliberately parameterised
-- by org ids rather than by a member: it has no notion of who is asking, so
-- there is nothing to spoof.
--
-- Set-returning and array-parameterised so /browse can annotate a whole page of
-- rows in ONE round trip instead of N.
-- ---------------------------------------------------------------------------
create or replace function community.org_stats(p_org_ids uuid[])
returns table (
  org_id           uuid,
  followers_n      integer,
  shared_notes_n   integer,
  taggers_n        integer,
  collections_n    integer,
  top_tags         text[],
  last_activity_at timestamptz
)
language sql stable security definer
set search_path = ''
as $$
  select
    x.org_id,
    coalesce(fl.n, 0)::integer  as followers_n,
    coalesce(nt.n, 0)::integer  as shared_notes_n,
    coalesce(tg.n, 0)::integer  as taggers_n,
    coalesce(cl.n, 0)::integer  as collections_n,
    coalesce(tg.labels, array[]::text[]) as top_tags,
    greatest(fl.last_at, nt.last_at, cl.last_at) as last_activity_at
  from pg_catalog.unnest(p_org_ids) as x(org_id)
  left join lateral (
    select pg_catalog.count(*)::int as n, pg_catalog.max(f.created_at) as last_at
    from community.follows f
    where f.target_org_id = x.org_id
  ) fl on true
  left join lateral (
    select pg_catalog.count(*)::int as n, pg_catalog.max(n2.created_at) as last_at
    from community.notes n2
    where n2.org_id = x.org_id
      and n2.redacted_at is null
      and n2.visibility in ('members','public')
  ) nt on true
  left join lateral (
    select pg_catalog.count(distinct ot.member_id)::int as n,
           (select pg_catalog.array_agg(t.label order by t.label)
              from (select t2.label
                      from community.org_tags ot2
                      join community.tags t2 on t2.id = ot2.tag_id
                     where ot2.org_id = x.org_id
                     group by t2.label
                     order by pg_catalog.count(*) desc, t2.label
                     limit 6) t) as labels
    from community.org_tags ot
    where ot.org_id = x.org_id
  ) tg on true
  left join lateral (
    -- Only lists their owners chose to share. A private list must not raise a
    -- public counter — that leaks the existence of private curation.
    select pg_catalog.count(*)::int as n, pg_catalog.max(ci.created_at) as last_at
    from community.collection_items ci
    join community.collections c on c.id = ci.collection_id
    where ci.org_id = x.org_id
      and c.visibility in ('members','public')
      and c.archived_at is null
  ) cl on true
$$;

revoke all on function community.org_stats(uuid[]) from public;
grant execute on function community.org_stats(uuid[]) to community_app;
grant execute on function community.org_stats(uuid[]) to funder_rw;

-- ---------------------------------------------------------------------------
-- v_member_profile — the public face of a member.
--
-- Selects from community.members ONLY, never from member_private, so an email
-- address cannot appear here even if someone later adds a column to the wrong
-- table. Structural, not vigilance.
-- ---------------------------------------------------------------------------
create view community.v_member_profile
with (security_invoker = true) as
select
  m.id,
  m.tenant_id,
  m.handle,
  m.display_name,
  m.bio,
  m.website_url,
  m.location_city,
  m.location_state,
  m.roles,
  m.job_title,
  m.org_affiliation_org_id,
  m.org_affiliation_name,
  m.org_affiliation_ein,
  m.org_affiliation_city,
  m.org_affiliation_state,
  o.name as org_affiliation_name_live,
  m.years_in_field,
  m.focus_areas,
  m.geographic_focus,
  m.github_login,
  m.visibility,
  m.follows_public,
  m.listed_in_directory,
  m.trust_tier,
  m.role,
  m.status,
  m.created_at,
  inv.handle as invited_by_handle
from community.members m
left join internal.organizations o on o.id = m.org_affiliation_org_id
left join community.members inv    on inv.id = m.invited_by
where m.kind = 'human'
  and m.deleted_at is null;

-- ---------------------------------------------------------------------------
-- v_member_directory — who can help me with X, not who is most impressive.
--
-- Only active members who are listed AND not private. Sorted by recent
-- contribution at the call site, never by an all-time total: a leaderboard
-- ossifies into the same five names inside a month and answers the wrong
-- question.
-- ---------------------------------------------------------------------------
create view community.v_member_directory
with (security_invoker = true) as
select
  p.*,
  coalesce(a.notes_n, 0)::integer as shared_notes_n,
  coalesce(a.orgs_n,  0)::integer as orgs_touched_n,
  a.last_contribution_at
from community.v_member_profile p
left join lateral (
  select count(*)::int as notes_n,
         count(distinct n.org_id)::int as orgs_n,
         max(n.created_at) as last_contribution_at
  from community.notes n
  where n.author_member_id = p.id
    and n.redacted_at is null
    and n.visibility in ('members','public')
) a on true
where p.status = 'active'
  and p.listed_in_directory
  and p.visibility in ('members','public');

grant select on community.v_collection_item_summary to community_app;
grant select on community.v_member_profile          to community_app;
grant select on community.v_member_directory        to community_app;
grant select on community.v_collection_item_summary to funder_rw;
grant select on community.v_member_profile          to funder_rw;
grant select on community.v_member_directory        to funder_rw;

-- ---------------------------------------------------------------------------
-- Verification:
--   select * from community.org_stats(array[<some org id>]::uuid[]);   -- zeros, no error
--   select count(*) from community.v_collection_item_summary;          -- 0, no error
--   -- and after 0005, the decisive one:
--   --   org_stats() must still return the TRUE follower count when called by a
--   --   member who follows nothing. If it returns 0 for an org with followers,
--   --   the definer boundary has been lost.
-- ---------------------------------------------------------------------------
