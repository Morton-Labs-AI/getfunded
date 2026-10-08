"""Resolve as-reported grant recipients to EXISTING organizations.

Deterministic tiers, deliberately NOT Splink: this is an open-world problem —
most of the 1.07M distinct recipient names have no true candidate in the
database, and the as-reported side carries no second feature (990-PF grant rows
have no recipient EIN), so probabilistic EM has nothing to learn from. Tiers
are transparent, auditable, and tunable.

Never creates stub orgs. Unmatched recipients keep their as-reported text and a
NULL recipient_org_id forever — the UI renders those with a dotted underline
and says so.
"""

from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path

import psycopg

from .. import ledger, staging
from ..config import get_settings
from ..db import connect

# Funds and advisers are excluded: a grant to "SEQUOIA FUND" is a mutual-fund
# red herring, not a gift to a venture firm.
CANDIDATE_TYPES = ("company", "private_foundation", "public_charity", "gov_agency", "other")

# Only entity-form suffixes may be stripped. FOUNDATION / TRUST / FUND / INSTITUTE
# are load-bearing parts of a name, never noise.
STRIPPABLE_SUFFIXES = ("INC", "INCORPORATED", "LLC", "L L C", "CORP", "CORPORATION",
                       "CO", "LTD", "LP", "LLP", "PC", "PA")

# Memory guards for every statement in the run: the single-statement _recips
# build OOM'd and CRASHED the 2GB Small instance once the unlinked-grant set
# hit 9.1M rows (2026-07-30, post-back-years; postgres logs show WAL redo
# recovery). Parallel hash aggregation multiplies work_mem per worker —
# disable it and keep the hash modest so big aggregates spill to disk
# instead of taking the server down.
_MEMORY_GUARDS: tuple[str, ...] = (
    "set local max_parallel_workers_per_gather = 0",
    "set local work_mem = '32MB'",
    "set local hash_mem_multiplier = 1.0",
)

# _recips is built in fiscal-year slices (~1-2M rows each) of PARTIAL
# aggregates, then merged — no statement ever aggregates the full 9M+ rows
# of raw grant events at once.
_RECIPS_SLICES: tuple[str, ...] = (
    "fiscal_year is null",
    "fiscal_year < 2021",
    "fiscal_year = 2021",
    "fiscal_year = 2022",
    "fiscal_year = 2023",
    "fiscal_year = 2024",
    "fiscal_year >= 2025",
)

_RECIPS_RAW_DDL = """create temp table _recips_raw (
  nn text, st text, n_events bigint, total_amount numeric
) on commit drop"""

_RECIPS_SLICE = """
insert into _recips_raw
select internal.norm_name(recipient_name),
       nullif(btrim(recipient_state), ''),
       count(*), sum(amount)
from internal.funding_events
where event_type = 'grant' and recipient_org_id is null
  and recipient_name is not null and {pred}
group by 1, 2"""

_RECIPS_MERGE = """create temp table _recips on commit drop as
   select nn, st, sum(n_events) as n_events, sum(total_amount) as total_amount
   from _recips_raw group by 1, 2"""

# psycopg3 prepares parameterized statements, so each must execute separately.
_SETUP_STEPS: tuple[str, ...] = (
    "create index on _recips (nn)",
    # Candidate orgs, with per-name and per-(name,state) multiplicity so each
    # tier can require uniqueness rather than silently picking a winner.
    """create temp table _cands on commit drop as
       select o.id, o.name_normalized as nn, o.state as st
       from internal.organizations o
       where o.org_type = any(%(types)s) and o.canonical_org_id is null""",
    "create index on _cands (nn)",
    "create index on _cands (nn, st)",
    """create temp table _name_counts on commit drop as
       select nn, count(*) as n_national from _cands group by 1""",
    "create index on _name_counts (nn)",
    """create temp table _name_state_counts on commit drop as
       select nn, st, count(*) as n_state from _cands group by 1, 2""",
    "create index on _name_state_counts (nn, st)",
    """create temp table _matches (
         nn text, st text, org_id uuid, method text, confidence real
       ) on commit drop""",
    "analyze _recips",
    "analyze _cands",
)

# T1: exact name + same state, exactly one such org in that state.
_TIER1 = """
insert into _matches
select r.nn, r.st, c.id, 'tier1', 0.98
from _recips r
join _cands c on c.nn = r.nn and c.st = r.st
join _name_state_counts nsc on nsc.nn = r.nn and nsc.st = r.st
where r.st is not null and nsc.n_state = 1
"""

# T2: exact name, exactly one org nationally, and no state contradiction.
_TIER2 = """
insert into _matches
select r.nn, r.st, c.id, 'tier2', 0.93
from _recips r
join _name_counts nc on nc.nn = r.nn and nc.n_national = 1
join _cands c on c.nn = r.nn
where not exists (select 1 from _matches m where m.nn = r.nn and m.st is not distinct from r.st)
  and (r.st is null or c.st is null or c.st = r.st)
"""

# T3: entity-suffix-stripped exact + same state + unique.
_TIER3 = """
with stripped_recips as (
  select r.nn, r.st,
         btrim(regexp_replace(r.nn, %(suffix_re)s, '')) as base
  from _recips r
  where not exists (select 1 from _matches m where m.nn = r.nn and m.st is not distinct from r.st)
), stripped_cands as (
  select c.id, c.st, btrim(regexp_replace(c.nn, %(suffix_re)s, '')) as base
  from _cands c
), counts as (
  select base, st, count(*) as n from stripped_cands group by 1, 2
)
insert into _matches
select sr.nn, sr.st, sc.id, 'tier3', 0.90
from stripped_recips sr
join stripped_cands sc on sc.base = sr.base and sc.st = sr.st
join counts ct on ct.base = sr.base and ct.st = sr.st
where sr.st is not null and length(sr.base) >= 6 and ct.n = 1
"""

_PERSIST = """
insert into internal.recipient_matches
  (recipient_name_normalized, recipient_state, org_id, method, confidence,
   raw_file_id, source_record_locator)
select m.nn, m.st, m.org_id, m.method, m.confidence, %(rfid)s,
       'recipient:' || m.nn || coalesce(':' || m.st, '')
from _matches m
on conflict (recipient_name_normalized, recipient_state) do update set
  org_id = excluded.org_id,
  method = excluded.method,
  confidence = excluded.confidence,
  raw_file_id = excluded.raw_file_id
where internal.recipient_matches.status = 'auto'
"""

# Apply in batches over recipient_matches (a few hundred thousand rows at most),
# NOT in one statement over the events table: the single-statement version was
# killed by the server mid-flight (2026-07-27).
#
# The join is written as a LATERAL probe per match row, ON PURPOSE. The flat
# `update ... from rm where norm_name(fe.recipient_name) = rm...` form leaves
# the join direction to the planner, and at 9M unlinked rows the expression's
# n_distinct estimate collapses (placeholder names dominate the sample; a
# probe was estimated at ~50k rows), so the planner "correctly" rejected the
# ix_events_recipient_norm path and chose plans that sorted or scanned the
# whole table per batch — one of which OOM-crashed the instance three times
# (2026-07-30). The lateral form has no join to invert: one index probe per
# match, whatever the statistics think. The OFFSET 0 is the flattening
# fence: without it the planner decorrelates the lateral back into the
# invertible join (observed).
#
# The confidence test. `confidence` is type `real`, so tier3's 0.90 is stored
# as 0.8999999762. The old test `rm.confidence >= 0.90` compared it with the
# exact 0.90 and was FALSE for every tier3 match: tier3 was computed and
# stored but never applied (measured 2026-10-08: 0 of 93,780 passed). The
# test now compares `real` with `real`:
#   * `rm.confidence > 0.90::real` passes exactly the rows the old test
#     passed (tier1 0.98 and tier2 0.93), so a run that does not ask for
#     tier3 links what it always linked;
#   * `rm.confidence = 0.90::real` is tier3, and it is applied only when the
#     caller asks (`resolve recipients --max-tier 3`). It is a choice, not a
#     default, because it links about 0.9 million rows at once.
_APPLY_BATCH = """
update internal.funding_events fe
set recipient_org_id = t.org_id
from (
  select hit.id as event_id, rm.org_id
  from internal.recipient_matches rm
  cross join lateral (
    select fe2.id
    from internal.funding_events fe2
    where internal.norm_name(fe2.recipient_name) = rm.recipient_name_normalized
      and fe2.event_type = 'grant'
      and fe2.recipient_org_id is null
      and nullif(btrim(fe2.recipient_state), '') is not distinct from rm.recipient_state
    offset 0
  ) hit
  where rm.id between %(lo)s and %(hi)s
    and (rm.confidence > 0.90::real
         or (%(tier3)s and rm.confidence = 0.90::real))
    and rm.status in ('auto', 'accepted')
) t
where fe.id = t.event_id
"""

_UNAPPLY_BATCH = """
update internal.funding_events fe
set recipient_org_id = null
from (
  select hit.id as event_id
  from internal.recipient_matches rm
  cross join lateral (
    select fe2.id
    from internal.funding_events fe2
    where internal.norm_name(fe2.recipient_name) = rm.recipient_name_normalized
      and fe2.event_type = 'grant'
      and fe2.recipient_org_id = rm.org_id
    offset 0
  ) hit
  where rm.id between %(lo)s and %(hi)s
    and rm.status = 'rejected'
) t
where fe.id = t.event_id
"""


def _suffix_regex() -> str:
    alts = "|".join(STRIPPABLE_SUFFIXES)
    return rf"\s+({alts})$"


def _cursor_path() -> Path:
    return Path(get_settings().data_root) / "resolve" / "apply_cursor.txt"


def _resume_point(text: str, apply_tier3: bool, lo_id: int, hi_id: int) -> int | None:
    """The match id a restarted apply may pick up at, or None to start at the
    first match.

    The cursor file records the tier choice of the run that wrote it. A file
    from a run with the OTHER choice is never resumed: a default run skips
    tier3 matches, so resuming its cursor with tier3 switched on would leave
    the tier3 matches below the cursor unapplied while the ledger says tier3
    was applied. A file with no record of the choice (the older format, one
    bare number) is treated the same way. Starting at the first match is
    always correct; it only costs time.
    """
    try:
        saved = json.loads(text)
        nxt = int(saved["next"])
        saved_tier3 = saved["apply_tier3"]
        if not isinstance(saved_tier3, bool):
            raise TypeError("apply_tier3")
    except (ValueError, KeyError, TypeError):
        print("  apply cursor file has no record of the tier choice (an older version "
              "wrote it); it is ignored and the apply starts at the first match", flush=True)
        return None
    if saved_tier3 != apply_tier3:
        was = "applied tier3 matches" if saved_tier3 else "did not apply tier3 matches"
        now = "applies them" if apply_tier3 else "does not"
        print(f"  apply cursor file is from a run that {was}; this run {now}. It is not "
              "resumed: the apply starts at the first match", flush=True)
        return None
    if not lo_id <= nxt <= hi_id:
        print("  apply cursor file points outside the match ids; it is ignored and the "
              "apply starts at the first match", flush=True)
        return None
    return nxt


def apply_matches(conn, batch: int = 20_000, apply_tier3: bool = False) -> dict:
    """Link events to matched orgs, one committed batch of matches at a time.

    Tier1 and tier2 matches are always applied. Tier3 matches are applied
    only when `apply_tier3` is true (see the note above _APPLY_BATCH).

    Restartable by construction: only rows with recipient_org_id IS NULL are
    touched. A local cursor file additionally remembers the last completed
    batch so a reconnect resumes mid-sweep instead of re-scanning from id 1
    (the sweep itself is idempotent; the cursor only saves time). The file
    also records the tier choice, and a file written with the other choice is
    not resumed (_resume_point). The file is removed on completion so the
    next full run starts clean.
    """
    counts = {"events_linked": 0, "events_unlinked": 0}
    with conn.cursor() as cur:
        cur.execute("select coalesce(min(id), 0), coalesce(max(id), -1) "
                    "from internal.recipient_matches")
        lo_id, hi_id = cur.fetchone()

    cursor_file = _cursor_path()
    if cursor_file.exists():
        resumed = _resume_point(cursor_file.read_text(), apply_tier3, lo_id, hi_id)
        if resumed is not None:
            print(f"  resuming apply from match id {resumed:,} "
                  f"(cursor file)", flush=True)
            lo_id = resumed

    lo = lo_id
    while lo <= hi_id:
        hi = lo + batch - 1
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '15min'")
            # At 9M unlinked rows the planner flips this batch UPDATE to a
            # merge join that seq-scans and SORTS the entire events table —
            # per batch (observed 2026-07-30; the sort OOM-crashed the
            # instance on every attempt). Forbid the set-based joins so it
            # stays on nested-loop lookups against ix_events_recipient_norm,
            # which is the plan this batching was designed around.
            cur.execute("set local enable_mergejoin = off")
            cur.execute("set local enable_hashjoin = off")
            cur.execute(_APPLY_BATCH, {"lo": lo, "hi": hi, "tier3": apply_tier3})
            counts["events_linked"] += cur.rowcount
            cur.execute(_UNAPPLY_BATCH, {"lo": lo, "hi": hi})
            counts["events_unlinked"] += cur.rowcount
        conn.commit()
        cursor_file.parent.mkdir(parents=True, exist_ok=True)
        cursor_file.write_text(json.dumps({"next": hi + 1, "apply_tier3": apply_tier3}))
        print(f"  applied matches {lo:,}-{min(hi, hi_id):,} · "
              f"{counts['events_linked']:,} events linked", flush=True)
        lo = hi + 1
    cursor_file.unlink(missing_ok=True)
    return counts


def run(apply: bool = True, max_tier: int = 3, apply_tier3: bool = False) -> dict:
    """Compute matches for tiers 1..max_tier, store them, and apply them.

    The defaults are what this job has always done in practice: tiers 1 to 3
    are computed and stored, tiers 1 and 2 are applied. `apply_tier3=True`
    (the CLI passes it for an explicit `--max-tier 3`) also applies tier3.
    """
    counts: dict[str, int] = {}
    settings = get_settings()

    # Not a `with` block: the apply phase reconnects on connection loss (the
    # loaded instance stalls long enough for TCP to give up — observed
    # 2026-07-30 during a 269s checkpoint), and a context manager would try
    # to commit/rollback the DEAD original connection on exit.
    conn = connect()
    try:
        # Run artifact first: recipient_matches.raw_file_id is NOT NULL, so the
        # provenance chain covers derived matches too (B10 stays at zero orphans).
        manifest_dir = Path(settings.data_root) / "resolve"
        manifest_dir.mkdir(parents=True, exist_ok=True)
        manifest = manifest_dir / f"recipients-{datetime.now():%Y%m%d-%H%M%S}.json"
        manifest_body: dict = {
            "job": "recipients",
            "method": "deterministic tiers 1-%d" % max_tier,
            "candidate_types": CANDIDATE_TYPES,
            "strippable_suffixes": STRIPPABLE_SUFFIXES,
        }
        if apply_tier3:
            # Only written when asked for, so the artifact of a default run
            # keeps the bytes (and the sha256) it has always had.
            manifest_body["apply_tier3"] = True
        manifest.write_text(json.dumps(manifest_body, indent=2))
        staged = staging.stage_local("resolve_recipients", manifest)
        rfid = staging.register_raw_file(conn, staged, license_code="cc_by",
                                         content_type="application/json")
        conn.commit()
        run_id = ledger.start_run(conn, rfid, "resolve_recipients")

        try:
            with conn.cursor() as cur:
                cur.execute("set local statement_timeout = '60min'")
                for guard in _MEMORY_GUARDS:
                    cur.execute(guard)
                cur.execute(_RECIPS_RAW_DDL)
                for pred in _RECIPS_SLICES:
                    cur.execute(_RECIPS_SLICE.format(pred=pred))
                    print(f"  _recips slice [{pred}]: {cur.rowcount:,} partials",
                          flush=True)
                cur.execute(_RECIPS_MERGE)
                for step in _SETUP_STEPS:
                    cur.execute(step, {"types": list(CANDIDATE_TYPES)}
                                if "%(types)s" in step else None)
                cur.execute("select count(*) from _recips")
                counts["distinct_recipients"] = cur.fetchone()[0]
                cur.execute("select count(*) from _cands")
                counts["candidate_orgs"] = cur.fetchone()[0]

                cur.execute(_TIER1)
                counts["tier1"] = cur.rowcount
                if max_tier >= 2:
                    cur.execute(_TIER2)
                    counts["tier2"] = cur.rowcount
                if max_tier >= 3:
                    cur.execute(_TIER3, {"suffix_re": _suffix_regex()})
                    counts["tier3"] = cur.rowcount

                cur.execute(_PERSIST, {"rfid": rfid})
                counts["matches_persisted"] = cur.rowcount
            # Commit the matches BEFORE applying: the apply is the fragile,
            # long-running half, and losing hours of tier work to its failure
            # (as happened 2026-07-27) is unacceptable.
            conn.commit()

            if apply:
                # The apply is restartable by construction (only NULL
                # recipient_org_id rows are touched), so a dead connection —
                # the loaded instance can stall past TCP patience — costs a
                # reconnect and a fast rescan, not the run.
                for attempt in range(6):
                    try:
                        counts.update(apply_matches(conn, apply_tier3=apply_tier3))
                        if apply_tier3:
                            # Recorded in the ledger notes: from here on a
                            # linked row with a tier3 key may be the matcher's
                            # own link, and `resolve aliases --report` must
                            # stop calling its tier3 agreement number clean.
                            counts["tier3_applied"] = 1
                        break
                    except psycopg.OperationalError:
                        if attempt == 5:
                            raise
                        print(f"  apply connection lost — reconnecting "
                              f"(attempt {attempt + 1}/5)", flush=True)
                        try:
                            conn.close()
                        except Exception:
                            pass
                        time.sleep(15)
                        conn = connect()

            ledger.complete_run(conn, run_id,
                                inserted=counts.get("matches_persisted", 0),
                                updated=counts.get("events_linked", 0),
                                notes=json.dumps(counts))
        except Exception as exc:
            try:
                conn.rollback()
                ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
            except Exception:
                pass
            raise
        return counts
    finally:
        try:
            conn.close()
        except Exception:
            pass
