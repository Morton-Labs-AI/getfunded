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
# NOT in one statement over 2.32M events: the single-statement version was killed
# by the server mid-flight (2026-07-27). Uses ix_events_recipient_norm so each
# matched name is an index lookup rather than a scan.
_APPLY_BATCH = """
update internal.funding_events fe
set recipient_org_id = rm.org_id
from internal.recipient_matches rm
where rm.id between %(lo)s and %(hi)s
  and rm.confidence >= 0.90
  and rm.status in ('auto', 'accepted')
  and fe.event_type = 'grant'
  and fe.recipient_org_id is null
  and internal.norm_name(fe.recipient_name) = rm.recipient_name_normalized
  and nullif(btrim(fe.recipient_state), '') is not distinct from rm.recipient_state
"""

_UNAPPLY_BATCH = """
update internal.funding_events fe
set recipient_org_id = null
from internal.recipient_matches rm
where rm.id between %(lo)s and %(hi)s
  and rm.status = 'rejected'
  and fe.recipient_org_id = rm.org_id
  and internal.norm_name(fe.recipient_name) = rm.recipient_name_normalized
"""


def _suffix_regex() -> str:
    alts = "|".join(STRIPPABLE_SUFFIXES)
    return rf"\s+({alts})$"


def apply_matches(conn, batch: int = 20_000) -> dict:
    """Link events to matched orgs, one committed batch of matches at a time.

    Restartable by construction: only rows with recipient_org_id IS NULL are
    touched, so a re-run picks up exactly where an interrupted one stopped.
    """
    counts = {"events_linked": 0, "events_unlinked": 0}
    with conn.cursor() as cur:
        cur.execute("select coalesce(min(id), 0), coalesce(max(id), -1) "
                    "from internal.recipient_matches")
        lo_id, hi_id = cur.fetchone()

    lo = lo_id
    while lo <= hi_id:
        hi = lo + batch - 1
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '15min'")
            cur.execute(_APPLY_BATCH, {"lo": lo, "hi": hi})
            counts["events_linked"] += cur.rowcount
            cur.execute(_UNAPPLY_BATCH, {"lo": lo, "hi": hi})
            counts["events_unlinked"] += cur.rowcount
        conn.commit()
        print(f"  applied matches {lo:,}-{min(hi, hi_id):,} · "
              f"{counts['events_linked']:,} events linked", flush=True)
        lo = hi + 1
    return counts


def run(apply: bool = True, max_tier: int = 3) -> dict:
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
        manifest.write_text(json.dumps({
            "job": "recipients",
            "method": "deterministic tiers 1-%d" % max_tier,
            "candidate_types": CANDIDATE_TYPES,
            "strippable_suffixes": STRIPPABLE_SUFFIXES,
        }, indent=2))
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
                        counts.update(apply_matches(conn))
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
