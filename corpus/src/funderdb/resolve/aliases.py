"""Recipient aliases: filers as witnesses.

A foundation's return (Form 990-PF) names each grant recipient but gives no
EIN. A grant-making charity's return (Form 990, Schedule I) writes the EIN
next to the name. When several different charities wrote the same name and
state with ONE EIN, that is filer-stated evidence of which organisation the
name means. This job stores that evidence and, for the strict class only,
links the foundation grant rows that carry the same name, the same state and
a matching city to that organisation.

Four steps, each its own command (`funderdb resolve aliases ...`):

  --build    read the grant rows once per fiscal-year slice, store one row per
             (name, state) key in internal.recipient_aliases. Writes only the
             alias table, one raw_files row and one ledger row. An alias that
             grant rows are already linked through keeps its organisation,
             and its status and counts are refreshed from the new evidence.
  --report   read the stored columns and the build's ledger notes. Seconds.
  --apply    link 990-PF grant rows of the strict class and record one row per
             changed grant row in internal.recipient_alias_links.
  --unapply  remove exactly those links (only where the link is still ours).

Rules that never bend:
  * Only status 'unanimous' with 3 or more filers is applied. 'dominant',
    'contested' and two-filer keys are stored for review and never applied.
  * Only 990-PF rows are linked. An unlinked Schedule I row may carry an EIN
    we do not hold, so it is left alone.
  * No recipient name is rewritten, no amount changes, no organisation row is
    created. Nothing here calls a model.

Same safety pattern as resolve/recipients.py: memory guards on every heavy
statement, one fiscal-year slice per statement, a connection that is not a
`with` block so the apply can reconnect, and a cursor file under data/resolve.

The apply and the unapply work in batches of alias ids that size themselves:
they start small, grow while a batch is fast, and halve when a batch runs
into its time limit. A cursor file lets a restarted command pick up where it
stopped, but only when the file belongs to the same sweep (see _bound_to).
"""

from __future__ import annotations

import bisect
import csv
import json
import random
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import psycopg

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from .recipients import _MEMORY_GUARDS, CANDIDATE_TYPES

DATASET = "resolve_aliases"
LEDGER_APPLY = "resolve_aliases_apply"
LEDGER_UNAPPLY = "resolve_aliases_unapply"

# The apply never goes below this many independent filers.
MIN_FILERS_FLOOR = 3
# Normalised names shorter than this are never stored as an alias key.
MIN_NAME_LEN = 6
DOMINANT_MIN_FILERS = 5
DOMINANT_MIN_SHARE_PCT = 95

# Ledger name of the loads that add grant rows (sources.irs_990pf.DATASET). A
# cursor file of an apply is dropped when one of them finished after the sweep
# began: the rows it added belong to aliases the sweep has already passed.
GRANT_LOAD_DATASET = "irs_990_xml"

# Batches of alias ids (apply, unapply and their dry runs).
BATCH_START = 500           # alias ids in the first batch
BATCH_MAX = 5000            # a batch never grows past this
BATCH_TIMEOUT_S = 300.0     # time limit of one batch (statement_timeout)
BATCH_TIMEOUT_MAX_S = 3600.0  # the most one alias alone is ever given
DEADLOCK_RETRIES = 5        # per batch; the other writer wins, this job waits

RULE_TEXT = (
    "Witness = a Form 990 Schedule I grant row whose recipient EIN the filer wrote and we "
    "hold. Key = normalised recipient name + state. A key is stored when 2 or more different "
    "filers are witnesses, the name is 6 or more characters and not filler text, the key is "
    "not already in internal.recipient_matches, and the organisation type is one the name "
    "matcher may use. Status 'unanimous': every witness wrote the same EIN. 'dominant': more "
    "than one EIN, the top one has 5 or more filers and 95% or more of all filers. "
    "'contested': the rest, and any key where the filers that wrote the name with no EIN we "
    "hold are half as many as the witnesses or more. Apply: status 'unanimous', 3 or more "
    "filers, Form 990-PF grant rows only, same normalised name and state, and the city on "
    "the grant row is a city the witnesses wrote or the organisation's own city."
)

# Its own slice list, not recipients._RECIPS_SLICES: the back-year loads are
# filling fiscal years 2017 to 2020, which that list keeps in ONE slice.
_SLICES: tuple[str, ...] = (
    "fiscal_year is null",
    "fiscal_year < 2018",
    "fiscal_year = 2018",
    "fiscal_year = 2019",
    "fiscal_year = 2020",
    "fiscal_year = 2021",
    "fiscal_year = 2022",
    "fiscal_year = 2023",
    "fiscal_year = 2024",
    "fiscal_year >= 2025",
)

_RAW_DDL = """create temp table _alias_raw (
  kind text, nn text, st text, city text, org_id uuid, funder_org_id uuid,
  n bigint, amt numeric, min_fy smallint, max_fy smallint
) on commit drop"""

# One pass over a fiscal-year slice, three kinds of PARTIAL aggregate:
#   W  witness: Schedule I row with an EIN we hold (recipient_org_id set at load)
#   U  unlinked Schedule I row (the filer wrote no EIN, or one we do not hold)
#   T  target: 990-PF grant row with no organisation behind it yet
# Executed without parameters, so the LIKE patterns keep a single percent sign.
_RAW_SLICE = """
insert into _alias_raw
select k.kind,
       internal.norm_name(fe.recipient_name),
       nullif(btrim(fe.recipient_state), ''),
       case when k.kind = 'U' then null else internal.norm_name(fe.recipient_city) end,
       case when k.kind = 'W' then fe.recipient_org_id end,
       case when k.kind = 'T' then null else fe.funder_org_id end,
       count(*), sum(fe.amount), min(fe.fiscal_year), max(fe.fiscal_year)
from internal.funding_events fe
cross join lateral (
  select case
    when fe.source_record_key like 'irs990:%' and fe.recipient_org_id is not null then 'W'
    when fe.source_record_key like 'irs990:%' then 'U'
    when fe.source_record_key like 'irs990pf:%' and fe.recipient_org_id is null then 'T'
  end as kind
) k
where fe.event_type = 'grant'
  and fe.recipient_name is not null
  and nullif(btrim(fe.recipient_state), '') is not null
  and k.kind is not null
  and {pred}
group by 1, 2, 3, 4, 5, 6"""

# Roll-up, one statement each (psycopg prepares parameterised statements, so
# they cannot be batched). Temp tables get no autovacuum: analyze by hand.
_ROLLUP_STEPS: tuple[str, ...] = (
    "analyze _alias_raw",
    # Witnesses per (name, state, organisation).
    """create temp table _alias_w on commit drop as
       select nn, st, org_id,
              count(distinct funder_org_id)::int as n_filers,
              sum(n)::int as n_rows,
              array_agg(distinct city) filter (where city is not null and city <> '') as cities,
              min(min_fy) as first_fy, max(max_fy) as last_fy
       from _alias_raw where kind = 'W'
       group by 1, 2, 3""",
    # All filers and all organisations per key.
    """create temp table _alias_k on commit drop as
       select nn, st,
              count(distinct funder_org_id)::int as all_filers,
              count(distinct org_id)::int as n_orgs_seen
       from _alias_raw where kind = 'W'
       group by 1, 2""",
    # Filers that wrote the name with no EIN we hold.
    """create temp table _alias_u on commit drop as
       select nn, st,
              count(distinct funder_org_id)::int as n_unlinked_filers,
              sum(n)::bigint as n, sum(amt) as amt
       from _alias_raw where kind = 'U'
       group by 1, 2""",
    # Unlinked 990-PF rows per (name, state, city) and per (name, state).
    """create temp table _alias_t on commit drop as
       select nn, st, city, sum(n)::bigint as n, sum(amt) as amt
       from _alias_raw where kind = 'T'
       group by 1, 2, 3""",
    "drop table _alias_raw",
    """create temp table _alias_tk on commit drop as
       select nn, st, sum(n)::bigint as n, sum(amt) as amt
       from _alias_t group by 1, 2""",
    "create index on _alias_w (nn, st)",
    "create index on _alias_u (nn, st)",
    "create index on _alias_t (nn, st)",
    "create index on _alias_tk (nn, st)",
    "analyze _alias_w", "analyze _alias_k", "analyze _alias_u",
    "analyze _alias_t", "analyze _alias_tk",
    # Every witness key with its top organisation (most filers, then most
    # rows, then id so a tie never depends on scan order).
    """create temp table _alias_all on commit drop as
       select k.nn, k.st, t.org_id, t.n_filers, t.n_rows, k.n_orgs_seen, k.all_filers,
              coalesce(u.n_unlinked_filers, 0) as n_unlinked_filers,
              t.cities, t.first_fy, t.last_fy
       from _alias_k k
       join (
         select distinct on (w.nn, w.st)
                w.nn, w.st, w.org_id, w.n_filers, w.n_rows, w.cities, w.first_fy, w.last_fy
         from _alias_w w
         order by w.nn, w.st, w.n_filers desc, w.n_rows desc, w.org_id
       ) t on t.nn = k.nn and t.st = k.st
       left join _alias_u u on u.nn = k.nn and u.st = k.st""",
    "create index on _alias_all (nn, st)",
    "analyze _alias_all",
    # Keys with 2 or more filers, with the reasons a key may be set aside.
    """create temp table _alias_cand on commit drop as
       select a.*,
              o.org_type = any(%(types)s) as type_ok,
              internal.norm_name(o.city) as org_city,
              (length(a.nn) < %(min_len)s
               or internal.is_placeholder_recipient(a.nn)) as is_filler,
              exists (select 1 from internal.recipient_matches rm
                      where rm.recipient_name_normalized = a.nn
                        and rm.recipient_state = a.st) as in_matches
       from _alias_all a
       join internal.organizations o on o.id = a.org_id
       where a.all_filers >= 2""",
    # The rows to store. Shares are compared as whole numbers on purpose: a
    # `real` 0.95 is stored as 0.94999999, and `>= 0.95` would then be false
    # (the defect that silenced tier3 in resolve/recipients.py).
    """create temp table _alias_keep on commit drop as
       select c.nn, c.st, c.org_id, c.n_filers, c.n_rows, c.n_orgs_seen,
              (c.n_filers::real / c.all_filers) as top_share,
              c.n_unlinked_filers,
              coalesce((select array_agg(distinct x order by x)
                        from unnest(array_append(coalesce(c.cities, '{}'), c.org_city)) x
                        where x is not null and x <> ''), '{}') as witness_cities,
              c.first_fy, c.last_fy,
              case when c.n_unlinked_filers * 2 >= c.n_filers then 'contested'
                   when c.n_orgs_seen = 1 then 'unanimous'
                   when c.n_filers >= %(dom_filers)s
                        and c.n_filers * 100 >= c.all_filers * %(dom_pct)s then 'dominant'
                   else 'contested' end as status
       from _alias_cand c
       where c.type_ok and not c.is_filler and not c.in_matches""",
    "analyze _alias_keep",
    # Same column names as internal.recipient_aliases so one summary query
    # serves the dry run, the ledger notes and the report.
    """create temp table _alias_final on commit drop as
       select k.nn as recipient_name_normalized, k.st as recipient_state, k.org_id,
              k.n_filers, k.n_rows, k.n_orgs_seen::smallint as n_orgs_seen, k.top_share,
              k.n_unlinked_filers, k.witness_cities, k.first_fy, k.last_fy, k.status,
              coalesce(s.target_rows, 0)::int as target_rows,
              coalesce(s.rows_city_ok, 0)::int as target_rows_city_ok,
              case when coalesce(s.rows_city_ok, 0) = 0 then 0
                   else s.amount_city_ok end as target_amount_city_ok
       from _alias_keep k
       left join (
         select k2.nn, k2.st,
                sum(t.n) as target_rows,
                sum(t.n) filter (where t.city = any(k2.witness_cities)) as rows_city_ok,
                sum(t.amt) filter (where t.city = any(k2.witness_cities)) as amount_city_ok
         from _alias_keep k2
         join _alias_t t on t.nn = k2.nn and t.st = k2.st
         group by 1, 2
       ) s on s.nn = k.nn and s.st = k.st""",
    "analyze _alias_final",
)

# An alias that already has link rows is not touched by this statement: its
# org_id is what the links were made to, and `--unapply` compares against it.
# Its status and counts are refreshed by _REFRESH_LINKED instead.
_UPSERT = """
with up as (
  insert into internal.recipient_aliases
    (recipient_name_normalized, recipient_state, org_id, n_filers, n_rows, n_orgs_seen,
     top_share, n_unlinked_filers, witness_cities, first_fy, last_fy, status,
     target_rows, target_rows_city_ok, target_amount_city_ok,
     raw_file_id, source_record_locator)
  select f.recipient_name_normalized, f.recipient_state, f.org_id, f.n_filers, f.n_rows,
         f.n_orgs_seen, f.top_share, f.n_unlinked_filers, f.witness_cities, f.first_fy,
         f.last_fy, f.status, f.target_rows, f.target_rows_city_ok, f.target_amount_city_ok,
         %(rfid)s, 'alias:' || f.recipient_name_normalized || ':' || f.recipient_state
  from _alias_final f
  order by f.recipient_name_normalized, f.recipient_state
  on conflict (recipient_name_normalized, recipient_state) do update set
    org_id = excluded.org_id,
    n_filers = excluded.n_filers,
    n_rows = excluded.n_rows,
    n_orgs_seen = excluded.n_orgs_seen,
    top_share = excluded.top_share,
    n_unlinked_filers = excluded.n_unlinked_filers,
    witness_cities = excluded.witness_cities,
    first_fy = excluded.first_fy,
    last_fy = excluded.last_fy,
    status = excluded.status,
    target_rows = excluded.target_rows,
    target_rows_city_ok = excluded.target_rows_city_ok,
    target_amount_city_ok = excluded.target_amount_city_ok,
    raw_file_id = excluded.raw_file_id
  where not exists (select 1 from internal.recipient_alias_links l
                    where l.alias_id = internal.recipient_aliases.id)
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted), count(*) filter (where not inserted) from up"""

# A stored key this build no longer derives goes, unless links hang on it.
_DELETE_STALE = """
delete from internal.recipient_aliases ra
where not exists (select 1 from _alias_final f
                  where f.recipient_name_normalized = ra.recipient_name_normalized
                    and f.recipient_state = ra.recipient_state)
  and not exists (select 1 from internal.recipient_alias_links l where l.alias_id = ra.id)"""

# Aliases that grant rows are linked through, counted again under this
# build's evidence. The organisation never changes here (the links were made
# to it). Everything else is what this build says about THAT organisation:
#
#   * the build derives the key for the same organisation: every column is
#     the build's own row, status included;
#   * the build derives the key for another organisation, or does not derive
#     the key at all (too few filers, the key is now in recipient_matches,
#     filler text, organisation type): status is 'contested', and n_filers /
#     n_rows are the filers that still write the name with the stored
#     organisation's EIN (0 when none does; a true zero). top_share has no
#     value when no filer writes the name with any EIN, and stays empty.
#     witness_cities keeps the cities the links were made with.
#
# So `--apply`, which reads only the stored status and n_filers (_STRICT),
# links nothing new through an alias the evidence no longer supports.
_RELINK = """
create temp table _alias_relink on commit drop as
with linked as materialized (
  select ra.id, ra.recipient_name_normalized as nn, ra.recipient_state as st,
         ra.org_id, ra.witness_cities
  from internal.recipient_aliases ra
  where exists (select 1 from internal.recipient_alias_links l where l.alias_id = ra.id)
)
select d.id as alias_id,
       f.recipient_name_normalized is not null as derived,
       x.same as same_org,
       case when x.same then f.status else 'contested' end as status,
       case when x.same then f.n_filers else coalesce(w.n_filers, 0) end as n_filers,
       case when x.same then f.n_rows else coalesce(w.n_rows, 0) end as n_rows,
       (case when x.same then f.n_orgs_seen
             else coalesce(k.n_orgs_seen, 0) end)::smallint as n_orgs_seen,
       case when x.same then f.top_share
            when coalesce(k.all_filers, 0) = 0 then null
            else (coalesce(w.n_filers, 0)::real / k.all_filers) end as top_share,
       case when x.same then f.n_unlinked_filers
            else coalesce(u.n_unlinked_filers, 0) end as n_unlinked_filers,
       case when x.same then f.witness_cities else d.witness_cities end as witness_cities,
       case when x.same then f.first_fy else w.first_fy end as first_fy,
       case when x.same then f.last_fy else w.last_fy end as last_fy,
       case when x.same then f.target_rows else coalesce(tk.n, 0)::int end as target_rows,
       case when x.same then f.target_rows_city_ok
            else coalesce(tc.rows_city_ok, 0)::int end as target_rows_city_ok,
       case when x.same then f.target_amount_city_ok
            when coalesce(tc.rows_city_ok, 0) = 0 then 0
            else tc.amount_city_ok end as target_amount_city_ok
from linked d
left join _alias_final f
  on f.recipient_name_normalized = d.nn and f.recipient_state = d.st
cross join lateral (select coalesce(f.org_id = d.org_id, false) as same) x
left join _alias_w w on w.nn = d.nn and w.st = d.st and w.org_id = d.org_id
left join _alias_k k on k.nn = d.nn and k.st = d.st
left join _alias_u u on u.nn = d.nn and u.st = d.st
left join _alias_tk tk on tk.nn = d.nn and tk.st = d.st
left join lateral (
  select sum(t.n) as rows_city_ok, sum(t.amt) as amount_city_ok
  from _alias_t t
  where t.nn = d.nn and t.st = d.st and t.city = any(d.witness_cities)
) tc on true"""

_RELINK_TOTALS = """
select count(*)::bigint,
       count(*) filter (where not (status = 'unanimous'
                                   and n_filers >= %(min_filers)s))::bigint,
       count(*) filter (where derived and not same_org)::bigint,
       count(*) filter (where not derived)::bigint,
       count(*) filter (where top_share is null)::bigint
from _alias_relink"""

_REFRESH_LINKED = """
update internal.recipient_aliases ra set
  n_filers = r.n_filers,
  n_rows = r.n_rows,
  n_orgs_seen = r.n_orgs_seen,
  top_share = r.top_share,
  n_unlinked_filers = r.n_unlinked_filers,
  witness_cities = r.witness_cities,
  first_fy = r.first_fy,
  last_fy = r.last_fy,
  status = r.status,
  target_rows = r.target_rows,
  target_rows_city_ok = r.target_rows_city_ok,
  target_amount_city_ok = r.target_amount_city_ok,
  raw_file_id = %(rfid)s
from _alias_relink r
where r.alias_id = ra.id"""

# Linked aliases against the rule the apply uses, read from the stored rows.
# {strict} is _STRICT, so "supported" here is exactly "the apply would use it".
_LINKED_SUPPORT = """
select count(*)::bigint,
       coalesce(sum(x.n), 0)::bigint,
       count(*) filter (where not x.ok)::bigint,
       coalesce(sum(x.n) filter (where not x.ok), 0)::bigint
from (
  select ({strict}) as ok,
         (select count(*) from internal.recipient_alias_links l
          where l.alias_id = ra.id) as n
  from internal.recipient_aliases ra
  where exists (select 1 from internal.recipient_alias_links l where l.alias_id = ra.id)
) x"""

# Keys per class with the 990-PF rows behind them. {source} is the alias
# table or the build's temp copy; both carry the same column names.
_SUMMARY = """
select s.status,
       (s.n_filers >= %(min_filers)s) as enough_filers,
       exists (select 1 from internal.recipient_matches rm
               where rm.recipient_name_normalized = s.recipient_name_normalized
                 and rm.recipient_state = s.recipient_state) as in_matches,
       count(*)::bigint as keys,
       count(*) filter (where s.target_rows_city_ok > 0)::bigint as keys_with_rows,
       coalesce(sum(s.target_rows), 0)::bigint as target_rows,
       coalesce(sum(s.target_rows_city_ok), 0)::bigint as rows_city_ok,
       sum(s.target_amount_city_ok) as amount_city_ok
from {source} s
group by 1, 2, 3
order by 1, 2 desc, 3"""

_BUILD_TOTALS = """
select count(*)::bigint as witness_keys,
       count(*) filter (where all_filers = 1)::bigint as single_witness_keys,
       count(*) filter (where all_filers >= 2)::bigint as keys_2plus_filers
from _alias_all"""

_SINGLE_WITNESS_ROWS = """
select count(*)::bigint, coalesce(sum(tk.n), 0)::bigint
from _alias_all a
join _alias_tk tk on tk.nn = a.nn and tk.st = a.st
where a.all_filers = 1"""

_DROPPED = """
select count(*) filter (where in_matches)::bigint,
       count(*) filter (where not in_matches and is_filler)::bigint,
       count(*) filter (where not in_matches and not is_filler and not type_ok)::bigint
from _alias_cand"""

_ROW_TOTALS = """
select (select coalesce(sum(n_rows), 0)::bigint from _alias_w),
       (select coalesce(sum(n), 0)::bigint from _alias_tk),
       (select count(*)::bigint from _alias_tk),
       (select coalesce(sum(n), 0)::bigint from _alias_u)"""

# How the existing name matcher agrees with what filers wrote. "strict" is the
# like-for-like class: one EIN, 3 or more filers, few EIN-less filers.
_TIER_AGREEMENT = """
select rm.method,
       count(*)::bigint as keys,
       count(a.nn)::bigint as keys_with_witness,
       count(*) filter (where a.org_id = rm.org_id)::bigint as keys_agree,
       count(*) filter (where a.n_orgs_seen = 1 and a.n_filers >= %(min_filers)s
                          and a.n_unlinked_filers * 2 < a.n_filers)::bigint as strict_keys,
       count(*) filter (where a.n_orgs_seen = 1 and a.n_filers >= %(min_filers)s
                          and a.n_unlinked_filers * 2 < a.n_filers
                          and a.org_id = rm.org_id)::bigint as strict_agree
from internal.recipient_matches rm
left join _alias_all a
  on a.nn = rm.recipient_name_normalized and a.st = rm.recipient_state
where rm.status in ('auto', 'accepted')
group by 1 order by 1"""

# Rows a tier3 apply would link: unlinked grant rows whose key has a tier3
# match. 990-PF rows come from the target partials, Schedule I rows from the
# unlinked partials.
_TIER3_WOULD_ADD = """
select (select count(*)::bigint from tier3 join _alias_tk tk using (nn, st)),
       (select coalesce(sum(tk.n), 0)::bigint from tier3 join _alias_tk tk using (nn, st)),
       (select sum(tk.amt) from tier3 join _alias_tk tk using (nn, st)),
       (select coalesce(sum(u.n), 0)::bigint from tier3 join _alias_u u using (nn, st)),
       (select sum(u.amt) from tier3 join _alias_u u using (nn, st))
from (select 1) one"""

_TIER3_CTE = """
with tier3 as materialized (
  select rm.recipient_name_normalized as nn, rm.recipient_state as st
  from internal.recipient_matches rm
  where rm.method = 'tier3' and rm.status in ('auto', 'accepted')
)"""

# Which aliases the apply may use. One unique-index probe per alias keeps a
# later `resolve recipients` run and this job from linking the same key twice.
_STRICT = """ra.status = 'unanimous'
      and ra.n_filers >= %(min_filers)s
      and not exists (
        select 1 from internal.recipient_matches rm
        where rm.recipient_name_normalized = ra.recipient_name_normalized
          and rm.recipient_state = ra.recipient_state)"""

# The grant rows one alias reaches. Written as a LATERAL probe with OFFSET 0
# for the reason given at recipients._APPLY_BATCH: one index probe on
# ix_events_recipient_norm per alias, whatever the statistics think. Executed
# WITH parameters, so the LIKE pattern doubles its percent sign.
_PROBE = """
      select fe2.id, fe2.amount
      from internal.funding_events fe2
      where internal.norm_name(fe2.recipient_name) = ra.recipient_name_normalized
        and fe2.event_type = 'grant'
        and fe2.recipient_org_id is null
        and fe2.source_record_key like 'irs990pf:%%'
        and nullif(btrim(fe2.recipient_state), '') = ra.recipient_state
        and internal.norm_name(fe2.recipient_city) = any(ra.witness_cities)
      offset 0"""

# The outer test "still no organisation" is there for a row that another job
# linked after this statement took its snapshot: Postgres re-checks the outer
# row, not the lateral probe, so without it the newer link would be written
# over. It is spelled num_nonnulls(...) = 0, not IS NULL, on purpose: IS NULL
# would offer the planner the index on recipient_org_id (millions of empty
# rows) as a way into the table; this form can only be a filter on the row
# the primary key already found.
_APPLY_BATCH = f"""
with linked as (
  update internal.funding_events fe
  set recipient_org_id = t.org_id
  from (
    select hit.id as event_id, ra.org_id, ra.id as alias_id
    from internal.recipient_aliases ra
    cross join lateral ({_PROBE}
    ) hit
    where ra.id between %(lo)s and %(hi)s
      and {_STRICT}
  ) t
  where fe.id = t.event_id
    and num_nonnulls(fe.recipient_org_id) = 0
  returning fe.id as event_id, t.alias_id
)
insert into internal.recipient_alias_links (event_id, alias_id)
select event_id, alias_id from linked
on conflict (event_id) do update
  set alias_id = excluded.alias_id, linked_at = now()"""

_APPLY_DRY_BATCH = f"""
select count(*)::bigint, count(distinct ra.id)::bigint, sum(hit.amount)
from internal.recipient_aliases ra
cross join lateral ({_PROBE}
) hit
where ra.id between %(lo)s and %(hi)s
  and {_STRICT}"""

# Undo. A row is set back to "no organisation" only where the link is still
# the one this job made (same organisation as the alias). A row that a later
# job or a person changed keeps its newer value. The link rows of the batch go
# either way.
_UNAPPLY_BATCH = """
with ours as (
  update internal.funding_events fe
  set recipient_org_id = null
  from (
    select l.event_id, ra.org_id
    from internal.recipient_alias_links l
    join internal.recipient_aliases ra on ra.id = l.alias_id
    where l.alias_id between %(lo)s and %(hi)s
    offset 0
  ) t
  where fe.id = t.event_id
    and fe.recipient_org_id = t.org_id
  returning fe.id
), gone as (
  delete from internal.recipient_alias_links l
  where l.alias_id between %(lo)s and %(hi)s
  returning l.event_id
)
select (select count(*) from ours)::bigint, (select count(*) from gone)::bigint"""

_UNAPPLY_DRY_BATCH = """
select count(*)::bigint,
       count(*) filter (where fe.recipient_org_id = ra.org_id)::bigint
from internal.recipient_alias_links l
join internal.recipient_aliases ra on ra.id = l.alias_id
join internal.funding_events fe on fe.id = l.event_id
where l.alias_id between %(lo)s and %(hi)s"""

_SAMPLE_POOL = f"""
select ra.id, ra.target_rows_city_ok
from internal.recipient_aliases ra
where ra.target_rows_city_ok > 0
  and {_STRICT}
order by ra.id"""

_SAMPLE_PROBE = f"""
select hit.id
from internal.recipient_aliases ra
cross join lateral ({_PROBE}
) hit
where ra.id = %(alias_id)s
  and {_STRICT}
order by hit.id"""

_SAMPLE_DETAIL = """
select fe.id::text, fo.name, fe.recipient_name, fe.recipient_city, fe.recipient_state,
       o.name, o.city, o.state,
       (select min(i.id_value) from internal.org_identifiers i
        where i.org_id = o.id and i.id_type = 'ein'),
       o.ntee_code, ra.n_filers, fe.fiscal_year, fe.amount, ra.id
from unnest(%(event_ids)s::uuid[], %(alias_ids)s::bigint[]) as s(event_id, alias_id)
join internal.funding_events fe on fe.id = s.event_id
join internal.recipient_aliases ra on ra.id = s.alias_id
join internal.organizations o on o.id = ra.org_id
left join internal.organizations fo on fo.id = fe.funder_org_id
order by ra.id, fe.id"""

SAMPLE_COLUMNS = (
    "grant_row_id", "funder_name",
    "recipient_name_as_filed", "recipient_city_as_filed", "recipient_state_as_filed",
    "linked_org_name", "linked_org_city", "linked_org_state", "linked_org_ein",
    "linked_org_ntee_code", "n_filers",
    "fiscal_year", "amount", "alias_id",
)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _resolve_dir() -> Path:
    return Path(get_settings().data_root) / "resolve"


def _cursor_path(action: str) -> Path:
    return _resolve_dir() / f"aliases_{action}_cursor.json"


def _json_default(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def _require_schema(cur) -> None:
    cur.execute("""select to_regclass('internal.recipient_aliases') is not null
                          and to_regclass('internal.recipient_alias_links') is not null
                          and to_regprocedure('internal.is_placeholder_recipient(text)')
                              is not null""")
    if not cur.fetchone()[0]:
        raise RuntimeError(
            "internal.recipient_aliases is not there yet. Apply migration "
            "0027_recipient_aliases.sql first: `uv run funderdb migrate`.")


def _require_empty_share_allowed(cur) -> None:
    """Migration 0034 lets top_share be empty. Without it the refresh of a
    linked alias that has no witness left would fail on a NOT NULL rule."""
    cur.execute("""select a.attnotnull from pg_attribute a
                   where a.attrelid = 'internal.recipient_aliases'::regclass
                     and a.attname = 'top_share'""")
    if cur.fetchone()[0]:
        raise RuntimeError(
            "An alias that already has links has no witness left, and its share of filers "
            "must be stored as empty. Apply migration 0034_placeholder_recipient_v2.sql "
            "first: `uv run funderdb migrate`. Nothing was stored by this build.")


def _check_min_filers(min_filers: int) -> None:
    if min_filers < MIN_FILERS_FLOOR:
        raise ValueError(
            f"--min-filers {min_filers} is below the floor of {MIN_FILERS_FLOOR}. Two-filer "
            "aliases are stored for review only; they are not applied until a person has "
            "labelled a sample.")


def _guards(cur, timeout: str) -> None:
    cur.execute(f"set local statement_timeout = '{timeout}'")
    for guard in _MEMORY_GUARDS:
        cur.execute(guard)


def _nested_loops_only(cur, timeout_s: float = 900.0) -> None:
    # Same reason as recipients.apply_matches: at this table size the planner
    # may flip a batch to a merge or hash join that reads the whole grants
    # table. Nested loops keep every batch on index probes. Sequential scans
    # are switched off as well: every table these statements touch is reached
    # through an index (alias id range, the name index, primary keys), so no
    # cost estimate can talk the planner into reading the grants table whole.
    # A bare number is milliseconds.
    cur.execute(f"set local statement_timeout = {max(int(timeout_s * 1000), 1)}")
    cur.execute("set local enable_mergejoin = off")
    cur.execute("set local enable_hashjoin = off")
    cur.execute("set local enable_seqscan = off")


def _summary_rows(cur, source: str, min_filers: int) -> list[dict]:
    cur.execute(_SUMMARY.format(source=source), {"min_filers": min_filers})
    cols = ("status", "enough_filers", "in_matches", "keys", "keys_with_rows",
            "target_rows", "rows_city_ok", "amount_city_ok")
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def _strict_totals(summary: list[dict]) -> dict:
    """What the apply would touch, from a summary: the strict class only."""
    strict = [r for r in summary
              if r["status"] == "unanimous" and r["enough_filers"] and not r["in_matches"]]
    amounts = [r["amount_city_ok"] for r in strict if r["amount_city_ok"] is not None]
    return {
        "strict_keys": sum(r["keys"] for r in strict),
        "strict_keys_with_rows": sum(r["keys_with_rows"] for r in strict),
        "strict_rows_would_link": sum(r["rows_city_ok"] for r in strict),
        "strict_rows_held_back_by_city": sum(r["target_rows"] - r["rows_city_ok"]
                                             for r in strict),
        "strict_amount_would_link": str(sum(amounts, Decimal(0))) if amounts else None,
    }


def _money(value, rows: int | None = None) -> str:
    """Dollars for a report line. A missing amount is said, never shown as 0.
    Pass `rows` when the amount is a sum: no rows at all is a true zero."""
    if value is None:
        return "$0" if rows == 0 else "not available"
    return f"${Decimal(str(value)):,.0f}"


def _pct(part: int, whole: int) -> str:
    return "not available" if not whole else f"{100.0 * part / whole:.2f}%"


def _utc(stamp: datetime) -> str:
    return f"{stamp.astimezone(timezone.utc):%Y-%m-%d %H:%M}"


_STATUS_ORDER = {"unanimous": 0, "dominant": 1, "contested": 2}


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def _run_rollup(cur, notes: dict, min_filers: int) -> list[dict]:
    """Slices, roll-up and build totals. Leaves _alias_final and friends in
    the open transaction; fills `notes` with what the report cannot re-read."""
    _guards(cur, "60min")
    cur.execute(_RAW_DDL)
    notes["slices"] = []
    for pred in _SLICES:
        cur.execute(_RAW_SLICE.format(pred=pred))
        notes["slices"].append({"slice": pred, "partials": cur.rowcount})
        print(f"  slice [{pred}]: {cur.rowcount:,} partials", flush=True)
    params = {"types": list(CANDIDATE_TYPES), "min_len": MIN_NAME_LEN,
              "dom_filers": DOMINANT_MIN_FILERS, "dom_pct": DOMINANT_MIN_SHARE_PCT}
    for step in _ROLLUP_STEPS:
        cur.execute(step, params if "%(" in step else None)
    print("  roll-up done", flush=True)

    cur.execute(_ROW_TOTALS)
    (notes["witness_rows"], notes["target_rows_unlinked_990pf"],
     notes["target_keys_unlinked_990pf"], notes["unlinked_schedule_i_rows"]) = cur.fetchone()
    cur.execute(_BUILD_TOTALS)
    (notes["witness_keys"], notes["single_witness_keys"],
     notes["keys_2plus_filers"]) = cur.fetchone()
    cur.execute(_SINGLE_WITNESS_ROWS)
    (notes["single_witness_keys_with_990pf_rows"],
     notes["single_witness_990pf_rows"]) = cur.fetchone()
    cur.execute(_DROPPED)
    (notes["dropped_in_recipient_matches"], notes["dropped_filler_or_short"],
     notes["dropped_org_type"]) = cur.fetchone()

    cur.execute(_TIER_AGREEMENT, {"min_filers": min_filers})
    cols = ("keys", "keys_with_witness", "keys_agree", "strict_keys", "strict_agree")
    notes["tier_agreement"] = {row[0]: dict(zip(cols, row[1:])) for row in cur.fetchall()}
    for tier in ("tier1", "tier2"):
        if tier in notes["tier_agreement"]:
            notes["tier_agreement"][tier]["label"] = (
                "upper bound, includes rows the matcher linked itself")
    if "tier3" in notes["tier_agreement"]:
        # Clean only while tier3 has never been applied. `resolve recipients
        # --max-tier 3` leaves "tier3_applied" in its ledger notes.
        cur.execute("""select max(completed_at) from internal.ingestion_ledger
                       where dataset_name = 'resolve_recipients' and status = 'completed'
                         and notes like '%"tier3_applied"%'""")
        applied_at = cur.fetchone()[0]
        notes["tier_agreement"]["tier3"]["label"] = (
            "clean: tier3 matches were never applied, so every witness is an EIN the "
            "filer wrote" if applied_at is None else
            f"upper bound: tier3 was applied on {_utc(applied_at)} UTC, so it includes rows "
            "the matcher linked itself")
    cur.execute(_TIER3_CTE + _TIER3_WOULD_ADD)
    row = cur.fetchone()
    notes["tier3_would_add"] = {
        "keys_with_990pf_rows": row[0], "rows_990pf": row[1], "amount_990pf": row[2],
        "rows_schedule_i": row[3], "amount_schedule_i": row[4],
    }

    summary = _summary_rows(cur, "_alias_final", min_filers)
    notes["summary_at_build"] = summary
    notes.update(_strict_totals(summary))

    cur.execute(_RELINK)
    cur.execute(_RELINK_TOTALS, {"min_filers": min_filers})
    (notes["linked_aliases"], notes["linked_aliases_no_longer_supported"],
     notes["linked_aliases_other_org_now"], notes["linked_aliases_not_derived_now"],
     notes["linked_aliases_no_witness_now"]) = cur.fetchone()
    return summary


def build(dry_run: bool = False) -> dict:
    """Derive the alias rows. With dry_run nothing is stored: the roll-up runs
    in temp tables, the counts print, and the transaction rolls back."""
    settings = get_settings()
    conn = connect()
    try:
        with conn.cursor() as cur:
            _require_schema(cur)
            cur.execute("select pg_get_functiondef("
                        "'internal.is_placeholder_recipient(text)'::regprocedure)")
            placeholder_def = cur.fetchone()[0]
        conn.rollback()

        notes: dict = {"action": "build", "min_filers_apply": MIN_FILERS_FLOOR}
        if dry_run:
            with conn.cursor() as cur:
                _run_rollup(cur, notes, MIN_FILERS_FLOOR)
            conn.rollback()
            print("  dry run: nothing stored", flush=True)
            return _flat_counts(notes)

        manifest_dir = Path(settings.data_root) / "resolve"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        built_at = datetime.now(timezone.utc)
        manifest = manifest_dir / f"aliases-{built_at:%Y%m%d-%H%M%S}.json"
        manifest.write_text(json.dumps({
            "job": "aliases",
            "built_at": built_at.isoformat(),
            "rule": RULE_TEXT,
            "thresholds": {
                "min_filers_stored": 2,
                "min_filers_apply": MIN_FILERS_FLOOR,
                "min_name_length": MIN_NAME_LEN,
                "dominant_min_filers": DOMINANT_MIN_FILERS,
                "dominant_min_share_pct": DOMINANT_MIN_SHARE_PCT,
                "contested_when": "n_unlinked_filers * 2 >= n_filers",
            },
            "slices": _SLICES,
            "candidate_types": CANDIDATE_TYPES,
            "placeholder_function": placeholder_def,
        }, indent=2))
        staged = staging.stage_local(DATASET, manifest)
        rfid = staging.register_raw_file(conn, staged, license_code="cc_by",
                                         content_type="application/json")
        conn.commit()
        run_id = ledger.start_run(conn, rfid, DATASET)
        notes["raw_file_id"] = rfid
        notes["manifest_sha256"] = staged.sha256

        try:
            with conn.cursor() as cur:
                _run_rollup(cur, notes, MIN_FILERS_FLOOR)
                cur.execute(_UPSERT, {"rfid": rfid})
                notes["aliases_inserted"], notes["aliases_updated"] = cur.fetchone()
                cur.execute(_DELETE_STALE)
                notes["aliases_deleted"] = cur.rowcount
                if notes["linked_aliases_no_witness_now"]:
                    _require_empty_share_allowed(cur)
                cur.execute(_REFRESH_LINKED, {"rfid": rfid})
                notes["linked_aliases_refreshed"] = cur.rowcount
                cur.execute("select count(*) from internal.recipient_aliases")
                notes["aliases_stored"] = cur.fetchone()[0]
            conn.commit()
            ledger.complete_run(conn, run_id,
                                inserted=notes["aliases_inserted"],
                                updated=(notes["aliases_updated"]
                                         + notes["linked_aliases_refreshed"]),
                                notes=json.dumps(notes, default=_json_default))
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
        return _flat_counts(notes)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _flat_counts(notes: dict) -> dict:
    """The integer facts of a build, for the CLI to print one per line."""
    keys = ("witness_rows", "witness_keys", "single_witness_keys", "keys_2plus_filers",
            "dropped_in_recipient_matches", "dropped_filler_or_short", "dropped_org_type",
            "target_rows_unlinked_990pf", "unlinked_schedule_i_rows",
            "aliases_inserted", "aliases_updated", "aliases_deleted",
            "linked_aliases", "linked_aliases_refreshed",
            "linked_aliases_no_longer_supported", "linked_aliases_other_org_now",
            "linked_aliases_not_derived_now",
            "aliases_stored", "strict_keys", "strict_keys_with_rows",
            "strict_rows_would_link", "strict_rows_held_back_by_city")
    out = {k: notes[k] for k in keys if isinstance(notes.get(k), int)}
    for row in notes.get("summary_at_build", []):
        label = f"keys_{row['status']}_" + (
            f"{MIN_FILERS_FLOOR}plus_filers" if row["enough_filers"] else "2_filers")
        out[label] = out.get(label, 0) + row["keys"]
    return out


# ---------------------------------------------------------------------------
# apply / unapply
# ---------------------------------------------------------------------------
def _alias_bounds(conn) -> tuple[int, int, int | None]:
    with conn.cursor() as cur:
        _require_schema(cur)
        cur.execute("select coalesce(min(id), 0), coalesce(max(id), -1), max(raw_file_id) "
                    "from internal.recipient_aliases")
        lo_id, hi_id, rfid = cur.fetchone()
    conn.rollback()
    return lo_id, hi_id, rfid


class SweepIncomplete(RuntimeError):
    """A sweep reached its end but had to leave aliases out. What it did is
    committed; the command must not be reported as finished."""


def _elapsed(seconds: float) -> str:
    whole = int(seconds)
    return f"{whole // 3600}:{whole % 3600 // 60:02d}:{whole % 60:02d}"


def _bound_to(conn, action: str, min_filers: int | None, lo_id: int, hi_id: int) -> dict:
    """What a cursor file belongs to. A file is used only when every value
    here is the same as when the file was written:

      direction                  an apply never resumes an unapply's file
      build_run                  ledger id of the last finished `--build`; a
                                 newer build may have changed any alias
      last_run_other_direction   ledger id of the newest run in the other
                                 direction, whatever its state; an unapply
                                 after a stopped apply (or the reverse) undid
                                 the batches the file says are done
      first/last_alias_id        the id range of the sweep
      min_filers                 (apply) the rule the batches were run with
      last_grant_load_run        (apply) ledger id of the newest finished load
                                 of returns; a load after the sweep began
                                 added grant rows to aliases already passed
    """
    other = LEDGER_UNAPPLY if action == "apply" else LEDGER_APPLY
    with conn.cursor() as cur:
        cur.execute(
            """select (select max(id) from internal.ingestion_ledger
                       where dataset_name = %s and status = 'completed'),
                      (select max(id) from internal.ingestion_ledger
                       where dataset_name = %s),
                      (select max(id) from internal.ingestion_ledger
                       where dataset_name = %s and status = 'completed')""",
            (DATASET, other, GRANT_LOAD_DATASET))
        build_run, other_run, load_run = cur.fetchone()
    conn.rollback()
    bound = {"direction": action, "build_run": build_run,
             "last_run_other_direction": other_run,
             "first_alias_id": lo_id, "last_alias_id": hi_id}
    if action == "apply":
        bound["min_filers"] = min_filers
        bound["last_grant_load_run"] = load_run
    return bound


def _shown(value) -> str:
    return "not set" if value is None else str(value)


def _drop_other_cursor(action: str) -> None:
    """An apply makes an unfinished unapply's cursor wrong, and the reverse:
    the batches that file calls done are being changed again."""
    other = "unapply" if action == "apply" else "apply"
    path = _cursor_path(other)
    if path.exists():
        path.unlink()
        print(f"  removed {path.name}: it is the cursor of an unfinished {other}, and this "
              f"{action} changes the rows it counted as done", flush=True)


def _read_cursor(action: str, bound: dict, lo_id: int, hi_id: int) -> dict | None:
    """The saved cursor when it belongs to this sweep, else None. Every
    reason to ignore a file is printed. Starting at the first alias is always
    correct: a batch that finds nothing left to do changes nothing."""
    path = _cursor_path(action)
    if not path.exists():
        return None
    try:
        saved = json.loads(path.read_text())
        nxt = int(saved["next"])
        saved_bound = saved["bound_to"]
        if not isinstance(saved_bound, dict):
            raise TypeError("bound_to")
    except (ValueError, KeyError, TypeError):
        print(f"  {path.name} is not a cursor this version wrote; it is ignored and the "
              f"{action} starts at the first alias", flush=True)
        return None
    if saved_bound != bound:
        changed = "; ".join(
            f"{k} was {_shown(saved_bound.get(k))}, is now {_shown(bound.get(k))}"
            for k in sorted(set(bound) | set(saved_bound))
            if saved_bound.get(k) != bound.get(k))
        print(f"  {path.name} belongs to another sweep ({changed}); it is ignored and the "
              f"{action} starts at the first alias", flush=True)
        return None
    if not lo_id <= nxt <= hi_id + 1:
        print(f"  {path.name} points outside the alias ids; it is ignored and the "
              f"{action} starts at the first alias", flush=True)
        return None
    return saved


def _sweep(live: dict, action: str, statement: str, params: dict,
           lo_id: int, hi_id: int, counts: dict, on_batch, label, *,
           batch: int, timeout_s: float, bound: dict | None, write: bool) -> dict:
    """Run `statement` over batches of alias ids, one transaction per batch.

    The batch sizes itself. It starts at `batch` ids, doubles after a batch
    that was fast, and halves after a slow one. A batch that runs into its
    time limit writes nothing; it is halved and tried again, and the batch
    does not grow again until the sweep is past the stretch that was last
    too slow. One alias that
    is too slow on its own gets longer limits, and if the longest is not
    enough it is SKIPPED and listed, so one dense alias never stops the run.
    A deadlock with another writer is waited out and tried again.

    `live["conn"]` is the connection; it is replaced here when the server
    drops it (the loaded instance can stall past TCP patience), so the caller
    always holds the live one. A batch that is tried again is safe because
    every batch is idempotent.

    `bound` is what the cursor file must belong to (_bound_to); None means no
    cursor file (dry runs). `counts` is the caller's running totals: they are
    saved in the cursor file and put back on a resume, so a resumed sweep
    reports the whole sweep and not only its last part.

    Returns what the caller needs to say whether every alias was visited.
    """
    cursor_file = _cursor_path(action) if bound is not None else None
    size = max(int(batch), 1)
    size_max = max(BATCH_MAX, size)
    limit = float(timeout_s)
    limit_max = max(limit, min(limit * 16, BATCH_TIMEOUT_MAX_S))
    fast_s, slow_s = limit / 15, limit * 0.4
    started_at = f"{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}"
    skipped: list[int] = []
    lo, resumed_from = lo_id, None
    if cursor_file is not None:
        saved = _read_cursor(action, bound, lo_id, hi_id)
        if saved is not None:
            lo = resumed_from = int(saved["next"])
            started_at = str(saved.get("started_at") or started_at)
            skipped = [int(x) for x in saved.get("skipped") or []]
            for key, value in (saved.get("totals") or {}).items():
                if key in counts and isinstance(value, int):
                    counts[key] = value
            print(f"  resuming {action} at alias id {lo:,}. Ids {lo_id:,} to {lo - 1:,} were "
                  f"done by the run that began {started_at} UTC (cursor file)", flush=True)

    def save_cursor(next_id: int) -> None:
        if cursor_file is None:
            return
        cursor_file.parent.mkdir(parents=True, exist_ok=True)
        cursor_file.write_text(json.dumps({
            "bound_to": bound, "next": next_id, "started_at": started_at,
            "skipped": skipped,
            "totals": {k: v for k, v in counts.items() if isinstance(v, int)}}))

    t_start = time.monotonic()
    span = hi_id - lo_id + 1
    hold_growth_until = lo_id - 1
    lost, deadlocks, timeouts, batches = 0, 0, 0, 0
    while lo <= hi_id:
        hi = min(lo + size - 1, hi_id)
        conn = live["conn"]
        t0 = time.monotonic()
        try:
            with conn.cursor() as cur:
                _nested_loops_only(cur, limit)
                cur.execute(statement, {**params, "lo": lo, "hi": hi})
                result = cur.fetchone() if cur.description else None
                rowcount = cur.rowcount
            if write:
                conn.commit()
            else:
                conn.rollback()
        except psycopg.OperationalError as exc:
            if conn.closed or conn.broken:
                lost += 1
                if lost > 5:
                    raise
                print(f"  {action} connection lost, reconnecting (attempt {lost}/5)",
                      flush=True)
                try:
                    conn.close()
                except Exception:
                    pass
                time.sleep(15)
                live["conn"] = connect()
                continue
            conn.rollback()
            timed_out = (isinstance(exc, psycopg.errors.QueryCanceled)
                         and "statement timeout" in str(exc))
            deadlocked = isinstance(exc, psycopg.errors.DeadlockDetected)
            if not (timed_out or deadlocked):
                # Anything else (a cancel by hand, a lock timeout) is not ours
                # to hide: the run stops and the cursor file stays.
                raise
            why = (f"no answer within {limit:,.0f}s" if timed_out
                   else "stopped by the database to end a deadlock with another writer")
            if timed_out:
                timeouts += 1
            if hi > lo:
                size = max((hi - lo + 1) // 2, 1)
                # The newest failure, not the widest: as the halving closes
                # in on the dense alias the held stretch shrinks with it, and
                # the batch may grow again as soon as that alias is behind.
                hold_growth_until = hi
                print(f"  {action} ids {lo:,}-{hi:,}: {why}. Nothing was written for this "
                      f"batch. Trying again with {size:,} ids", flush=True)
                continue
            hold_growth_until = lo
            if timed_out and limit < limit_max:
                limit = min(limit * 4, limit_max)
                print(f"  {action} alias id {lo:,}: {why}. Trying this one alias again with "
                      f"a limit of {limit:,.0f}s", flush=True)
                continue
            if deadlocked and deadlocks < DEADLOCK_RETRIES:
                deadlocks += 1
                print(f"  {action} alias id {lo:,}: {why}. Trying again in "
                      f"{5 * deadlocks}s (attempt {deadlocks}/{DEADLOCK_RETRIES})", flush=True)
                time.sleep(5 * deadlocks)
                continue
            skipped.append(lo)
            hold_growth_until = lo
            print(f"  {action} alias id {lo:,}: {why}, and no try is left. SKIPPED, nothing "
                  "was written for it. The sweep goes on", flush=True)
            lo, limit, deadlocks = lo + 1, float(timeout_s), 0
            save_cursor(lo)
            continue

        took = time.monotonic() - t0
        # Counted only after the commit, so a batch that is tried again is
        # not counted twice.
        first = next(iter(counts))
        before = counts[first]
        on_batch(result, rowcount)
        batches += 1
        lost, deadlocks, limit = 0, 0, float(timeout_s)
        save_cursor(hi + 1)
        done = hi - lo_id + 1
        print(f"  {action} ids {lo:,}-{hi:,} ({100.0 * done / span:.1f}% of ids) · "
              f"this batch {counts[first] - before:,} rows in {took:.1f}s · {label()} · "
              f"elapsed {_elapsed(time.monotonic() - t_start)}", flush=True)
        lo = hi + 1
        if took > slow_s:
            size = max(size // 2, 1)
        elif took < fast_s and lo > hold_growth_until:
            size = min(size * 2, size_max)
    if cursor_file is not None:
        cursor_file.unlink(missing_ok=True)
    return {"first_alias_id": lo_id, "last_alias_id": hi_id, "resumed_from": resumed_from,
            "started_at_utc": started_at, "skipped_alias_ids": skipped,
            "batches": batches, "time_limits_hit": timeouts,
            "seconds": round(time.monotonic() - t_start, 1)}


def _visited_line(action: str, info: dict) -> str:
    line = (f"  {action} finished: every alias id from {info['first_alias_id']:,} to "
            f"{info['last_alias_id']:,} was visited")
    if info["resumed_from"] is not None and info["resumed_from"] > info["first_alias_id"]:
        line += (f" (ids below {info['resumed_from']:,} by the earlier run that began "
                 f"{info['started_at_utc']} UTC)")
    return line + f", {info['batches']:,} batches in {_elapsed(info['seconds'])}"


def _incomplete_text(action: str, info: dict, done: str) -> str:
    ids = info["skipped_alias_ids"]
    shown = ", ".join(str(i) for i in ids[:20]) + (" ..." if len(ids) > 20 else "")
    return (f"{action} is NOT finished: {len(ids):,} alias id(s) were skipped because the "
            f"database gave no answer in time ({shown}). {done} Run the same command again; "
            "it starts at the first alias and tries the skipped ones again. A larger "
            "--batch-timeout gives a slow alias more time.")


def apply(min_filers: int = MIN_FILERS_FLOOR, batch: int = BATCH_START,
          dry_run: bool = False, batch_timeout_s: float = BATCH_TIMEOUT_S) -> dict:
    """Link 990-PF grant rows of the strict class, one committed batch of
    aliases at a time. Restartable: only rows with no organisation are
    touched. `batch` is the size of the first batch; the sweep sizes the rest
    itself (_sweep). With dry_run the same probes run as a count and nothing
    is written."""
    _check_min_filers(min_filers)
    live = {"conn": connect()}
    try:
        lo_id, hi_id, rfid = _alias_bounds(live["conn"])
        if hi_id < lo_id:
            raise RuntimeError("No aliases are stored. Run `resolve aliases --build` first.")
        params = {"min_filers": min_filers}

        if dry_run:
            # No cursor file and no ledger row: a dry run writes nothing and
            # always counts from the first alias.
            counts = {"rows_would_link": 0, "aliases_with_rows": 0}
            amount: list[Decimal | None] = [None]

            def on_dry(result, _rowcount: int) -> None:
                rows, aliases, amt = result
                counts["rows_would_link"] += rows
                counts["aliases_with_rows"] += aliases
                if amt is not None:
                    amount[0] = (amount[0] or Decimal(0)) + amt

            info = _sweep(live, "apply (dry run)", _APPLY_DRY_BATCH, params, lo_id, hi_id,
                          counts, on_dry,
                          lambda: f"{counts['rows_would_link']:,} grant rows would be linked",
                          batch=batch, timeout_s=batch_timeout_s, bound=None, write=False)
            if info["skipped_alias_ids"]:
                raise SweepIncomplete(_incomplete_text(
                    "apply (dry run)", info, "The counts above leave those aliases out."))
            print(_visited_line("apply (dry run)", info), flush=True)
            print(f"  dry run, nothing written. Dollars on the rows that would be "
                  f"linked: {_money(amount[0], counts['rows_would_link'])}", flush=True)
            return counts

        _drop_other_cursor("apply")
        bound = _bound_to(live["conn"], "apply", min_filers, lo_id, hi_id)
        run_id = ledger.start_run(live["conn"], rfid, LEDGER_APPLY)
        counts = {"events_linked": 0}
        try:
            def on_apply(_result, rowcount: int) -> None:
                counts["events_linked"] += rowcount

            info = _sweep(live, "apply", _APPLY_BATCH, params, lo_id, hi_id, counts, on_apply,
                          lambda: f"{counts['events_linked']:,} grant rows linked so far",
                          batch=batch, timeout_s=batch_timeout_s, bound=bound, write=True)
            conn = live["conn"]
            with conn.cursor() as cur:
                cur.execute("select count(*) from internal.recipient_alias_links")
                counts["link_rows_in_table"] = cur.fetchone()[0]
            conn.rollback()
            if not info["skipped_alias_ids"]:
                ledger.complete_run(conn, run_id, inserted=counts["events_linked"],
                                    updated=counts["events_linked"],
                                    notes=json.dumps({"action": "apply",
                                                      "min_filers": min_filers, **counts,
                                                      "sweep": info, "bound_to": bound}))
        except Exception as exc:
            try:
                live["conn"].rollback()
                ledger.fail_run(live["conn"], run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
        if info["skipped_alias_ids"]:
            text = _incomplete_text(
                "apply", info, f"{counts['events_linked']:,} grant rows were linked and "
                               "stay linked.")
            ledger.fail_run(live["conn"], run_id, text)
            raise SweepIncomplete(text)
        print(_visited_line("apply", info), flush=True)
        print(f"  Grant rows that a load adds after {info['started_at_utc']} UTC may not be "
              "linked by this run. Run --apply again when the load has ended.", flush=True)
        return counts
    finally:
        try:
            live["conn"].close()
        except Exception:
            pass


def unapply(batch: int = BATCH_START, dry_run: bool = False,
            batch_timeout_s: float = BATCH_TIMEOUT_S) -> dict:
    """Remove every link this job made. A grant row goes back to "no
    organisation" only where its organisation is still the alias's; the link
    rows are deleted either way. The alias rows stay."""
    live = {"conn": connect()}
    try:
        lo_id, hi_id, rfid = _alias_bounds(live["conn"])
        counts = {"events_unlinked": 0, "link_rows_removed": 0}
        if hi_id < lo_id:
            return counts

        if dry_run:
            counts = {"link_rows": 0, "events_would_unlink": 0}

            def on_dry(result, _rowcount: int) -> None:
                links, ours = result
                counts["link_rows"] += links
                counts["events_would_unlink"] += ours

            info = _sweep(live, "unapply (dry run)", _UNAPPLY_DRY_BATCH, {}, lo_id, hi_id,
                          counts, on_dry,
                          lambda: f"{counts['events_would_unlink']:,} grant rows would be "
                                  "unlinked",
                          batch=batch, timeout_s=batch_timeout_s, bound=None, write=False)
            if info["skipped_alias_ids"]:
                raise SweepIncomplete(_incomplete_text(
                    "unapply (dry run)", info, "The counts above leave those aliases out."))
            print(_visited_line("unapply (dry run)", info), flush=True)
            counts["links_changed_since_kept_as_they_are"] = (
                counts["link_rows"] - counts["events_would_unlink"])
            return counts

        _drop_other_cursor("unapply")
        bound = _bound_to(live["conn"], "unapply", None, lo_id, hi_id)
        run_id = ledger.start_run(live["conn"], rfid, LEDGER_UNAPPLY)
        try:
            def on_unapply(result, _rowcount: int) -> None:
                nulled, gone = result
                counts["events_unlinked"] += nulled
                counts["link_rows_removed"] += gone

            info = _sweep(live, "unapply", _UNAPPLY_BATCH, {}, lo_id, hi_id, counts,
                          on_unapply,
                          lambda: f"{counts['events_unlinked']:,} grant rows unlinked so far",
                          batch=batch, timeout_s=batch_timeout_s, bound=bound, write=True)
            counts["links_changed_since_kept_as_they_are"] = (
                counts["link_rows_removed"] - counts["events_unlinked"])
            conn = live["conn"]
            with conn.cursor() as cur:
                cur.execute("select count(*) from internal.recipient_alias_links")
                counts["link_rows_in_table"] = cur.fetchone()[0]
            conn.rollback()
            if not info["skipped_alias_ids"]:
                ledger.complete_run(conn, run_id, updated=counts["events_unlinked"],
                                    notes=json.dumps({"action": "unapply", **counts,
                                                      "sweep": info, "bound_to": bound}))
        except Exception as exc:
            try:
                live["conn"].rollback()
                ledger.fail_run(live["conn"], run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
        if info["skipped_alias_ids"]:
            text = _incomplete_text(
                "unapply", info, f"{counts['events_unlinked']:,} grant rows were unlinked; "
                                 f"{counts['link_rows_in_table']:,} link rows are still in "
                                 "the table.")
            ledger.fail_run(live["conn"], run_id, text)
            raise SweepIncomplete(text)
        print(_visited_line("unapply", info), flush=True)
        return counts
    finally:
        try:
            live["conn"].close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# sample (for an independent audit before the apply)
# ---------------------------------------------------------------------------
def sample(n: int, out: Path, seed: int, min_filers: int = MIN_FILERS_FLOOR) -> dict:
    """Write a random sample of N would-be links of the strict class as CSV.

    Uniform over the rows the apply would link: an alias is drawn in
    proportion to the rows counted for it at build time, then one of its rows
    is taken by position. The same seed on the same database gives the same
    file. Read only.
    """
    _check_min_filers(min_filers)
    if n <= 0:
        raise ValueError("--sample needs a positive number of rows.")
    conn = connect()
    try:
        with conn.cursor() as cur:
            _require_schema(cur)
            cur.execute(_SAMPLE_POOL, {"min_filers": min_filers})
            pool = cur.fetchall()
        conn.rollback()
        total = sum(weight for _, weight in pool)
        counts = {"would_be_links_at_build": total, "rows_written": 0,
                  "aliases_sampled": 0, "positions_no_longer_there": 0}
        picked: list[tuple[str, int]] = []
        if total:
            rng = random.Random(seed)
            positions = sorted(rng.sample(range(total), min(n, total)))
            bounds, running = [], 0
            for _, weight in pool:
                running += weight
                bounds.append(running)
            by_alias: dict[int, list[int]] = {}
            for pos in positions:
                i = bisect.bisect_right(bounds, pos)
                by_alias.setdefault(i, []).append(pos - (bounds[i] - pool[i][1]))
            counts["aliases_sampled"] = len(by_alias)
            for i, offsets in by_alias.items():
                alias_id = pool[i][0]
                with conn.cursor() as cur:
                    _nested_loops_only(cur)
                    cur.execute(_SAMPLE_PROBE,
                                {"alias_id": alias_id, "min_filers": min_filers})
                    event_ids = [str(r[0]) for r in cur.fetchall()]
                conn.rollback()
                seen: set[str] = set()
                for off in offsets:
                    # Rows can come and go between the build and now; a
                    # position past the end is counted, not silently wrapped.
                    if off >= len(event_ids):
                        counts["positions_no_longer_there"] += 1
                        continue
                    if event_ids[off] not in seen:
                        seen.add(event_ids[off])
                        picked.append((event_ids[off], alias_id))

        rows: list[tuple] = []
        if picked:
            with conn.cursor() as cur:
                cur.execute(_SAMPLE_DETAIL, {"event_ids": [p[0] for p in picked],
                                             "alias_ids": [p[1] for p in picked]})
                rows = cur.fetchall()
            conn.rollback()
        out = Path(out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(SAMPLE_COLUMNS)
            for row in rows:
                # A missing value stays an empty cell; it is never written as 0.
                writer.writerow(["" if v is None else v for v in row])
        counts["rows_written"] = len(rows)
        return counts
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# report
# ---------------------------------------------------------------------------
def report(min_filers: int = MIN_FILERS_FLOOR) -> str:
    """Plain-text report from stored columns, the last build's ledger notes
    and the link table. Reads no grant rows, so it runs in seconds."""
    lines: list[str] = []
    out = lines.append
    conn = connect()
    try:
        with conn.cursor() as cur:
            _require_schema(cur)
            cur.execute("set local statement_timeout = '5min'")
            cur.execute("""select l.id, l.completed_at, l.notes
                           from internal.ingestion_ledger l
                           where l.dataset_name = %s and l.status = 'completed'
                           order by l.id desc limit 1""", (DATASET,))
            last = cur.fetchone()
            summary = _summary_rows(cur, "internal.recipient_aliases", min_filers)
            cur.execute("select count(*), min(linked_at), max(linked_at) "
                        "from internal.recipient_alias_links")
            n_links, first_link, last_link = cur.fetchone()
            cur.execute(_LINKED_SUPPORT.format(strict=_STRICT), {"min_filers": min_filers})
            (linked_aliases, linked_rows,
             unsupported_aliases, unsupported_rows) = cur.fetchone()
            cur.execute(f"""
                select ra.target_rows_city_ok, ra.n_filers, ra.recipient_name_normalized,
                       ra.recipient_state, o.name, o.city, o.state
                from internal.recipient_aliases ra
                join internal.organizations o on o.id = ra.org_id
                where {_STRICT}
                order by ra.target_rows_city_ok desc nulls last, ra.id
                limit 30""", {"min_filers": min_filers})
            top = cur.fetchall()
        conn.rollback()
    finally:
        try:
            conn.close()
        except Exception:
            pass

    notes: dict = {}
    if last is not None:
        try:
            notes = json.loads(last[2] or "{}")
        except ValueError:
            notes = {}

    out(f"resolve aliases report, printed {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC")
    if last is None:
        out("No completed build is on record. Run `resolve aliases --build` first.")
    else:
        out(f"Last build: ledger run {last[0]}, finished {_utc(last[1])} UTC, "
            f"rule file sha256 {str(notes.get('manifest_sha256', ''))[:12] or 'not recorded'}")
    out("Counts of 990-PF rows and dollars are as they were at that build.")
    out("")
    out("Stored aliases (name + state keys that 2 or more filers wrote with an EIN)")
    out(f"  {'status':<10} {'filers':<8} {'keys':>9} {'990-PF rows':>12} "
        f"{'city matches':>13} {'dollars (city matches)':>24}")
    merged: dict[tuple[str, bool], dict] = {}
    for r in summary:
        m = merged.setdefault((r["status"], r["enough_filers"]),
                              {"keys": 0, "target_rows": 0, "rows_city_ok": 0, "amount": None})
        m["keys"] += r["keys"]
        m["target_rows"] += r["target_rows"]
        m["rows_city_ok"] += r["rows_city_ok"]
        if r["amount_city_ok"] is not None:
            m["amount"] = (m["amount"] or Decimal(0)) + r["amount_city_ok"]
    for (status, enough), m in sorted(
            merged.items(), key=lambda kv: (_STATUS_ORDER.get(kv[0][0], 9), not kv[0][1])):
        filers = f"{min_filers}+" if enough else f"under {min_filers}"
        out(f"  {status:<10} {filers:<8} {m['keys']:>9,} {m['target_rows']:>12,} "
            f"{m['rows_city_ok']:>13,} {_money(m['amount'], m['rows_city_ok']):>24}")
    if not summary:
        out("  (none stored)")

    strict = _strict_totals(summary)
    set_aside = sum(r["keys"] for r in summary
                    if r["status"] == "unanimous" and r["enough_filers"] and r["in_matches"])
    out("")
    out(f"Strict class (unanimous, {min_filers} or more filers, key not in recipient_matches)")
    out(f"  keys: {strict['strict_keys']:,}"
        f" (with rows to link: {strict['strict_keys_with_rows']:,})")
    out(f"  rows the strict rule would link (counted at the build): "
        f"{strict['strict_rows_would_link']:,}")
    out(f"  dollars on those rows: "
        f"{_money(strict['strict_amount_would_link'], strict['strict_rows_would_link'])}")
    out(f"  rows held back because the city differs: "
        f"{strict['strict_rows_held_back_by_city']:,}")
    out(f"  keys set aside because recipient_matches now holds them: {set_aside:,}")
    out("")
    if n_links:
        out(f"Applied: {n_links:,} grant rows in internal.recipient_alias_links "
            f"(linked {_utc(first_link)} to {_utc(last_link)} UTC)")
        out(f"  aliases that grant rows are linked through: {linked_aliases:,} "
            f"({linked_rows:,} grant rows)")
        out(f"  of those, no longer supported: {unsupported_aliases:,} aliases "
            f"({unsupported_rows:,} grant rows)")
        out("    \"No longer supported\" = the stored alias is not in the strict class "
            "now (status is not")
        out(f"    unanimous, or under {min_filers} filers, or the key is in "
            "recipient_matches). --apply links nothing")
        out("    new through such an alias. The links it already made stay until "
            "--unapply.")
    else:
        out("Applied: 0 grant rows in internal.recipient_alias_links (nothing applied)")

    if notes:
        out("")
        out("From the last build (counted while the grant rows were read)")
        for label, key in (
            ("Schedule I witness rows read", "witness_rows"),
            ("witness keys (name + state)", "witness_keys"),
            ("single-witness keys (counted, not stored)", "single_witness_keys"),
            ("  of those, keys with unlinked 990-PF rows",
             "single_witness_keys_with_990pf_rows"),
            ("  unlinked 990-PF rows on those keys", "single_witness_990pf_rows"),
            ("keys with 2 or more filers", "keys_2plus_filers"),
            ("  dropped: key already in recipient_matches", "dropped_in_recipient_matches"),
            ("  dropped: filler text or under 6 characters", "dropped_filler_or_short"),
            ("  dropped: organisation type not allowed", "dropped_org_type"),
            ("unlinked 990-PF grant rows with a state", "target_rows_unlinked_990pf"),
            ("unlinked Schedule I grant rows with a state", "unlinked_schedule_i_rows"),
            ("aliases that already had links (organisation kept, status and counts "
             "refreshed)", "linked_aliases_refreshed"),
            ("  of those, no longer supported at this build",
             "linked_aliases_no_longer_supported"),
            ("    the filers now point at another organisation",
             "linked_aliases_other_org_now"),
            ("    the key is not derived any more", "linked_aliases_not_derived_now"),
        ):
            if isinstance(notes.get(key), int):
                out(f"  {label}: {notes[key]:,}")

        agreement = notes.get("tier_agreement") or {}
        out("")
        out("Existing name matcher (recipient_matches) against what filers wrote")
        out("  A key counts when at least one filer wrote it with an EIN we hold.")
        if not agreement:
            out("  (no recipient_matches rows)")
        for tier in sorted(agreement):
            a = agreement[tier]
            out(f"  {tier}: {a['keys']:,} keys, {a['keys_with_witness']:,} with a witness, "
                f"{a['keys_agree']:,} agree = {_pct(a['keys_agree'], a['keys_with_witness'])}")
            out(f"         like the strict class ({min_filers}+ filers, one EIN): "
                f"{a['strict_keys']:,} keys, {a['strict_agree']:,} agree = "
                f"{_pct(a['strict_agree'], a['strict_keys'])}")
            if a.get("label"):
                out(f"         [{a['label']}]")
        t3 = notes.get("tier3_would_add")
        if t3:
            out("  tier3 would add (only if `resolve recipients --max-tier 3` is run):")
            out(f"    990-PF rows: {t3['rows_990pf']:,} on {t3['keys_with_990pf_rows']:,} keys, "
                f"dollars {_money(t3['amount_990pf'], t3['rows_990pf'])}")
            out(f"    Schedule I rows: {t3['rows_schedule_i']:,}, "
                f"dollars {_money(t3['amount_schedule_i'], t3['rows_schedule_i'])}")

    out("")
    out("Top 30 strict aliases by rows to link (self-check: no filler text may appear)")
    for rows, filers, nn, st, org_name, org_city, org_state in top:
        where = ", ".join(x for x in (org_city, org_state) if x) or "city not on record"
        out(f"  {rows or 0:>7,} rows  {filers:>4} filers  {nn}, {st} -> {org_name} ({where})")
    if not top:
        out("  (none)")
    return "\n".join(lines)
