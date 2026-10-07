-- 0007: dashboard materialized views for the Greenbook UI (open-funder-db-ui).
-- MV reads are 1-10ms vs 0.4-2.5s live aggregates over 2.63M events — the
-- overview page budget (<1s) depends on these. Data changes only at ingest
-- time; call internal.refresh_dashboard_stats() after future ingests.

create materialized view internal.mv_overview_totals as
  select
    (select count(*) from internal.organizations)   as orgs,
    (select count(*) from internal.people)          as people,
    (select count(*) from internal.funding_events)  as events,
    (select count(*) from internal.relationships)   as relationships,
    (select count(*) from internal.funding_programs) as programs,
    (select count(*) from internal.raw_files)       as raw_files,
    (select coalesce(sum(amount), 0) from internal.funding_events) as total_amount,
    now() as refreshed_at;

create materialized view internal.mv_org_type_counts as
  select org_type, count(*) as n,
         sum(asset_amount) as assets, sum(aum) as aum
  from internal.organizations
  group by 1;
create unique index uq_mv_org_type on internal.mv_org_type_counts (org_type);

create materialized view internal.mv_org_state_counts as
  select state, org_type, count(*) as n
  from internal.organizations
  where state is not null
  group by 1, 2;
create unique index uq_mv_org_state on internal.mv_org_state_counts (state, org_type);

create materialized view internal.mv_event_type_totals as
  select event_type, count(*) as n, sum(amount) as total
  from internal.funding_events
  group by 1;
create unique index uq_mv_event_type on internal.mv_event_type_totals (event_type);

create materialized view internal.mv_events_by_year as
  select coalesce(fiscal_year, extract(year from event_date)::smallint) as fy,
         event_type, count(*) as n, sum(amount) as total
  from internal.funding_events
  group by 1, 2;
create unique index uq_mv_events_year on internal.mv_events_by_year (fy, event_type)
  nulls not distinct;

create materialized view internal.mv_top_funders as
  select fe.funder_org_id as org_id, o.name, o.org_type,
         count(*) as n_events, sum(fe.amount) as total
  from internal.funding_events fe
  join internal.organizations o on o.id = fe.funder_org_id
  group by 1, 2, 3
  order by total desc nulls last
  limit 200;
create unique index uq_mv_top_funders on internal.mv_top_funders (org_id);

create materialized view internal.mv_amount_histogram as
  select event_type, width_bucket(ln(amount::float8), 0, 23, 23) as bucket, count(*) as n
  from internal.funding_events
  where amount > 0
  group by 1, 2;
create unique index uq_mv_amount_hist on internal.mv_amount_histogram (event_type, bucket);

-- Per-org event aggregates: power the browse "Grants on file" column and
-- profile stat rows without scanning 2.32M grants per page view.
create materialized view internal.mv_funder_event_stats as
  select funder_org_id as org_id, event_type,
         count(*) as n, sum(amount) as total,
         min(fiscal_year) as first_fy, max(fiscal_year) as last_fy
  from internal.funding_events
  where funder_org_id is not null
  group by 1, 2;
create unique index uq_mv_funder_stats on internal.mv_funder_event_stats (org_id, event_type);

create materialized view internal.mv_recipient_event_stats as
  select recipient_org_id as org_id, event_type,
         count(*) as n, sum(amount) as total,
         max(event_date) as latest_date
  from internal.funding_events
  where recipient_org_id is not null
  group by 1, 2;
create unique index uq_mv_recipient_stats on internal.mv_recipient_event_stats (org_id, event_type);

-- Keyset pagination support for date-ordered event lists.
create index ix_events_date_id on internal.funding_events (event_date desc, id desc);

create or replace function internal.refresh_dashboard_stats() returns void
language sql
set search_path = ''
as $$
  refresh materialized view internal.mv_overview_totals;
  refresh materialized view internal.mv_org_type_counts;
  refresh materialized view internal.mv_org_state_counts;
  refresh materialized view internal.mv_event_type_totals;
  refresh materialized view internal.mv_events_by_year;
  refresh materialized view internal.mv_top_funders;
  refresh materialized view internal.mv_amount_histogram;
  refresh materialized view internal.mv_funder_event_stats;
  refresh materialized view internal.mv_recipient_event_stats;
$$;
