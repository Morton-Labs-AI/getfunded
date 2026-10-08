"""Recipient turnover: of the named grant recipients on a foundation's Form
990-PF for one fiscal year, how many were on none of its grant lists for the
three fiscal years before.

This is a COUNT FROM PAST RETURNS. It does not say a foundation will consider
a new request, and it is never turned into a score, a tier or a label. The
table it fills (``internal.funder_recipient_turnover``, migration 0029) has no
such column.

The rule, in the order it is applied (rule_version ``turnover-v2``; the same
text goes into the run manifest that every written row points at):

1. Rows: ``internal.funding_events`` with ``event_type = 'grant'`` and a
   ``source_record_key`` that starts ``irs990pf:``, in the target fiscal
   years and the three years before them. Rows of a superseded filing are
   dropped (there should be none; the count is printed).
2. A row is NAMED when ``internal.is_placeholder_recipient(internal.norm_name(
   recipient_name))`` is false. "SEE ATTACHED", "VARIOUS" and the like are
   counted apart and are never recipients. The function comes from migration
   0027; this job stops when it is missing.
3. A named row is to an INDIVIDUAL when the filer wrote so in the box for the
   recipient's foundation status (``recipient_foundation_status``: "I",
   "IND", "INDIVIDUAL", "STUDENT"; see INDIVIDUAL_STATUS_*) and our records
   do not link the row to an organisation. A scholarship fund lists a new
   class of students every year; counting them would say "none of its
   recipients is on the earlier lists" about a fund that takes no requests
   from organisations. Individual rows are left out of the year's list and
   of the earlier lists. The relationship box is not used: filers write
   "NONE" there for organisations and people alike. A filer that leaves the
   status box empty for a person is not caught; the page says so.
4. Names are compared after cleaning: ``norm_name``, then a leading "THE " and
   one trailing entity suffix (``recipients.STRIPPABLE_SUFFIXES``) are
   dropped. The SQUEEZED name is the cleaned name with everything that is
   not a letter or a digit removed, so "ST JUDE S CHILDREN S ..." and
   "ST JUDE S CHILDRENS ..." are one name, and so are "FEED MORE" and
   "FEEDMORE".
5. A recipient is one organisation when any row with that squeezed name is
   linked to one (``recipient_org_id``), otherwise one squeezed name.
6. A recipient of fiscal year FY is SEEN BEFORE when the same foundation's
   lists for FY-1, FY-2 and FY-3 hold (a) the same squeezed name, or (b) a
   row linked to the same organisation, or (c) a cleaned name that is at
   least 0.8 trigram-similar. The state on the row is NOT compared in any of
   the three: filers write one recipient under its head office in one year
   and under a local office in the next. Rule (c) keeps a respelling
   ("BOYS & GIRLS CLUB OF ..." / "BOYS AND GIRLS CLUB OF ...", 0.92) from
   looking new. It does not catch a recipient that adds a chapter name
   ("ALS ASSOCIATION" / "ALS ASSOCIATION <chapter>", about 0.5), and it can
   join two different recipients with near-identical names. False "new" is
   the harmful direction, so every tie goes to "seen before".
7. A row is written ONLY when the foundation has a named row that is not an
   individual row in FY and in each of FY-1, FY-2 and FY-3. Otherwise
   nothing is written: unknown stays unknown and is never stored as zero.
8. No row is written either when the lists are MOSTLY individuals: more than
   half of the named rows of FY, or of the four years together, are
   individual rows. The count of the few organisations on such a list would
   not describe the foundation. The run output counts what rules 7 and 8
   leave out because of individual rows.
9. A foundation whose lists would need more than SIMILAR_COMPARISON_CAP name
   comparisons in step 6(c) is set aside and gets no row. The run output
   counts them.

What changed from ``turnover-v1``: rules 3 and 8 are new; rule 6 compared the
cleaned name in (a) and required the same state in (c). A run with this
version replaces the v1 rows slice by slice.

How it runs: 256 slices of ``funder_org_id`` by its first byte (a range scan
on ``ix_events_funder``), one transaction per slice. Each slice copies its
grant rows into temp tables and works on those with hash joins, then deletes
that slice's old rows for the target years and inserts the new ones, so a
re-run after an ingest cannot leave stale rows behind.

Sizes to know: foundations per slice are even (about 380 to 510), rows are
not. The median slice holds about 30,000 grant rows; slice 117 (0x75) holds
about 1.45 million because one foundation filed lists of that size. That is
why every slice sets its own statement timeout and memory guards, and why
``--slice 117 --dry-run`` exists. Run that dry run before a full run: with
no state in rule 6(c) that one foundation is compared across all its states
at once, and it may go over SIMILAR_COMPARISON_CAP. It is then set aside
(no row), which is the safe result.

Run order: this job reads ``recipient_org_id`` and the grant rows as they are
now. Run it AFTER the backfill, the reconcile and ``resolve recipients`` have
finished, and after ``refresh-views``. ``--report`` prints a warning when the
history view or the stored rows are older than the newest loaded return.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterable

import psycopg
from psycopg import sql

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..resolve.recipients import _MEMORY_GUARDS, STRIPPABLE_SUFFIXES

RULE_VERSION = "turnover-v2"
DEFAULT_FYS: tuple[int, ...] = (2023, 2024, 2025)
N_SLICES = 256
WINDOW_YEARS = 3          # the table's check constraint fixes this at three
SIMILARITY_MIN = 0.8
SLICE_TIMEOUT = "30min"   # the session default is 2 minutes; slice 117 needs more
# The most name comparisons the similar-name step may make for ONE foundation
# (all its target years together). A generated foundation with 300,000
# recipients a year, 30,000 of them unmatched, needed 27 million and about
# 110 seconds on a laptop. A list built from the same few words over and over
# has no rare trigram and would need billions. A foundation above the cap
# gets no row (unknown stays unknown) and is counted in the run output, so
# one list cannot stall the run or take its whole slice down with it.
SIMILAR_COMPARISON_CAP = 60_000_000
DRY_RUN_SLICES: tuple[int, ...] = (0, 1)
CURSOR_MAX_AGE_HOURS = 12
LEDGER_NAME = "derive_turnover"

# When a grant row is to an individual (rule 3). Tested on the foundation
# status box, upper case and trimmed. Live values read 2026-10-08 on 8 of 256
# slices: "I" 7,352 rows of 255 foundations, "INDIVIDUAL" 441, "STUDENT" 71,
# "IND" 14, "I INDIVIDUAL PERSON" 14. "N/A" and "NONE" (4,583 rows) are NOT
# used: filers write them for organisations too. "INDEP" and "INDIGENT" do
# not match. The negation test keeps "NOT AN INDIVIDUAL" out.
# Check of the rule on those slices: of 7,900 rows it marks, 166 (2.1%) were
# linked to an organisation; those rows are not treated as individuals.
INDIVIDUAL_STATUS_EXACT = r"^(I|IND\.?|STUDENTS?)$"
INDIVIDUAL_STATUS_WORD = r"\mINDIV"
INDIVIDUAL_STATUS_NEGATION = r"\m(NO|NOT|NON)\M"

PLACEHOLDER_FN = "internal.is_placeholder_recipient(text)"
TABLE = "internal.funder_recipient_turnover"
HISTORY_VIEW = "internal.mv_org_posture_history"

RULE_TEXT: tuple[str, ...] = (
    "Rows: Form 990-PF grant rows (event_type 'grant', source_record_key 'irs990pf:...') "
    "of non-superseded filings, for the target fiscal year and the three fiscal years before it.",
    "A row is named when internal.is_placeholder_recipient(internal.norm_name(recipient_name)) "
    "is false. Placeholder rows are counted apart and are never recipients.",
    "A named row is an individual row when the filer wrote I, IND, INDIVIDUAL or STUDENT in "
    "the box for the recipient's foundation status (recipient_foundation_status) and the row "
    "is not linked to an organisation. Individual rows are left out of the target year's list "
    "and of the earlier lists. A person the filer did not mark this way is not caught.",
    "Names are compared after cleaning: norm_name, then a leading 'THE ' and one trailing "
    "entity suffix are dropped. The squeezed name is the cleaned name without anything that "
    "is not a letter or a digit.",
    "A recipient is one organisation when any row with that squeezed name is linked to one "
    "(recipient_org_id), otherwise one squeezed name.",
    "A recipient is seen before when the same foundation's lists for the three earlier fiscal "
    "years hold the same squeezed name, or a row linked to the same organisation, or a cleaned "
    "name at least 0.8 trigram-similar. The state on the row is not compared.",
    "A row is written only when the foundation has a named row that is not an individual row "
    "in the target year and in each of the three earlier years. Otherwise no row is written; "
    "unknown is never stored as zero.",
    "No row is written either when more than half of the named rows of the target year, or of "
    "the four years together, are individual rows.",
    "No row is written either for a foundation whose lists would need more than "
    f"{SIMILAR_COMPARISON_CAP:,} name comparisons in the similar-name step.",
    "The result is a count from past returns. It is not a score and says nothing about "
    "whether a new request will be considered.",
)

# Reference shares for the FY2023 report. Outside them means "look", not
# "fail": each rests on a small sample.
#   "range": samples taken 2026-10-08 with an EARLIER, looser rule (no name
#       cleaning, no organisation-or-name match, no similar-name guard).
#   "slice": one slice (0x3c, 293 foundations) read 2026-10-08 with rule
#       turnover-v1, before the back-year load finished: 231 'preselected
#       only', 61 'open'.
# turnover-v2 counts fewer recipients as new than v1 (squeezed names, no
# state in the similar-name rule) and leaves out lists of individuals, so
# "none new" should sit a little above these shares and "3 or more new" a
# little below. Replace the slice figures after the first full v2 run.
REPORT_REFERENCE: dict[str, dict[str, str]] = {
    "preselected_only": {"three_range": "36 to 45", "none_range": "30 to 38",
                         "three_slice": "37.2", "none_slice": "40.7"},
    "open": {"three_range": "52 to 66", "none_range": "10 to 22",
             "three_slice": "59.0", "none_slice": "14.8"},
}

Echo = Callable[[str], None]


def _suffix_regex() -> str:
    alts = "|".join(STRIPPABLE_SUFFIXES)
    return rf"\s+({alts})$"


def slice_bounds(n: int) -> tuple[str, str]:
    """The lowest and highest uuid whose first byte is ``n``."""
    if not 0 <= n < N_SLICES:
        raise ValueError(f"slice must be between 0 and {N_SLICES - 1} (got {n})")
    b = f"{n:02x}"
    return (f"{b}000000-0000-0000-0000-000000000000",
            f"{b}ffffff-ffff-ffff-ffff-ffffffffffff")


def _cursor_path() -> Path:
    return Path(get_settings().data_root) / "derive" / "turnover_cursor.txt"


# ---------------------------------------------------------------------------
# SQL. One statement per step, all on temp tables after the first. Every join
# is an equality join the planner can hash, including the similar-name step
# (see _CTOK): there is no per-row probe loop and no index to build.
# Statements that take parameters write a literal percent sign as %%.
# ---------------------------------------------------------------------------

# The one read of the big table. `enable_seqscan = off` is set around it so a
# stale row estimate can never turn a 1-in-256 range scan into a full scan of
# funding_events, 256 times.
#
# `indiv`: the filer marked the recipient as an individual and the row is not
# linked to an organisation (rule 3). `cn` is the cleaned name, `sq` the
# squeezed one (rule 4); `sq` falls back to `cn` for a name with no letter or
# digit. The recipient's state is not read: no rule compares it.
_ROWS = """
create temp table _tv_rows on commit drop as
select s.funder_org_id, s.fy, s.oid, s.rorg, s.amount,
       internal.is_placeholder_recipient(s.nn) as unnamed,
       (s.rorg is null
        and (s.fs ~ %(ind_exact)s
             or (s.fs ~ %(ind_word)s and s.fs !~ %(ind_neg)s))) as indiv,
       c.cn,
       coalesce(nullif(regexp_replace(c.cn, '[^[:alnum:]]+', '', 'g'), ''), c.cn) as sq
from (
  select fe.funder_org_id,
         fe.fiscal_year as fy,
         split_part(fe.source_record_key, ':', 2) as oid,
         fe.recipient_org_id as rorg,
         upper(btrim(coalesce(fe.recipient_foundation_status, ''))) as fs,
         fe.amount,
         internal.norm_name(fe.recipient_name) as nn
  from internal.funding_events fe
  where fe.funder_org_id >= %(lo)s::uuid
    and fe.funder_org_id <= %(hi)s::uuid
    and fe.event_type = 'grant'
    and fe.source_record_key like 'irs990pf:%%'
    and fe.fiscal_year between %(fy_lo)s and %(fy_hi)s
) s
cross join lateral (
  select btrim(regexp_replace(regexp_replace(s.nn, '^THE\\s+', ''), %(suffix_re)s, '')) as cn
) c
"""

# The filings behind the slice's rows: a few thousand primary-key lookups.
# Hash and merge joins are switched off around it so the planner cannot read
# all of internal.filings to answer it.
_OIDS = """
create temp table _tv_oids on commit drop as
select o.oid, f.tax_period,
       (f.object_id is not null) as found,
       (f.superseded_by_object_id is not null) as superseded
from (select distinct oid from _tv_rows) o
left join internal.filings f on f.object_id = o.oid
"""

_DROP_SUPERSEDED = """
delete from _tv_rows r using _tv_oids o
where o.oid = r.oid and o.superseded
"""

_FY = """
create temp table _tv_fy on commit drop as
select funder_org_id, fy,
       count(*)::int as n_rows,
       (count(*) filter (where unnamed))::int as n_unnamed,
       (count(*) filter (where not unnamed and indiv))::int as n_indiv,
       (count(*) filter (where not unnamed and not indiv))::int as n_named,
       sum(amount) filter (where not unnamed and not indiv) as amount_named
from _tv_rows
group by funder_org_id, fy
"""

# Every foundation-year with a named row (individual or not) in the target
# year and in each of the three years before it. Inner joins, so a missing
# year means no row at all. `left_out` says why a foundation-year gets no
# turnover row because of its individual rows (rules 7 and 8); NULL means it
# goes on. Kept as its own table so the run can count what was left out.
_TARGET_ALL = """
create temp table _tv_target_all on commit drop as
select t.funder_org_id, t.fy, t.n_rows, t.n_unnamed, t.amount_named,
       (p1.n_unnamed + p2.n_unnamed + p3.n_unnamed)::int as window_unnamed,
       (t.n_indiv + p1.n_indiv + p2.n_indiv + p3.n_indiv)::int as indiv_rows,
       case
         when t.n_indiv > t.n_named
           or (t.n_indiv + p1.n_indiv + p2.n_indiv + p3.n_indiv)
              > (t.n_named + p1.n_named + p2.n_named + p3.n_named)
           then 'mostly_individuals'
         when least(t.n_named, p1.n_named, p2.n_named, p3.n_named) < 1
           then 'year_of_individuals_only'
       end as left_out
from _tv_fy t
join _tv_fy p1 on p1.funder_org_id = t.funder_org_id and p1.fy = t.fy - 1
join _tv_fy p2 on p2.funder_org_id = t.funder_org_id and p2.fy = t.fy - 2
join _tv_fy p3 on p3.funder_org_id = t.funder_org_id and p3.fy = t.fy - 3
where t.fy = any(%(fys)s)
  and t.n_named + t.n_indiv >= 1 and p1.n_named + p1.n_indiv >= 1
  and p2.n_named + p2.n_indiv >= 1 and p3.n_named + p3.n_indiv >= 1
"""

# The write rule: what is left has a named, non-individual row in all four
# years, and its lists are not mostly individuals.
_TARGET = """
create temp table _tv_target on commit drop as
select funder_org_id, fy, n_rows, n_unnamed, amount_named, window_unnamed
from _tv_target_all
where left_out is null
"""

_INDIVIDUALS = """
select fy,
       (count(*) filter (where left_out = 'mostly_individuals'))::int,
       (count(*) filter (where left_out = 'year_of_individuals_only'))::int,
       (count(*) filter (where left_out is null and indiv_rows > 0))::int,
       coalesce(sum(indiv_rows) filter (where left_out is null), 0)::bigint
from _tv_target_all
group by fy
"""

_CUR = """
create temp table _tv_cur on commit drop as
select r.funder_org_id, r.fy, r.cn, r.sq, r.rorg, sum(r.amount) as amount
from _tv_rows r
join _tv_target t on t.funder_org_id = r.funder_org_id and t.fy = r.fy
where not r.unnamed and not r.indiv
group by r.funder_org_id, r.fy, r.cn, r.sq, r.rorg
"""

_PRIOR = """
create temp table _tv_prior on commit drop as
select r.funder_org_id, r.fy, r.cn, r.sq, r.rorg
from _tv_rows r
join (select distinct funder_org_id from _tv_target) t on t.funder_org_id = r.funder_org_id
where not r.unnamed and not r.indiv
group by r.funder_org_id, r.fy, r.cn, r.sq, r.rorg
"""

# One row per squeezed name in a target year, with the recipient it belongs
# to: the organisation when any row with that name is linked, else the name.
_NAME = """
create temp table _tv_name on commit drop as
select funder_org_id, fy, sq,
       coalesce('o:' || min(rorg::text), 'n:' || sq) as ukey,
       sum(amount) as amount
from _tv_cur
group by funder_org_id, fy, sq
"""

_SEEN_DDL = """
create temp table _tv_seen (
  funder_org_id uuid, fy smallint, sq text, how text
) on commit drop
"""

# (a) the same squeezed name on an earlier list. Two cleaned names that are
# equal have the same squeezed name, so this also covers "the same name".
_SEEN_NAME = """
insert into _tv_seen
select distinct c.funder_org_id, c.fy, c.sq, 'name'
from _tv_name c
join _tv_prior p on p.funder_org_id = c.funder_org_id and p.sq = c.sq
where p.fy between c.fy - 3 and c.fy - 1
"""

# (b) a row linked to the same organisation on an earlier list.
_SEEN_ORG = """
insert into _tv_seen
select distinct c.funder_org_id, c.fy, c.sq, 'org'
from _tv_cur c
join _tv_prior p on p.funder_org_id = c.funder_org_id and p.rorg = c.rorg
where c.rorg is not null
  and p.fy between c.fy - 3 and c.fy - 1
"""

_USEEN = """
create temp table _tv_useen on commit drop as
select distinct n.funder_org_id, n.fy, n.ukey
from _tv_name n
join _tv_seen s on s.funder_org_id = n.funder_org_id and s.fy = n.fy and s.sq = n.sq
"""

# Cleaned names of recipients that are not seen before by (a) or (b). Only
# these go to the similar-name step. `sq` leads back to the recipient.
_CAND = """
create temp table _tv_cand on commit drop as
select distinct c.funder_org_id, c.fy, c.cn, c.sq
from _tv_cur c
join _tv_name n on n.funder_org_id = c.funder_org_id and n.fy = c.fy and n.sq = c.sq
left join _tv_useen u
  on u.funder_org_id = n.funder_org_id and u.fy = n.fy and u.ukey = n.ukey
where u.ukey is null
"""

# The earlier names the candidates can be compared with: same foundation,
# one row per cleaned name with the fiscal years it appears in.
_PSIM = """
create temp table _tv_psim on commit drop as
select row_number() over ()::int as pid, x.funder_org_id, x.cn, x.fys,
       cardinality({trgm}.show_trgm(x.cn)) as ntg
from (
  select p.funder_org_id, p.cn, array_agg(distinct p.fy) as fys
  from _tv_prior p
  join (select distinct funder_org_id from _tv_cand) c
    on c.funder_org_id = p.funder_org_id
  group by p.funder_org_id, p.cn
) x
"""

# The candidate names, one row per (foundation, name), each with its set of
# trigrams (pg_trgm's own: similarity() is shared / union of these).
_CN = """
create temp table _tv_cn on commit drop as
select row_number() over ()::int as cid, c.funder_org_id, c.cn,
       {trgm}.show_trgm(c.cn) as tg
from (select distinct funder_org_id, cn from _tv_cand) c
"""

# How many earlier names of one foundation carry each trigram.
_DF = """
create temp table _tv_df on commit drop as
select t.funder_org_id, t.tok, count(*)::int as df
from (
  select funder_org_id, unnest({trgm}.show_trgm(cn)) as tok
  from _tv_psim
) t
group by t.funder_org_id, t.tok
"""

# (c) a similar name on an earlier list, WITHOUT comparing every candidate
# with every earlier name.
#
# The filter is exact, not a guess. similarity(a, b) >= 0.8 means the two
# trigram sets share at least 80% of their union, so b holds at least 80% of
# a's trigrams: at most floor(n/5) of a's n trigrams can be missing from b.
# Take ANY floor(n/5)+1 trigrams of a and at least one of them is in b. We
# take the RAREST ones (fewest earlier names of that foundation carry
# them), so each candidate meets only the few earlier names that share
# a rare trigram with it. A trigram no earlier name carries (df 0) is kept in
# the ranking and matches nothing, which is right: enough of those and no
# earlier name can reach 0.8. Every pair that survives is then checked with
# the real similarity().
#
# All joins are equality joins on (foundation, trigram), so the work stays
# inside one foundation. turnover-v1 also kept it inside one state; without
# the state a very large list meets more earlier names per trigram, and the
# cap below (_TOO_LARGE) is what bounds it: the count of comparisons is known
# before any name is compared.
_CTOK = """
create temp table _tv_ctok on commit drop as
select x.cid, x.funder_org_id, x.tok, x.df, x.n
from (
  select c.cid, c.funder_org_id, c.tok, c.n,
         coalesce(d.df, 0) as df,
         row_number() over (partition by c.cid order by coalesce(d.df, 0), c.tok) as rk
  from (
    select cid, funder_org_id, cardinality(tg) as n, unnest(tg) as tok
    from _tv_cn
  ) c
  left join _tv_df d
    on d.funder_org_id = c.funder_org_id and d.tok = c.tok
) x
where x.rk <= x.n / 5 + 1
  and x.df > 0
"""

# The comparisons each foundation would need: one per (candidate trigram,
# earlier name carrying it). A foundation above the cap is set aside whole.
_TOO_LARGE = """
create temp table _tv_skip on commit drop as
select funder_org_id, sum(df)::bigint as comparisons
from _tv_ctok
group by funder_org_id
having sum(df) > %(cap)s
"""

_DROP_TOO_LARGE = """
delete from _tv_ctok k using _tv_skip s where s.funder_org_id = k.funder_org_id
"""

_COMPARISONS = "select coalesce(sum(df), 0)::bigint from _tv_ctok"

# The size test comes first because it is nearly free and also exact: two
# sets that share 80% of their union cannot differ in size by more than a
# factor of 0.8. similarity() is the costly part (about 4 microseconds a
# pair), so it runs last, on what is left.
_SEEN_SIMILAR = """
insert into _tv_seen
select distinct cd.funder_org_id, cd.fy, cd.sq, 'similar'
from (
  select funder_org_id, cn, fys, ntg, unnest({trgm}.show_trgm(cn)) as tok
  from _tv_psim
) p
join _tv_ctok k
  on k.funder_org_id = p.funder_org_id and k.tok = p.tok
join _tv_cn c on c.cid = k.cid
join _tv_cand cd
  on cd.funder_org_id = c.funder_org_id and cd.cn = c.cn
where p.ntg * 5 >= k.n * 4
  and k.n * 5 >= p.ntg * 4
  and p.fys && array[cd.fy - 1, cd.fy - 2, cd.fy - 3]::smallint[]
  and {trgm}.similarity(p.cn, c.cn) >= {sim}
"""

_UNIT = """
create temp table _tv_unit on commit drop as
select n.funder_org_id, n.fy, n.ukey,
       sum(n.amount) as amount,
       coalesce(bool_or(s.exact), false) as seen_exact,
       coalesce(bool_or(s.similar), false) as seen_similar
from _tv_name n
left join (
  select funder_org_id, fy, sq,
         bool_or(how <> 'similar') as exact,
         bool_or(how = 'similar') as similar
  from _tv_seen
  group by funder_org_id, fy, sq
) s on s.funder_org_id = n.funder_org_id and s.fy = n.fy and s.sq = n.sq
group by n.funder_org_id, n.fy, n.ukey
"""

# The newest non-superseded filing that holds this foundation's rows for the
# fiscal year: the filing the page seals the count from.
_OBJ = """
create temp table _tv_obj on commit drop as
select distinct on (r.funder_org_id, r.fy) r.funder_org_id, r.fy, r.oid
from (select distinct funder_org_id, fy, oid from _tv_rows) r
join _tv_target t on t.funder_org_id = r.funder_org_id and t.fy = r.fy
join _tv_oids o on o.oid = r.oid
where o.found and not o.superseded
order by r.funder_org_id, r.fy, o.tax_period desc nulls last, r.oid desc
"""

# amount_new is a real zero when no recipient is new, and NULL (missing) when
# new recipients exist but none of their rows carries an amount.
_FINAL = """
create temp table _tv_final on commit drop as
select t.funder_org_id, t.fy,
       count(*)::int as n_recipients,
       (count(*) filter (where not u.seen_exact and not u.seen_similar))::int as n_new,
       (count(*) filter (where not u.seen_exact and u.seen_similar))::int as n_seen_similar,
       (t.fy - 3)::smallint as window_first_fy,
       (t.fy - 1)::smallint as window_last_fy,
       t.n_rows,
       t.n_unnamed as n_unnamed_rows,
       t.window_unnamed as window_unnamed_rows,
       t.amount_named as amount_total,
       case when count(*) filter (where not u.seen_exact and not u.seen_similar) = 0 then 0
            else sum(u.amount) filter (where not u.seen_exact and not u.seen_similar)
       end as amount_new,
       o.oid as object_id
from _tv_target t
join _tv_unit u on u.funder_org_id = t.funder_org_id and u.fy = t.fy
left join _tv_obj o on o.funder_org_id = t.funder_org_id and o.fy = t.fy
left join _tv_skip k on k.funder_org_id = t.funder_org_id
where k.funder_org_id is null
group by t.funder_org_id, t.fy, t.n_rows, t.n_unnamed, t.window_unnamed,
         t.amount_named, o.oid
"""

_SKIPPED = """
select count(*)::int
from _tv_target t
join _tv_skip k on k.funder_org_id = t.funder_org_id
"""

_SLICE_SUMMARY = """
select fy,
       count(*)::int,
       coalesce(sum(n_recipients), 0)::bigint,
       coalesce(sum(n_new), 0)::bigint,
       coalesce(sum(n_seen_similar), 0)::bigint,
       (count(*) filter (where n_new = 0))::int,
       (count(*) filter (where n_new >= 3))::int,
       (count(*) filter (where window_unnamed_rows > 0))::int,
       (count(*) filter (where object_id is null))::int
from _tv_final
group by fy
order by fy
"""

_DELETE = f"""
delete from {TABLE}
where funder_org_id >= %(lo)s::uuid
  and funder_org_id <= %(hi)s::uuid
  and fy = any(%(fys)s)
"""

_INSERT = f"""
insert into {TABLE}
  (funder_org_id, fy, n_recipients, n_new, n_seen_similar,
   window_first_fy, window_last_fy, n_rows, n_unnamed_rows, window_unnamed_rows,
   amount_total, amount_new, object_id,
   rule_version, raw_file_id, source_record_locator)
select funder_org_id, fy, n_recipients, n_new, n_seen_similar,
       window_first_fy, window_last_fy, n_rows, n_unnamed_rows, window_unnamed_rows,
       amount_total, amount_new, object_id,
       %(rule)s::text, %(rfid)s::bigint,
       'row:funder_org_id=' || funder_org_id::text || ';fy=' || fy::text
from _tv_final
"""

_SUMMARY_KEYS = ("funder_years", "recipients", "new", "seen_similar_only",
                 "none_new", "three_or_more_new", "window_has_unnamed", "no_filing_id")
# From _INDIVIDUALS: foundation-years with no row because of individual rows
# (two reasons), those that keep a row with individual rows left out, and
# how many individual rows those kept ones left out.
_INDIVIDUAL_KEYS = ("left_out_mostly_individuals", "left_out_year_of_individuals_only",
                    "kept_with_individual_rows", "individual_rows_left_out")
_ALL_KEYS = _SUMMARY_KEYS + _INDIVIDUAL_KEYS


# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
def _preflight(conn: psycopg.Connection, *, need_table: bool) -> dict:
    """Check everything the job needs BEFORE it writes anything.

    Returns the pg_trgm schema and the placeholder function's source text.
    Raises RuntimeError with a sentence the operator can act on.
    """
    with conn.cursor() as cur:
        cur.execute("select to_regprocedure(%s) is not null", (PLACEHOLDER_FN,))
        if not cur.fetchone()[0]:
            raise RuntimeError(
                f"{PLACEHOLDER_FN} does not exist in this database. It is the rule that "
                "tells a real recipient name from 'SEE ATTACHED', and migration "
                "0027_recipient_aliases.sql creates it. Run `uv run funderdb migrate` "
                "first. Nothing was written.")
        cur.execute(
            "select p.prosrc from pg_proc p "
            "where p.oid = to_regprocedure(%s)", (PLACEHOLDER_FN,))
        placeholder_src = cur.fetchone()[0]

        cur.execute(
            "select n.nspname from pg_extension e "
            "join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_trgm'")
        row = cur.fetchone()
        if row is None:
            raise RuntimeError(
                "The pg_trgm extension is not installed in this database. The similar-name "
                "rule needs it (migration 0001 creates it). Nothing was written.")
        trgm_schema = str(row[0])

        if need_table:
            cur.execute("select to_regclass(%s) is not null", (TABLE,))
            if not cur.fetchone()[0]:
                raise RuntimeError(
                    f"{TABLE} does not exist. Migration 0029_application_history.sql "
                    "creates it. Run `uv run funderdb migrate` first. Nothing was written.")
    conn.rollback()
    return {"trgm_schema": trgm_schema, "placeholder_src": placeholder_src}


# ---------------------------------------------------------------------------
# One slice
# ---------------------------------------------------------------------------
def _compute_slice(cur: psycopg.Cursor, n: int, fys: tuple[int, ...],
                   trgm_schema: str) -> dict:
    """Build the temp tables for one slice, ending with _tv_final.

    Reads the database; writes temp tables only. The caller decides whether
    to write _tv_final to the real table (run) or roll back (dry run).
    """
    lo, hi = slice_bounds(n)
    trgm = sql.Identifier(trgm_schema)

    # Per-transaction guards. `set local` ends with the transaction, so every
    # slice sets them again.
    cur.execute(f"set local statement_timeout = '{SLICE_TIMEOUT}'")
    for guard in _MEMORY_GUARDS:
        cur.execute(guard)

    cur.execute("set local enable_seqscan = off")
    cur.execute(_ROWS, {"lo": lo, "hi": hi, "suffix_re": _suffix_regex(),
                        "ind_exact": INDIVIDUAL_STATUS_EXACT,
                        "ind_word": INDIVIDUAL_STATUS_WORD,
                        "ind_neg": INDIVIDUAL_STATUS_NEGATION,
                        "fy_lo": min(fys) - WINDOW_YEARS, "fy_hi": max(fys)})
    rows_read = cur.rowcount
    cur.execute("set local enable_seqscan = on")
    cur.execute("analyze _tv_rows")

    cur.execute("set local enable_hashjoin = off")
    cur.execute("set local enable_mergejoin = off")
    cur.execute(_OIDS)
    cur.execute("set local enable_hashjoin = on")
    cur.execute("set local enable_mergejoin = on")
    cur.execute("analyze _tv_oids")
    cur.execute(_DROP_SUPERSEDED)
    rows_superseded = cur.rowcount

    cur.execute(_FY)
    cur.execute("analyze _tv_fy")
    cur.execute(_TARGET_ALL, {"fys": list(fys)})
    cur.execute(_INDIVIDUALS)
    individuals = {int(r[0]): dict(zip(_INDIVIDUAL_KEYS, (int(v) for v in r[1:])))
                   for r in cur.fetchall()}
    cur.execute(_TARGET)
    targets = cur.rowcount
    cur.execute("analyze _tv_target")
    for step in (_CUR, _PRIOR):
        cur.execute(step)
    cur.execute("analyze _tv_cur")
    cur.execute("analyze _tv_prior")
    cur.execute(_NAME)
    cur.execute("analyze _tv_name")

    cur.execute(_SEEN_DDL)
    cur.execute(_SEEN_NAME)
    cur.execute(_SEEN_ORG)
    cur.execute("analyze _tv_seen")
    cur.execute(_USEEN)
    cur.execute("analyze _tv_useen")
    cur.execute(_CAND)
    candidates = cur.rowcount
    cur.execute("analyze _tv_cand")

    t_sim = time.monotonic()
    cur.execute(sql.SQL(_PSIM).format(trgm=trgm))
    cur.execute("analyze _tv_psim")
    cur.execute(sql.SQL(_CN).format(trgm=trgm))
    cur.execute(sql.SQL(_DF).format(trgm=trgm))
    cur.execute("analyze _tv_cn")
    cur.execute("analyze _tv_df")
    cur.execute(_CTOK)
    cur.execute(_TOO_LARGE, {"cap": SIMILAR_COMPARISON_CAP})
    cur.execute(_DROP_TOO_LARGE)
    cur.execute("analyze _tv_ctok")
    cur.execute(_COMPARISONS)
    comparisons = int(cur.fetchone()[0])
    # A nested loop here would rescan the candidate trigrams once per earlier
    # name. The join is a plain equality join; keep it a hash or merge join.
    cur.execute("set local enable_nestloop = off")
    cur.execute(sql.SQL(_SEEN_SIMILAR).format(trgm=trgm, sim=sql.Literal(SIMILARITY_MIN)))
    cur.execute("set local enable_nestloop = on")
    similar_secs = time.monotonic() - t_sim
    cur.execute("analyze _tv_seen")

    for step in (_UNIT, _OBJ, _FINAL):
        cur.execute(step)
    cur.execute(_SKIPPED)
    set_aside = int(cur.fetchone()[0])

    cur.execute(_SLICE_SUMMARY)
    by_fy = {int(r[0]): dict(zip(_SUMMARY_KEYS, (int(v) for v in r[1:])))
             for r in cur.fetchall()}
    # A fiscal year can have every foundation left out, so it is in
    # `individuals` and not in the summary. Every entry gets every key.
    for fy in set(by_fy) | set(individuals):
        by_fy[fy] = {**dict.fromkeys(_ALL_KEYS, 0), **by_fy.get(fy, {}),
                     **individuals.get(fy, {})}
    return {"slice": n, "rows_read": rows_read, "rows_superseded": rows_superseded,
            "funder_years": targets - set_aside, "set_aside": set_aside,
            "similar_candidates": candidates, "comparisons": comparisons,
            "similar_secs": similar_secs, "by_fy": by_fy}


def _write_slice(cur: psycopg.Cursor, n: int, fys: tuple[int, ...], rfid: int) -> tuple[int, int]:
    """Delete this slice's rows for the target years, then insert the new ones."""
    lo, hi = slice_bounds(n)
    cur.execute(_DELETE, {"lo": lo, "hi": hi, "fys": list(fys)})
    deleted = cur.rowcount
    cur.execute(_INSERT, {"rule": RULE_VERSION, "rfid": rfid})
    return deleted, cur.rowcount


def _slice_line(stats: dict, secs: float, extra: str = "") -> str:
    return (f"  slice {stats['slice']:>3} [0x{stats['slice']:02x}]: "
            f"{stats['rows_read']:>9,} grant rows read · "
            f"{stats['funder_years']:>5,} foundation-years · "
            f"{stats['similar_candidates']:>6,} names to the similar-name step "
            f"({stats['comparisons']:,} comparisons, {stats['similar_secs']:.1f}s)"
            + (f" · {stats['set_aside']:,} foundation-years SET ASIDE, lists too large "
               "to compare" if stats["set_aside"] else "")
            + f" · {secs:6.1f}s{extra}")


def _fy_lines(by_fy: dict[int, dict]) -> list[str]:
    out = []
    for fy in sorted(by_fy):
        s = by_fy[fy]
        n = s["funder_years"]
        pct = (lambda k: f"{100.0 * s[k] / n:5.1f}%") if n else (lambda k: "    -")
        would_be_new = s["new"] + s["seen_similar_only"]
        sim = f"{100.0 * s['seen_similar_only'] / would_be_new:.1f}%" if would_be_new else "-"
        out.append(
            f"    FY{fy}: {n:,} foundations · {s['recipients']:,} named recipients · "
            f"{s['new']:,} not on the three earlier lists · "
            f"none new {pct('none_new')} · 3 or more new {pct('three_or_more_new')} · "
            f"similar-name rule kept {s['seen_similar_only']:,} from looking new ({sim}) · "
            f"{s['window_has_unnamed']:,} with placeholder rows in the window · "
            f"{s['no_filing_id']:,} without a filing id")
        left_out = s["left_out_mostly_individuals"] + s["left_out_year_of_individuals_only"]
        out.append(
            f"            individuals: {left_out:,} foundations get NO row "
            f"({s['left_out_mostly_individuals']:,} with lists that are mostly individuals, "
            f"{s['left_out_year_of_individuals_only']:,} with a year that lists only "
            f"individuals) · {s['kept_with_individual_rows']:,} keep a row with "
            f"{s['individual_rows_left_out']:,} individual rows left out")
    return out


def _add(total: dict[int, dict], by_fy: dict[int, dict]) -> None:
    for fy, s in by_fy.items():
        t = total.setdefault(fy, dict.fromkeys(_ALL_KEYS, 0))
        for k in _ALL_KEYS:
            t[k] += s[k]


def _connection_lost(conn: psycopg.Connection) -> bool:
    try:
        return bool(conn.closed or conn.broken)
    except Exception:
        return True


def _read_cursor(key: str, echo: Echo) -> int:
    """The slice to start from. 0 unless a fresh cursor of the SAME run shape exists."""
    path = _cursor_path()
    if not path.exists():
        return 0
    try:
        data = json.loads(path.read_text())
        age_h = (time.time() - path.stat().st_mtime) / 3600
        nxt = int(data["next"])
    except (OSError, ValueError, KeyError, TypeError):
        return 0
    if data.get("key") != key:
        echo(f"  ignoring cursor file {path}: it belongs to a run with other settings")
        return 0
    if age_h > CURSOR_MAX_AGE_HOURS:
        echo(f"  ignoring cursor file {path}: it is {age_h:.0f} hours old, "
             "so the earlier slices may be stale")
        return 0
    if not 0 < nxt < N_SLICES:
        return 0
    echo(f"  resuming at slice {nxt} (cursor file {path}, {age_h:.1f} hours old). "
         "Pass --restart to begin at slice 0.")
    return nxt


def _write_cursor(key: str, nxt: int) -> None:
    path = _cursor_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"key": key, "next": nxt}))


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
def run(fys: Iterable[int] = DEFAULT_FYS, slices: Iterable[int] | None = None,
        dry_run: bool = False, restart: bool = False, echo: Echo = print) -> dict:
    """Compute turnover rows for ``fys``.

    ``slices=None`` means all 256 (or the first two in a dry run). A dry run
    computes and prints and writes nothing: no table rows, no raw_files row,
    no ledger row, no cursor file.
    """
    fys = tuple(sorted({int(f) for f in fys}))
    if not fys:
        raise RuntimeError("Give at least one fiscal year (--fy).")
    if any(f < 1990 or f > 2100 for f in fys):
        raise RuntimeError(f"Fiscal years look wrong: {fys}")

    explicit = slices is not None
    if explicit:
        todo = sorted({int(s) for s in slices})
        for s in todo:
            slice_bounds(s)          # range check
    elif dry_run:
        todo = list(DRY_RUN_SLICES)
    else:
        todo = list(range(N_SLICES))
    full_run = not explicit and not dry_run

    settings = get_settings()
    totals: dict[int, dict] = {}
    counts: dict[str, int] = {"slices_done": 0, "rows_read": 0, "rows_superseded": 0,
                              "foundation_years_set_aside": 0,
                              "rows_deleted": 0, "rows_written": 0}

    # Not a `with` block, for the reason recipients.run() gives: a slice
    # reconnects when the loaded instance drops the connection, and a context
    # manager would try to commit or roll back the dead one on exit.
    conn = connect()
    try:
        pre = _preflight(conn, need_table=not dry_run)
        trgm_schema = pre["trgm_schema"]

        cursor_key = f"{RULE_VERSION}|{','.join(map(str, fys))}"
        if full_run:
            if restart:
                _cursor_path().unlink(missing_ok=True)
            start = _read_cursor(cursor_key, echo)
            todo = [s for s in todo if s >= start]

        rfid: int | None = None
        run_id: int | None = None
        if dry_run:
            echo(f"DRY RUN: slices {todo}, fiscal years {list(fys)}. Nothing is written.")
        else:
            # The run manifest first: every written row carries its raw_file_id,
            # so a derived row has the same provenance chain as a parsed one.
            manifest_dir = Path(settings.data_root) / "derive"
            manifest_dir.mkdir(parents=True, exist_ok=True)
            manifest = manifest_dir / f"turnover-{datetime.now():%Y%m%d-%H%M%S}.json"
            manifest.write_text(json.dumps({
                "job": LEDGER_NAME,
                "rule_version": RULE_VERSION,
                "rule": RULE_TEXT,
                "fiscal_years": fys,
                "window_years": WINDOW_YEARS,
                "similarity_min": SIMILARITY_MIN,
                "individual_status": {"column": "recipient_foundation_status",
                                      "exact": INDIVIDUAL_STATUS_EXACT,
                                      "word": INDIVIDUAL_STATUS_WORD,
                                      "unless": INDIVIDUAL_STATUS_NEGATION,
                                      "and": "recipient_org_id is null"},
                "squeezed_name": "cleaned name without anything that is not a letter or a digit",
                "state_compared": False,
                "similar_comparison_cap": SIMILAR_COMPARISON_CAP,
                "strippable_suffixes": STRIPPABLE_SUFFIXES,
                "placeholder_function": PLACEHOLDER_FN,
                "placeholder_function_source": pre["placeholder_src"],
                "slices": N_SLICES,
            }, indent=2))
            staged = staging.stage_local(LEDGER_NAME, manifest)
            rfid = staging.register_raw_file(conn, staged, license_code="cc_by",
                                             content_type="application/json")
            conn.commit()
            run_id = ledger.start_run(conn, rfid, LEDGER_NAME)
            echo(f"turnover {RULE_VERSION}: {len(todo)} slice(s), fiscal years {list(fys)}, "
                 f"manifest raw_file_id {rfid}")

        t_run = time.monotonic()
        failed: list[int] = []
        try:
            for s in todo:
                stats: dict | None = None
                deleted = written = 0
                t0 = time.monotonic()
                for attempt in range(6):
                    t0 = time.monotonic()
                    try:
                        with conn.cursor() as cur:
                            stats = _compute_slice(cur, s, fys, trgm_schema)
                            if not dry_run:
                                assert rfid is not None
                                deleted, written = _write_slice(cur, s, fys, rfid)
                        if dry_run:
                            conn.rollback()
                        else:
                            conn.commit()
                        break
                    except psycopg.errors.QueryCanceled as exc:
                        # The statement timeout (or an operator's cancel). The
                        # slice is rolled back whole: its old rows stay as
                        # they were. One slow slice must not cost the other
                        # 255, so the run goes on and names it at the end.
                        stats, deleted, written = None, 0, 0
                        conn.rollback()
                        why = (exc.diag.message_primary or "statement cancelled").strip()
                        echo(f"  slice {s:>3} [0x{s:02x}]: NOT FINISHED after "
                             f"{time.monotonic() - t0:.0f}s ({why}; the limit is "
                             f"{SLICE_TIMEOUT} per statement). Rolled back; nothing of "
                             "this slice was changed.")
                        failed.append(s)
                        break
                    except psycopg.OperationalError:
                        # Only a LOST connection is retried. Any other
                        # operational error (out of memory, disk full) is
                        # not something a retry fixes.
                        if not _connection_lost(conn) or attempt == 5:
                            raise
                        echo(f"  slice {s}: connection lost, reconnecting "
                             f"(attempt {attempt + 1}/5)")
                        try:
                            conn.close()
                        except Exception:
                            pass
                        time.sleep(15)
                        conn = connect()
                if stats is not None:
                    secs = time.monotonic() - t0
                    # Counted only now, after the commit, so a retried slice
                    # is never counted twice.
                    counts["rows_deleted"] += deleted
                    counts["rows_written"] += written
                    extra = ("" if dry_run
                             else f" · {deleted:,} old rows removed, {written:,} written")
                    echo(_slice_line(stats, secs, extra))
                    if dry_run:
                        for line in _fy_lines(stats["by_fy"]):
                            echo(line)
                    _add(totals, stats["by_fy"])
                    counts["slices_done"] += 1
                    counts["rows_read"] += stats["rows_read"]
                    counts["rows_superseded"] += stats["rows_superseded"]
                    counts["foundation_years_set_aside"] += stats["set_aside"]
                if full_run:
                    _write_cursor(cursor_key, s + 1)

            if full_run:
                _cursor_path().unlink(missing_ok=True)
            if run_id is not None:
                notes = json.dumps({"rule_version": RULE_VERSION, "fiscal_years": fys,
                                    "slices": todo if explicit else len(todo),
                                    "slices_not_finished": failed,
                                    **counts, "by_fy": totals})
                if failed:
                    ledger.fail_run(conn, run_id, notes)
                else:
                    ledger.complete_run(conn, run_id, inserted=counts["rows_written"],
                                        skipped=counts["rows_superseded"], notes=notes)
        except Exception as exc:
            if run_id is not None:
                try:
                    conn.rollback()
                    ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                except Exception:
                    pass
            raise

        echo("")
        echo(f"{'DRY RUN totals' if dry_run else 'totals'} for {counts['slices_done']} "
             f"slice(s) in {time.monotonic() - t_run:.0f}s:")
        for line in _fy_lines(totals):
            echo(line)
        if counts["rows_superseded"]:
            echo(f"  NOTE: {counts['rows_superseded']:,} grant rows belong to a superseded "
                 "filing and were left out. There should be none (benchmark B13).")
        if counts["foundation_years_set_aside"]:
            echo(f"  NOTE: {counts['foundation_years_set_aside']:,} foundation-years were set "
                 f"aside: the similar-name step would have needed more than "
                 f"{SIMILAR_COMPARISON_CAP:,} comparisons for that foundation. They have no "
                 "row, which reads as 'cannot tell'.")
        if dry_run:
            echo("  Nothing was written.")
        if failed:
            again = " ".join(f"--slice {n}" for n in failed)
            raise RuntimeError(
                f"{len(failed)} slice(s) did not finish: {failed}. Every other slice is "
                + ("computed" if dry_run else "written")
                + f". Run the missing one(s) again when the database is less busy: "
                f"`uv run funderdb derive turnover {again}"
                + (" --dry-run" if dry_run else " " + " ".join(f"--fy {f}" for f in fys))
                + "`.")
        return counts
    finally:
        try:
            conn.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
_REPORT_HISTORY = f"""
select count(*)::int,
       (count(*) filter (where n_returns = greatest(n_open, n_preselected, n_not_stated)))::int,
       (count(*) filter (where latest_posture = 'open'
                           and other_posture = 'preselected_only'))::int,
       (count(*) filter (where latest_posture = 'preselected_only'
                           and other_posture = 'open'))::int,
       (count(*) filter (where latest_posture = 'unknown' and other_posture is not null))::int,
       (count(*) filter (where n_not_stated = n_returns))::int,
       (count(*) filter (where n_returns = 1))::int,
       (count(*) filter (where restrictive_phrase is not null))::int
from {HISTORY_VIEW}
"""

_REPORT_TURNOVER = f"""
select t.fy,
       coalesce(h.latest_posture, 'no posture row') as posture,
       count(*)::int as foundations,
       round(100.0 * count(*) filter (where t.n_new = 0) / count(*), 1) as pct_none,
       round(100.0 * count(*) filter (where t.n_new >= 3) / count(*), 1) as pct_three,
       round((percentile_cont(0.5) within group
               (order by t.n_new::numeric / t.n_recipients))::numeric, 3) as median_share
from {TABLE} t
left join {HISTORY_VIEW} h on h.org_id = t.funder_org_id
group by 1, 2
order by 1, 2
"""

_REPORT_TOTALS = f"""
select fy, count(*)::int,
       sum(n_recipients)::bigint, sum(n_new)::bigint, sum(n_seen_similar)::bigint,
       (count(*) filter (where window_unnamed_rows > 0))::int,
       (count(*) filter (where object_id is null))::int,
       sum(n_unnamed_rows)::bigint,
       min(computed_at at time zone 'utc'), max(computed_at at time zone 'utc')
from {TABLE}
group by fy
order by fy
"""


# Is the history view in step with the tables? Postgres keeps no refresh time
# for a materialized view, so the test is on the contents: the view counts
# every parsed, non-superseded Form 990-PF with an organisation (0029's `pf`
# rows), so the sum of n_returns must equal the count of those rows now. The
# second statement reads internal.filings once (about half a minute on the
# live database); it runs under its own time limit and the report goes on
# without it when the limit is reached.
_REPORT_VIEW_RETURNS = f"""
select coalesce(sum(n_returns), 0)::bigint, count(*)::bigint from {HISTORY_VIEW}
"""

_REPORT_BASE_RETURNS = """
select count(*)::bigint, max(f.details_parsed_at) at time zone 'utc'
from internal.filings f
join internal.filing_financials ff on ff.object_id = f.object_id
where f.org_id is not null
  and f.return_type = '990PF'
  and f.superseded_by_object_id is null
"""
FRESHNESS_TIMEOUT = "3min"

_REPORT_RULES = f"""
select rule_version, count(*)::int from {TABLE} group by 1 order by 1
"""


def _view_freshness(conn: psycopg.Connection, cur: psycopg.Cursor) -> dict | None:
    """Returns in the view against returns in the tables now. None when the
    count could not be made inside FRESHNESS_TIMEOUT."""
    cur.execute(_REPORT_VIEW_RETURNS)
    in_view, view_rows = cur.fetchone()
    try:
        with conn.transaction():          # a savepoint: a timeout undoes only this
            cur.execute(f"set local statement_timeout = '{FRESHNESS_TIMEOUT}'")
            for guard in _MEMORY_GUARDS:
                cur.execute(guard)
            cur.execute(_REPORT_BASE_RETURNS)
            in_tables, newest = cur.fetchone()
    except psycopg.errors.QueryCanceled:
        return None
    finally:
        if not conn.broken:
            cur.execute("set local statement_timeout = '5min'")
    return {"in_view": int(in_view), "view_rows": int(view_rows),
            "in_tables": int(in_tables), "newest_parsed": newest}


def report(echo: Echo = print) -> None:
    """Counts with a timestamp. Reads two small relations, and counts the
    Form 990-PF returns once for the freshness check; changes nothing."""
    with connect() as conn, conn.cursor() as cur:
        cur.execute("set transaction read only")
        cur.execute("set local statement_timeout = '5min'")
        cur.execute("select to_regclass(%s) is not null, to_regclass(%s) is not null, "
                    "now() at time zone 'utc'", (HISTORY_VIEW, TABLE))
        has_view, has_table, now = cur.fetchone()
        if not (has_view and has_table):
            raise RuntimeError(
                f"{HISTORY_VIEW} or {TABLE} does not exist. Migration "
                "0029_application_history.sql creates both. Run `uv run funderdb migrate`.")

        echo(f"Application history and recipient turnover, measured {now:%Y-%m-%d %H:%M} UTC")
        echo("Counts move with every ingest. Compare shares, not exact numbers.")
        echo("")

        cur.execute(_REPORT_HISTORY)
        (n, same, open_pre, pre_open, silent_earlier, all_silent, one_return,
         phrase) = cur.fetchone()
        echo(f"A. {HISTORY_VIEW}: {n:,} foundations with a parsed Form 990-PF")
        fresh = _view_freshness(conn, cur)
        newest_parsed = fresh["newest_parsed"] if fresh else None
        if fresh is None:
            echo(f"   NOTE: could not check in {FRESHNESS_TIMEOUT} whether this view is up to "
                 "date (the database is busy). Run `uv run funderdb refresh-views` if returns "
                 "were loaded after the last refresh.")
        elif fresh["in_view"] != fresh["in_tables"]:
            diff = fresh["in_tables"] - fresh["in_view"]
            echo(f"   WARNING: this view is OUT OF DATE. It holds {fresh['in_view']:,} returns; "
                 f"the tables hold {fresh['in_tables']:,} now "
                 f"({abs(diff):,} {'more' if diff > 0 else 'fewer'}"
                 + (f"; the newest return was read {newest_parsed:%Y-%m-%d %H:%M} UTC"
                    if newest_parsed else "")
                 + ").")
            echo("            Run `uv run funderdb refresh-views`, then read this report again. "
                 "The lines of A and C below describe the old contents, and the page shows "
                 "them.")
        else:
            echo(f"   The view is in step with the tables: {fresh['in_view']:,} parsed, "
                 "non-superseded Form 990-PF returns in both.")
        if n:
            def pct(v: int) -> str:
                return f"{100.0 * v / n:.1f}%"
            echo(f"   one answer on every return (silent counts as an answer): "
                 f"{same:,} ({pct(same)}; about 92% expected)")
            echo(f"   'open' now, 'preselected only' on another return: "
                 f"{open_pre:,} ({pct(open_pre)}; about 1.0% expected)")
            echo(f"   'preselected only' now, 'open' on another return: "
                 f"{pre_open:,} ({pct(pre_open)}; about 1.6% expected)")
            echo(f"   not stated now, a stated answer on another return: "
                 f"{silent_earlier:,} ({pct(silent_earlier)}; about 1.5% expected)")
            echo(f"   not stated on any return: {all_silent:,} ({pct(all_silent)})")
            echo(f"   only one return: {one_return:,} ({pct(one_return)})")
            echo(f"   'open' now with a restrictive phrase in the Part XV text: {phrase:,} "
                 "(kept for analysis; the page does not show it, because the matched words "
                 "often do not mean a limit)")
        echo("")

        cur.execute(_REPORT_TOTALS)
        totals = cur.fetchall()
        echo(f"B. {TABLE} (rule {RULE_VERSION})")
        if not totals:
            echo("   no rows yet. Run `uv run funderdb derive turnover`.")
            return
        cur.execute(_REPORT_RULES)
        other_rules = [(rv, k) for rv, k in cur.fetchall() if rv != RULE_VERSION]
        if other_rules:
            echo("   WARNING: " + ", ".join(f"{k:,} rows were written by rule {rv}"
                                            for rv, k in other_rules)
                 + f". The rule is {RULE_VERSION} now. Run `uv run funderdb derive turnover` "
                   "again; it replaces them.")
        oldest_row = min(row[8] for row in totals)
        if newest_parsed and oldest_row and newest_parsed > oldest_row:
            read_at = f"{newest_parsed:%Y-%m-%d %H:%M}"
            computed_at = f"{oldest_row:%Y-%m-%d %H:%M}"
            echo(f"   WARNING: the newest Form 990-PF return was read {read_at} UTC, after "
                 f"the oldest row here was computed ({computed_at} UTC). Rows can be out of "
                 "date. Run `uv run funderdb derive turnover` again, after the backfill and "
                 "`uv run funderdb resolve recipients` are done.")
        for (fy, nf, rec, new, sim, win, noid, unnamed, c0, c1) in totals:
            would_be_new = int(new) + int(sim)
            sim_pct = f"{100.0 * int(sim) / would_be_new:.1f}%" if would_be_new else "-"
            echo(f"   FY{fy}: {nf:,} foundations · {int(rec):,} named recipients · "
                 f"{int(new):,} not on the three earlier lists")
            echo(f"           similar-name rule kept {int(sim):,} from looking new "
                 f"({sim_pct} of those that would have) · "
                 f"{int(unnamed):,} placeholder rows left out")
            echo(f"           {win:,} foundations have placeholder rows in the window "
                 f"(the page hides their count) · {noid:,} without a filing id · "
                 f"computed {c0:%Y-%m-%d %H:%M} to {c1:%Y-%m-%d %H:%M} UTC")
        echo("")

        cur.execute(_REPORT_TURNOVER)
        echo("C. By fiscal year and latest stated application answer")
        echo(f"   {'FY':<6} {'latest answer':<18} {'foundations':>11} "
             f"{'none new':>9} {'3+ new':>8} {'median share new':>17}")
        for fy, posture, nf, p0, p3, med in cur.fetchall():
            echo(f"   {fy:<6} {posture:<18} {nf:>11,} {float(p0):>8.1f}% {float(p3):>7.1f}% "
                 f"{float(med):>17.3f}")
        echo("")
        echo("   Reference for FY2023 (small samples; a share outside them means look, "
             "not fail):")
        for posture, ref in REPORT_REFERENCE.items():
            echo(f"   {posture:<18} one slice with rule turnover-v1, 2026-10-08: 3 or more new "
                 f"{ref['three_slice']}% · none new {ref['none_slice']}%")
            echo(f"   {'':<18} earlier, looser rule: 3 or more new {ref['three_range']}% · "
                 f"none new {ref['none_range']}%")
        echo(f"   {RULE_VERSION} counts fewer recipients as new than both (squeezed names, no "
             "state in the similar-name rule) and writes no row for lists of individuals.")
        conn.rollback()
