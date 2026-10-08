-- 0029: application history across returns, and the recipient turnover table.
--
-- WHY. "Can I apply?" rested on ONE checkbox from ONE return
-- (mv_org_application_posture, 0018). This file adds two facts that no single
-- return holds, so the page can show them beside that checkbox:
--
--   1. internal.mv_org_posture_history: how a foundation answered the
--      Part XV application question on EVERY parsed, non-superseded
--      Form 990-PF we hold, and the most recent return that gave the other
--      stated answer. Measured 2026-10-08 on 145,200 foundations, before the
--      back-year load: 134,441 gave one answer on every return; 1,454 say
--      'open' now and said 'preselected only' on another return; 2,352 the
--      reverse; 2,143 say nothing now and stated an answer on another return.
--      Those counts move with every ingest. Check ratios, not exact numbers.
--
--   2. internal.funder_recipient_turnover: for one foundation and one fiscal
--      year, how many of the named grant recipients were on none of that
--      foundation's grant lists for the three fiscal years before. This file
--      only creates the table. `funderdb derive turnover` fills it.
--
-- BOTH ARE COUNTS FROM PAST RETURNS. Neither says a foundation will consider
-- a new request, and nothing here may be turned into a score, a tier, a label
-- or an eligibility field (AGENTS.md rule 6). That is why the table has no
-- such column.
--
-- UNKNOWN STAYS UNKNOWN. A foundation gets a turnover row only when it has a
-- named grant row in the target year AND in each of the three years before.
-- No row means "we cannot tell". It never means zero.
--
-- NOT PUBLISHED YET. There is no public.* view for either object. Default
-- privileges give anon and authenticated SELECT on a new public view the
-- moment it exists, and these counts must not be read without the note that
-- sits beside them on the page. A later migration adds the views after the
-- wording is reviewed. Until then: do not add either object to export.py or
-- to the analyst allowlist.
--
-- NO DEPENDENCY on 0027 or 0028. The placeholder rule
-- (internal.is_placeholder_recipient, 0027) is called by the Python job, not
-- by anything in this file.

-- The session default is 2 minutes. The view below read 640,000 returns in
-- about 30 seconds while a backfill was writing; this leaves room.
set local statement_timeout = '10min';

-- ---------------------------------------------------------------------------
-- restrictive_phrase: the words in a Part XV free-text field that read like a
-- limit on applications, exactly as the filer wrote them (lower-cased, spaces
-- collapsed), or NULL. Same shape as internal.norm_name (0009).
--
-- It returns the MATCHED WORDS, never a yes/no. A fixed quote such as
-- "no unsolicited requests" would put words in the filer's mouth: measured
-- 2026-10-08 on the 'open' foundations, only 5 of 172 matches contain
-- "no unsolicited". The page quotes what is stored here and sends the reader
-- to the full text. It is a pointer, not a judgement: "NO PRESELECTED
-- TEMPLATE" matches too.
--
-- The bare "not accept" of the first draft is gone on purpose: it was the
-- top match (83 foundations) and caught any sentence with those two words.
-- It now needs one of four nouns after it. A sentence such as "DOES NOT
-- ACCEPT REQUESTS OF FUNDS FOR INDIVIDUALS" still matches, and the page
-- then quotes "not accept requests", which is what the filer wrote.
-- ---------------------------------------------------------------------------
create function internal.restrictive_phrase(t text) returns text
language sql immutable parallel safe
set search_path = ''
as $$
  select pg_catalog.lower(
           pg_catalog.regexp_replace(
             (pg_catalog.regexp_match(
                t,
                '\m(no\s+unsolicited'
                || '|not\s+accept(?:ing)?\s+(?:unsolicited|applications|requests|proposals)'
                || '|does\s+not\s+solicit'
                || '|by\s+invitation'
                || '|no\s+applications'
                || '|pre[- ]?selected)',
                'i'))[1],
             '\s+', ' ', 'g'))
$$;

comment on function internal.restrictive_phrase(text) is
  'The words in a Part XV free-text field that read like a limit on applications, as filed (lower case), or NULL. A pointer to the text, not a judgement.';

-- ---------------------------------------------------------------------------
-- mv_org_posture_history: one row per organisation with at least one parsed,
-- non-superseded Form 990-PF.
--
-- The per-filing rows are the SAME rows mv_org_application_posture (0018)
-- starts from, with the same posture rule and the same "latest" order, so
-- latest_object_id here equals object_id there for every organisation. A
-- reader of both views sees one "latest return". Both are refreshed inside
-- internal.refresh_dashboard_stats(), in one transaction.
--
--   n_returns        parsed, non-superseded 990-PF returns
--   n_open / n_preselected / n_not_stated   how many gave each answer
--   first_fy, last_fy   earliest and latest fiscal year among those returns
--   latest_*         the newest return (the one the posture badge uses)
--   other_*          the most recent return whose answer is STATED ('open'
--                    or 'preselected_only') and differs from the latest
--                    answer; NULL when there is none. When the latest return
--                    is silent this is the last stated answer.
--   restrictive_phrase   only when latest_posture = 'open'; see above
--   raw_file_id      of the latest filing, for the provenance seal
-- ---------------------------------------------------------------------------
create materialized view internal.mv_org_posture_history as
  with pf as (
    select f.org_id, f.object_id, f.tax_period, f.raw_file_id,
           nullif(left(f.tax_period, 4), '')::smallint as fy,
           case when fa.object_id is null then 'unknown'
                when fa.only_preselected  then 'preselected_only'
                else                           'open' end as posture,
           row_number() over (partition by f.org_id
                              order by f.tax_period desc, f.object_id desc) as rn
    from internal.filings f
    -- INNER JOIN: parsed filings only. This is the 0018 correctness rule.
    join internal.filing_financials ff on ff.object_id = f.object_id
    left join internal.filing_application_info fa on fa.object_id = f.object_id
    where f.org_id is not null
      and f.return_type = '990PF'
      and f.superseded_by_object_id is null
  ),
  agg as (
    select org_id,
           count(*)::int                                              as n_returns,
           (count(*) filter (where posture = 'open'))::int            as n_open,
           (count(*) filter (where posture = 'preselected_only'))::int as n_preselected,
           (count(*) filter (where posture = 'unknown'))::int         as n_not_stated,
           min(fy) as first_fy,
           max(fy) as last_fy
    from pf
    group by org_id
  ),
  latest as (
    select org_id, object_id, fy, posture, raw_file_id
    from pf
    where rn = 1
  ),
  other as (
    select distinct on (p.org_id)
           p.org_id, p.posture, p.fy, p.object_id, p.raw_file_id
    from pf p
    join latest l on l.org_id = p.org_id
    where p.posture in ('open', 'preselected_only')
      and p.posture <> l.posture
    order by p.org_id, p.tax_period desc, p.object_id desc
  )
  select a.org_id,
         a.n_returns, a.n_open, a.n_preselected, a.n_not_stated,
         a.first_fy, a.last_fy,
         l.posture   as latest_posture,
         l.fy        as latest_fy,
         l.object_id as latest_object_id,
         o.posture     as other_posture,
         o.fy          as other_fy,
         o.object_id   as other_object_id,
         o.raw_file_id as other_raw_file_id,
         case when l.posture = 'open'
              then coalesce(internal.restrictive_phrase(fa.form_and_info_txt),
                            internal.restrictive_phrase(fa.restrictions_txt))
         end as restrictive_phrase,
         l.raw_file_id,
         'row:object_id=' || l.object_id as source_record_locator
  from agg a
  join latest l on l.org_id = a.org_id
  left join other o on o.org_id = a.org_id
  left join internal.filing_application_info fa on fa.object_id = l.object_id;

-- Required, not an optimisation: the profile reads one row by org_id, and a
-- duplicate would show two histories for one foundation.
create unique index uq_mv_org_posture_history
  on internal.mv_org_posture_history (org_id);

comment on materialized view internal.mv_org_posture_history is
  'One row per organisation with a parsed, non-superseded Form 990-PF: how many returns gave each application answer, and the most recent return with the other stated answer. Counts from past returns; not a statement about future requests.';

-- ---------------------------------------------------------------------------
-- funder_recipient_turnover: filled by `funderdb derive turnover`, one row per
-- (foundation, fiscal year) that passes the write rule. Form 990-PF grant
-- rows only.
--
-- THE RULE (rule_version 'turnover-v1'; the full text is in the run manifest
-- that raw_file_id points at):
--   * A grant row is NAMED when internal.is_placeholder_recipient(
--     internal.norm_name(recipient_name)) is false. Rows that say only
--     "see attached" and the like are counted apart and never as recipients.
--   * Names are compared after cleaning: norm_name, then a leading "THE " and
--     one trailing entity suffix (INC, LLC, CORP, ...) are dropped.
--   * A recipient of fiscal year FY is SEEN BEFORE when, on the same
--     foundation's lists for FY-1, FY-2 and FY-3, there is (a) the same
--     cleaned name in any state, or (b) a row linked to the same
--     organisation (recipient_org_id), or (c) a cleaned name at least 0.8
--     trigram-similar in the same state. (c) is the respelling guard.
--     Measured 2026-10-08 on one slice, before name cleaning: 224 of 2,804
--     recipients that looked new were at least 0.8 similar to an earlier
--     name of the same foundation. It catches "BOYS & GIRLS CLUB OF ..." /
--     "BOYS AND GIRLS CLUB OF ..." (0.92) and "BOSTON SYMPHONEY ORCHESTRA"
--     (0.83). It does NOT catch a short respelling such as "FEED MORE" /
--     "FEEDMORE" (0.58), so some recipients still look new when they are
--     not; the page says so. n_seen_similar records what the guard did.
--   * A row is written ONLY when the foundation has a named row in FY and in
--     each of FY-1, FY-2 and FY-3. Otherwise there is no row.
--
-- No label, score or tier column, on purpose.
-- ---------------------------------------------------------------------------
create table internal.funder_recipient_turnover (
  funder_org_id   uuid not null
                  constraint fk_turnover_funder references internal.organizations(id),
  fy              smallint not null,
  -- Distinct named recipients on the FY grant list. A recipient is an
  -- organisation when a row is linked to one, otherwise a cleaned name.
  n_recipients    int not null,
  -- How many of them are not seen before (rule above).
  n_new           int not null,
  -- How many are seen before ONLY through the similar-name rule (c). Kept so
  -- the effect of that rule can be audited without a re-run.
  n_seen_similar  int not null default 0,
  window_first_fy smallint not null,   -- FY-3
  window_last_fy  smallint not null,   -- FY-1
  n_rows          int not null,        -- every 990-PF grant row in FY
  n_unnamed_rows  int not null,        -- placeholder rows in FY, not counted
  -- Placeholder rows in the three window years. When this is above 0 an
  -- earlier list was partly "see attached", so recipients can look new only
  -- because the earlier names are missing. Readers must hide the count then.
  window_unnamed_rows int not null,
  amount_total    numeric(18,2),       -- sum of amounts on the named FY rows
  amount_new      numeric(18,2),       -- of which: rows of recipients not seen before
  -- The newest non-superseded Form 990-PF that holds FY grant rows for this
  -- foundation. The page seals the count from this filing. NULL when the
  -- filing row cannot be found; readers then show nothing.
  object_id       text,
  rule_version    text not null,
  -- The run manifest (rule text and settings), registered like every input.
  raw_file_id     bigint not null
                  constraint fk_turnover_raw_file references internal.raw_files(id),
  source_record_locator text not null,  -- 'row:funder_org_id=<uuid>;fy=<fy>'
  computed_at     timestamptz not null default now(),
  constraint pk_funder_recipient_turnover primary key (funder_org_id, fy),
  constraint ck_turnover_counts check (
    n_recipients >= 1
    and n_new between 0 and n_recipients
    and n_seen_similar between 0 and n_recipients - n_new
    and n_unnamed_rows between 0 and n_rows
    and window_unnamed_rows >= 0),
  constraint ck_turnover_window check (
    window_last_fy = fy - 1 and window_first_fy = fy - 3)
);

comment on table internal.funder_recipient_turnover is
  'Per foundation and fiscal year: how many named Form 990-PF grant recipients were on none of the same foundation''s grant lists for the three fiscal years before. A count from past returns. No row means it cannot be told, never zero. Filled by `funderdb derive turnover`.';

-- ---------------------------------------------------------------------------
-- The analyst role reads exactly the SQL guard's allowlist (web migration
-- getfunded_0010). On a fresh database the 0022 default privilege would hand
-- it both new objects; on the live database that default is already gone and
-- these two lines change nothing. Either way the result is the same: no
-- analyst access until a migration and the allowlist say so together.
-- ---------------------------------------------------------------------------
revoke all on internal.mv_org_posture_history from funder_ro;
revoke all on internal.funder_recipient_turnover from funder_ro;

-- ---------------------------------------------------------------------------
-- refresh_dashboard_stats: the 0018 body plus the new view. The history view
-- comes straight after mv_org_application_posture so the two stay in step.
-- funder_recipient_turnover is a table, not a view: `funderdb derive
-- turnover` rebuilds it and this function does not touch it.
-- ---------------------------------------------------------------------------
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
  refresh materialized view internal.mv_org_latest_financials;
  refresh materialized view internal.mv_org_application_posture;
  refresh materialized view internal.mv_org_posture_history;
$$;

-- ---------------------------------------------------------------------------
-- Check (by hand, read-only):
--   select count(*) from internal.mv_org_posture_history;      -- one row per foundation with a parsed 990-PF
--   select count(*) from internal.funder_recipient_turnover;   -- 0 until `funderdb derive turnover` runs
--   uv run funderdb derive turnover --report                   -- dated counts and shares
--
-- Undo (by hand, as the owner, in one transaction). Run the web undo in
-- apps/web/migrations/getfunded_0014_application_history_grants.sql as well.
--   begin;
--   create or replace function internal.refresh_dashboard_stats() returns void
--   language sql set search_path = '' as $fn$
--     refresh materialized view internal.mv_overview_totals;
--     refresh materialized view internal.mv_org_type_counts;
--     refresh materialized view internal.mv_org_state_counts;
--     refresh materialized view internal.mv_event_type_totals;
--     refresh materialized view internal.mv_events_by_year;
--     refresh materialized view internal.mv_top_funders;
--     refresh materialized view internal.mv_amount_histogram;
--     refresh materialized view internal.mv_funder_event_stats;
--     refresh materialized view internal.mv_recipient_event_stats;
--     refresh materialized view internal.mv_org_latest_financials;
--     refresh materialized view internal.mv_org_application_posture;
--   $fn$;
--   drop table internal.funder_recipient_turnover;
--   drop materialized view internal.mv_org_posture_history;
--   drop function internal.restrictive_phrase(text);
--   delete from internal.schema_migrations where filename = '0029_application_history.sql';
--   commit;
-- The run manifests in internal.raw_files (dataset_name 'derive_turnover') and
-- the ledger rows stay: they are the record that the job ran.
-- ---------------------------------------------------------------------------
