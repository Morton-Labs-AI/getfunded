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
from datetime import datetime
from pathlib import Path

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

_SETUP = """
create temp table _recips on commit drop as
  select internal.norm_name(recipient_name) as nn,
         nullif(btrim(recipient_state), '') as st,
         count(*) as n_events,
         sum(amount) as total_amount
  from internal.funding_events
  where event_type = 'grant' and recipient_org_id is null
    and recipient_name is not null
  group by 1, 2;

create index on _recips (nn);

-- Candidate orgs, with per-name and per-(name,state) multiplicity so each tier
-- can require uniqueness rather than silently picking a winner.
create temp table _cands on commit drop as
  select o.id, o.name_normalized as nn, o.state as st
  from internal.organizations o
  where o.org_type = any(%(types)s) and o.canonical_org_id is null;

create index on _cands (nn);
create index on _cands (nn, st);

create temp table _name_counts on commit drop as
  select nn, count(*) as n_national from _cands group by 1;
create index on _name_counts (nn);

create temp table _name_state_counts on commit drop as
  select nn, st, count(*) as n_state from _cands group by 1, 2;
create index on _name_state_counts (nn, st);

create temp table _matches (
  nn text, st text, org_id uuid, method text, confidence real
) on commit drop;
"""

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

# Apply to events, and un-apply anything a human later rejected.
_APPLY = """
update internal.funding_events fe
set recipient_org_id = rm.org_id
from internal.recipient_matches rm
where fe.event_type = 'grant'
  and fe.recipient_org_id is null
  and rm.confidence >= 0.90
  and rm.status in ('auto', 'accepted')
  and internal.norm_name(fe.recipient_name) = rm.recipient_name_normalized
  and nullif(btrim(fe.recipient_state), '') is not distinct from rm.recipient_state
"""

_UNAPPLY = """
update internal.funding_events fe
set recipient_org_id = null
from internal.recipient_matches rm
where fe.recipient_org_id = rm.org_id
  and rm.status = 'rejected'
  and internal.norm_name(fe.recipient_name) = rm.recipient_name_normalized
"""


def _suffix_regex() -> str:
    alts = "|".join(STRIPPABLE_SUFFIXES)
    return rf"\s+({alts})$"


def run(apply: bool = True, max_tier: int = 3) -> dict:
    counts: dict[str, int] = {}
    settings = get_settings()

    with connect() as conn:
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
                cur.execute(_SETUP, {"types": list(CANDIDATE_TYPES)})
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

                if apply:
                    cur.execute(_APPLY)
                    counts["events_linked"] = cur.rowcount
                    cur.execute(_UNAPPLY)
                    counts["events_unlinked"] = cur.rowcount
            conn.commit()
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
