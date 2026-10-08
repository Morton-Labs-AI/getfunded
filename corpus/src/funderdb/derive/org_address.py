"""City, state and zip as stated on the latest return.

An organisation that was created from an e-filed return and is not in the IRS
master file has no address on its row. Its returns do: every return header
carries the filer's own address, and the detail pass stores it on
``internal.filings``. This job copies the CITY, STATE and ZIP of that address
to the organisation row and says so in two columns (migration 0030):

    address_basis      'filing_header'
    address_object_id  the IRS OBJECT_ID of the return the address came from

NULL in ``address_basis`` keeps its old meaning: the address came with the
row's own source record (the IRS master file for foundations and charities).

The rule, in the order it is applied (rule_version ``org-address-v1``; the
same text goes into the run manifest):

1. Only an organisation with NO address is considered: state, city, street
   and zip are all empty and address_basis is empty. A row that already has
   any part of an address is left alone, so ``--unapply`` puts back exactly
   what was there before (nothing).
2. The return is the organisation's newest one that was PARSED
   (``details_parsed_at`` is set and ``detail_parse_error`` is empty) and is
   NOT SUPERSEDED. Newest means the greatest ``tax_period_end``, then the
   greatest ``tax_period``, then the greatest ``object_id``: the order the
   application answer and the website use.
3. The address of that return is used only when its country is empty or US
   and its state is one of VALID_STATE_CODES. Otherwise nothing is written.
   The job does not go back to an older return: a newest return that gives a
   foreign address says the older United States address is out of date.
4. What is written: city (upper case, as the IRS master file writes it),
   state, and zip as ``12345`` or ``12345-6789`` when the return gives 5 or 9
   digits (empty otherwise; no digit is added, so there is no ``-0000``).
   NO STREET IS WRITTEN, and this job does not read the street lines at all.
   The street line of a return can name a person ("C/O <name> ...") or be a
   trustee's home, and an organisation's street address from a return is not
   copied to its profile. Search by state and the Open Foundation List need
   city, state and zip only. The filed line stays where it was: on the
   return named in ``address_object_id``.
5. Nothing else on the row changes. The organisation keeps its own
   ``raw_file_id`` and ``source_record_locator``. No row is deleted.

``--unapply`` clears exactly what ``--apply`` wrote: city, state, zip and the
two columns, on the rows that still carry the basis. It does not touch the
street column. The trigger of migration 0030 takes the basis off a row the
moment another loader writes its address (even the same values), so
``--unapply`` never clears an address the master file wrote.

Two known limits, both counted by ``--report``:

* The address is frozen at the return that was newest when ``--apply`` ran.
  A later return can be loaded, or an amended return can replace it.
* "Newest" means newest PARSED. A newer return can be on file and not parsed
  yet (the detail pass has not reached it, or it failed), and then the
  address is the one on an older return. Measured 2026-10-08 on a quarter of
  the organisations, during the back-year load: 448 of 12,231 (3.7%). Run the
  detail pass before ``--apply`` to keep that share small.

``--unapply`` followed by ``--apply`` brings both kinds up to date.

How it runs: 256 slices of the organisation id by its first byte, one short
transaction per slice, each with its own statement timeout, lock timeout and
the memory guards of ``resolve/recipients.py``. A slice is one range scan of
the primary key (about 8,800 organisations) and, for each one that has no
address, two index probes on ``ix_filings_org``. ``--apply`` is safe to run
again: it only fills rows that are still empty, so a second run changes 0
rows.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

import psycopg

from .. import ledger, staging
from ..config import get_settings
from ..db import connect
from ..normalize import STATE_CODES, state_code
from ..resolve.recipients import _MEMORY_GUARDS
from .turnover import N_SLICES, _connection_lost, slice_bounds

RULE_VERSION = "org-address-v1"
LEDGER_NAME = "derive_org_address"
LEDGER_UNAPPLY = "derive_org_address_unapply"
BASIS = "filing_header"
TABLE = "internal.organizations"
MIGRATION = "0030_org_address_from_filings.sql"

SLICE_TIMEOUT = "5min"    # per statement; a slice normally takes well under a second
LOCK_TIMEOUT = "30s"      # a row another writer holds must not stall the run
REPORT_TIMEOUT = "10min"  # the report reads the organisations table once
PROGRESS_EVERY = 32
MAX_EXAMPLES = 5

# normalize.STATE_CODES holds the 50 states, DC, PR, GU and VI. The website's
# state filter also offers American Samoa and the Northern Mariana Islands.
# Military mail codes (AA, AE, AP) and FM, MH, PW are not states or
# territories and are not accepted.
EXTRA_TERRITORY_CODES: tuple[str, ...] = ("AS", "MP")
VALID_STATE_CODES: frozenset[str] = frozenset(STATE_CODES.values()) | frozenset(
    EXTRA_TERRITORY_CODES)
# The detail pass stores a country only for a foreign address, so a United
# States address normally has none.
US_COUNTRY_CODES: tuple[str, ...] = ("", "US")

RULE_TEXT: tuple[str, ...] = (
    "Organisations considered: state, city, street and zip are all empty and "
    "address_basis is empty. A row with any part of an address is left alone.",
    "The return: the organisation's newest return in internal.filings that was parsed "
    "(details_parsed_at set, detail_parse_error empty) and is not superseded. Newest is the "
    "greatest tax_period_end, then the greatest tax_period, then the greatest object_id.",
    "The filer address of that return is used only when its country is empty or US and its "
    "state is a two-letter code of a United States state or territory. Otherwise nothing is "
    "written; the job does not go back to an older return.",
    "Written: city in upper case, state, and zip as 12345 or 12345-6789 when the return gives "
    "5 or 9 digits, else empty. No street is written: an organisation's street address from a "
    "return is not copied to its profile, because that line can name a person.",
    "Also written: address_basis 'filing_header' and address_object_id, the IRS OBJECT_ID of "
    "the return. The organisation's own raw_file_id and source_record_locator do not change.",
    "Unapply sets city, state and zip back to empty exactly where address_basis is "
    "'filing_header', and clears the two columns. It does not touch street. No row is deleted.",
    "Known limit: newest means newest parsed. When a newer return is on file and not parsed "
    "yet, the address is the one on the older, parsed return. The report counts these rows.",
    "The address values are public-domain IRS data. This manifest and the choice of return "
    "are our compilation (CC BY).",
)

# Why an organisation with no address gets none from this job.
REASONS: tuple[str, ...] = ("no_parsed_return", "foreign", "no_state", "bad_state")

Echo = Callable[[str], None]

_WS = re.compile(r"\s+")
_NON_DIGIT = re.compile(r"\D")


# ---------------------------------------------------------------------------
# The rule for one return header. Pure: no database.
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Address:
    """What this job writes. There is no street field on purpose (rule 4)."""
    city: str | None
    state: str
    zip: str | None


def _clean(raw: str | None) -> str | None:
    """Trimmed, with runs of white space made one space. None when empty."""
    s = _WS.sub(" ", raw or "").strip()
    return s or None


def format_zip(raw: str | None) -> str | None:
    """``12345`` or ``12345-6789`` (the master file's shape). None when the
    return does not give exactly 5 or 9 digits: no digit is ever added."""
    digits = _NON_DIGIT.sub("", raw or "")
    if len(digits) == 5:
        return digits
    if len(digits) == 9:
        return f"{digits[:5]}-{digits[5:]}"
    return None


def address_from_header(city: str | None, state: str | None, zip_code: str | None,
                        country: str | None) -> tuple[Address | None, str]:
    """The city, state and zip to write for one return header, and why not when
    there is none. The second value is ``ok``, ``foreign``, ``no_state`` or
    ``bad_state``. The street lines of the header are not an input."""
    if (country or "").strip().upper() not in US_COUNTRY_CODES:
        return None, "foreign"
    if not (state or "").strip():
        return None, "no_state"
    code = state_code(state)
    if code is None or code not in VALID_STATE_CODES:
        return None, "bad_state"
    city_clean = _clean(city)
    return Address(city=city_clean.upper() if city_clean else None,
                   state=code,
                   zip=format_zip(zip_code)), "ok"


# ---------------------------------------------------------------------------
# SQL
# ---------------------------------------------------------------------------
# One slice of organisations with no address, each with its newest parsed,
# non-superseded return (or NULLs when it has none). `{basis_guard}` is the
# address_basis test; it is left out only for a dry run on a database that
# does not have migration 0030 yet, where every row would pass it.
#
# The street lines (filer_addr_line1, filer_addr_line2) are not selected: the
# job does not write them (rule 4), so it does not read them either.
#
# `newest_object_id` is the newest non-superseded return of ANY parse state.
# It is only counted, never used for the address: when it differs from
# `object_id`, a newer return is on file that the detail pass has not parsed.
_CANDIDATES = """
select o.id, o.org_type,
       f.object_id, f.tax_period,
       f.filer_city, f.filer_state, f.filer_zip, f.filer_country,
       nw.object_id as newest_object_id
from internal.organizations o
left join lateral (
  select fl.object_id, fl.tax_period,
         fl.filer_city, fl.filer_state, fl.filer_zip, fl.filer_country
  from internal.filings fl
  where fl.org_id = o.id
    and fl.details_parsed_at is not null
    and fl.detail_parse_error is null
    and fl.superseded_by_object_id is null
  order by fl.tax_period_end desc nulls last, fl.tax_period desc nulls last,
           fl.object_id desc
  limit 1
) f on true
left join lateral (
  select fl.object_id
  from internal.filings fl
  where fl.org_id = o.id
    and fl.superseded_by_object_id is null
  order by fl.tax_period_end desc nulls last, fl.tax_period desc nulls last,
           fl.object_id desc
  limit 1
) nw on true
where o.id >= %(lo)s::uuid and o.id <= %(hi)s::uuid
  and o.state is null and o.city is null and o.street is null and o.zip is null
  {basis_guard}
order by o.id
"""
_BASIS_GUARD = "and o.address_basis is null"

# The write. Every guard of the read is repeated here, on the row as it is at
# the moment of the update: a row that another writer filled in between is
# skipped, and so is a return that was superseded in between. `street` is
# tested (it must be empty) and never set.
_WRITE = """
update internal.organizations o
set city = v.city, state = v.state, zip = v.zip,
    address_basis = %(basis)s, address_object_id = v.object_id
from unnest(%(ids)s::uuid[], %(cities)s::text[],
            %(states)s::text[], %(zips)s::text[], %(oids)s::text[])
     as v(id, city, state, zip, object_id)
where o.id = v.id
  and o.state is null and o.city is null and o.street is null and o.zip is null
  and o.address_basis is null
  and exists (select 1 from internal.filings fl
              where fl.object_id = v.object_id
                and fl.org_id = o.id
                and fl.superseded_by_object_id is null)
returning o.org_type
"""

_UNAPPLY_COUNT = """
select o.org_type, count(*)::int
from internal.organizations o
where o.id >= %(lo)s::uuid and o.id <= %(hi)s::uuid
  and o.address_basis = %(basis)s
group by o.org_type
"""

# Clears what --apply wrote and nothing else: `street` is not in the list.
# The basis changes in this statement, so the 0030 trigger does not run.
_UNAPPLY = """
update internal.organizations o
set city = null, state = null, zip = null,
    address_basis = null, address_object_id = null
where o.id >= %(lo)s::uuid and o.id <= %(hi)s::uuid
  and o.address_basis = %(basis)s
returning o.org_type
"""

_REPORT_NO_STATE = """
select o.org_type,
       count(*)::int as no_state,
       (count(*) filter (where o.city is null and o.street is null and o.zip is null))::int
         as no_address,
       (count(*) filter (where o.city is not null or o.street is not null
                            or o.zip is not null))::int as other_parts
from internal.organizations o
where o.state is null
group by o.org_type
order by 2 desc, 1
"""

# One read of the organisations table (there is no index on address_basis),
# then one index probe on filings for each row found.
_REPORT_WRITTEN = """
select o.org_type,
       count(*)::int as n,
       (count(*) filter (where l.object_id is distinct from o.address_object_id))::int
         as not_newest,
       (count(*) filter (where nw.object_id is distinct from l.object_id))::int
         as newer_not_parsed,
       (count(*) filter (where o.street is not null))::int as with_street,
       min(left(a.tax_period, 4)), max(left(a.tax_period, 4))
from internal.organizations o
left join internal.filings a on a.object_id = o.address_object_id
left join lateral (
  select fl.object_id
  from internal.filings fl
  where fl.org_id = o.id
    and fl.details_parsed_at is not null
    and fl.detail_parse_error is null
    and fl.superseded_by_object_id is null
  order by fl.tax_period_end desc nulls last, fl.tax_period desc nulls last,
           fl.object_id desc
  limit 1
) l on true
left join lateral (
  select fl.object_id
  from internal.filings fl
  where fl.org_id = o.id
    and fl.superseded_by_object_id is null
  order by fl.tax_period_end desc nulls last, fl.tax_period desc nulls last,
           fl.object_id desc
  limit 1
) nw on true
where o.address_basis = %(basis)s
group by o.org_type
order by 2 desc, 1
"""

_REPORT_RUNS = """
select dataset_name, status, started_at at time zone 'utc',
       completed_at at time zone 'utc', rows_updated
from internal.ingestion_ledger
where dataset_name = any(%(names)s)
order by id desc
limit 5
"""


# ---------------------------------------------------------------------------
# Preflight and manifest
# ---------------------------------------------------------------------------
def _has_columns(conn: psycopg.Connection) -> bool:
    """True when migration 0030 is applied (both columns are on the table)."""
    with conn.cursor() as cur:
        cur.execute(
            "select count(*) from pg_attribute "
            "where attrelid = to_regclass(%s) and attname = any(%s) "
            "and attnum > 0 and not attisdropped",
            (TABLE, ["address_basis", "address_object_id"]))
        n = cur.fetchone()[0]
    conn.rollback()
    return n == 2


def _require_columns(conn: psycopg.Connection) -> None:
    if not _has_columns(conn):
        raise RuntimeError(
            f"{TABLE} has no address_basis column yet. Migration {MIGRATION} adds it. "
            "Run `uv run funderdb migrate` first. Nothing was written.")


def _register_manifest(conn: psycopg.Connection) -> tuple[int, str]:
    """Write the rule as a file, stage it and register it in raw_files.

    The text depends only on the rule, so every run of one rule version
    points at the same raw_files row; each run gets its own ledger row.
    """
    manifest_dir = Path(get_settings().data_root) / "derive"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    manifest = manifest_dir / f"{RULE_VERSION}.json"
    manifest.write_text(json.dumps({
        "job": LEDGER_NAME,
        "rule_version": RULE_VERSION,
        "rule": RULE_TEXT,
        "address_basis": BASIS,
        "valid_state_codes": sorted(VALID_STATE_CODES),
        "us_country_codes": US_COUNTRY_CODES,
        "newest_return_order": ["tax_period_end desc", "tax_period desc", "object_id desc"],
        "slices": N_SLICES,
        "licence": {"compilation": "cc_by",
                    "address_values": "us_public_domain (IRS e-file return headers)"},
    }, indent=2))
    staged = staging.stage_local(LEDGER_NAME, manifest)
    rfid = staging.register_raw_file(conn, staged, license_code="cc_by",
                                     content_type="application/json")
    conn.commit()
    return rfid, staged.sha256


# ---------------------------------------------------------------------------
# One slice
# ---------------------------------------------------------------------------
def _guards(cur: psycopg.Cursor) -> None:
    """Per-transaction guards. `set local` ends with the transaction, so every
    slice sets them again."""
    cur.execute(f"set local statement_timeout = '{SLICE_TIMEOUT}'")
    cur.execute(f"set local lock_timeout = '{LOCK_TIMEOUT}'")
    for guard in _MEMORY_GUARDS:
        cur.execute(guard)
    # Every table a slice touches is reached through an index (the id range,
    # ix_orgs_state, ix_filings_org, the primary keys). With sequential scans
    # off, no row estimate can turn one slice into a read of a whole table.
    cur.execute("set local enable_seqscan = off")


def _bump(counter: dict, key, by: int = 1) -> None:
    counter[key] = counter.get(key, 0) + by


def _new_stats() -> dict:
    return {"candidates": {}, "usable": {}, "written": {}, "reasons": {},
            "newer_unparsed": {},
            "zip_empty": 0, "city_empty": 0, "by_fy": {}, "examples": []}


def _apply_slice(cur: psycopg.Cursor, n: int, *, write: bool, basis_guard: bool) -> dict:
    """Read one slice, work out the addresses and (with ``write``) store them."""
    lo, hi = slice_bounds(n)
    stats = _new_stats()
    cur.execute(_CANDIDATES.format(basis_guard=_BASIS_GUARD if basis_guard else ""),
                {"lo": lo, "hi": hi})
    ids, cities, states, zips, oids = [], [], [], [], []
    for (org_id, org_type, object_id, tax_period,
         city, state, zip_code, country, newest_object_id) in cur.fetchall():
        _bump(stats["candidates"], org_type)
        if object_id is None:
            _bump(stats["reasons"], (org_type, "no_parsed_return"))
            continue
        address, reason = address_from_header(city, state, zip_code, country)
        if address is None:
            _bump(stats["reasons"], (org_type, reason))
            continue
        _bump(stats["usable"], org_type)
        if newest_object_id != object_id:
            # A newer return is on file and the detail pass has not parsed it.
            _bump(stats["newer_unparsed"], org_type)
        _bump(stats["by_fy"], (tax_period or "")[:4] or "?")
        stats["zip_empty"] += address.zip is None
        stats["city_empty"] += address.city is None
        if len(stats["examples"]) < MAX_EXAMPLES:
            stats["examples"].append((str(org_id), org_type, object_id,
                                      (tax_period or "")[:4] or "?", address))
        ids.append(org_id)
        cities.append(address.city)
        states.append(address.state)
        zips.append(address.zip)
        oids.append(object_id)
    if write and ids:
        cur.execute(_WRITE, {"basis": BASIS, "ids": ids,
                             "cities": cities, "states": states, "zips": zips,
                             "oids": oids})
        for (org_type,) in cur.fetchall():
            _bump(stats["written"], org_type)
    return stats


def _unapply_slice(cur: psycopg.Cursor, n: int, *, write: bool) -> dict:
    """Clear one slice. ``candidates`` are the rows that carry the basis."""
    lo, hi = slice_bounds(n)
    stats = _new_stats()
    params = {"lo": lo, "hi": hi, "basis": BASIS}
    if write:
        cur.execute(_UNAPPLY, params)
        for (org_type,) in cur.fetchall():
            _bump(stats["candidates"], org_type)
            _bump(stats["written"], org_type)
    else:
        cur.execute(_UNAPPLY_COUNT, params)
        for org_type, count in cur.fetchall():
            _bump(stats["candidates"], org_type, count)
    return stats


def _merge(total: dict, part: dict) -> None:
    for key in ("candidates", "usable", "written", "reasons", "newer_unparsed", "by_fy"):
        for k, v in part[key].items():
            _bump(total[key], k, v)
    total["zip_empty"] += part["zip_empty"]
    total["city_empty"] += part["city_empty"]
    room = MAX_EXAMPLES - len(total["examples"])
    if room > 0:
        total["examples"].extend(part["examples"][:room])


def _sum(counter: dict) -> int:
    return sum(counter.values())


# ---------------------------------------------------------------------------
# The sweep over slices (apply, unapply and their dry runs)
# ---------------------------------------------------------------------------
def _sweep(live: dict, action: str, todo: list[int], *, write: bool, basis_guard: bool,
           explicit: bool, echo: Echo) -> tuple[dict, list[int]]:
    """Run ``action`` over ``todo``, one transaction per slice.

    ``live["conn"]`` is the connection. It is replaced here when the server
    drops it, so the caller always holds the live one. Returns the totals and
    the slices that did not finish.
    """
    total = _new_stats()
    failed: list[int] = []
    done = 0
    t_run = time.monotonic()
    for s in todo:
        stats: dict | None = None
        t0 = time.monotonic()
        for attempt in range(6):
            conn = live["conn"]
            t0 = time.monotonic()
            try:
                with conn.cursor() as cur:
                    if not write:
                        cur.execute("set transaction read only")
                    _guards(cur)
                    if action == "apply":
                        stats = _apply_slice(cur, s, write=write, basis_guard=basis_guard)
                    else:
                        stats = _unapply_slice(cur, s, write=write)
                if write:
                    conn.commit()
                else:
                    conn.rollback()
                break
            except (psycopg.errors.QueryCanceled, psycopg.errors.LockNotAvailable,
                    psycopg.errors.DeadlockDetected) as exc:
                # A time limit, a lock that did not come free, or a deadlock.
                # The slice is rolled back whole: its rows stay as they were.
                # One slow slice must not cost the others, so the run goes on
                # and names the slice at the end.
                stats = None
                conn.rollback()
                why = (exc.diag.message_primary or type(exc).__name__).strip()
                echo(f"  slice {s:>3} [0x{s:02x}]: NOT FINISHED after "
                     f"{time.monotonic() - t0:.0f}s ({why}). Rolled back; nothing of this "
                     "slice was changed.")
                failed.append(s)
                break
            except psycopg.OperationalError:
                # Only a LOST connection is retried. A retried slice is safe:
                # a slice that did not commit changed nothing, and one that
                # did commit has no empty rows left to fill.
                if not _connection_lost(conn) or attempt == 5:
                    raise
                echo(f"  slice {s}: connection lost, reconnecting (attempt {attempt + 1}/5)")
                try:
                    conn.close()
                except Exception:
                    pass
                time.sleep(15)
                live["conn"] = connect()
        if stats is None:
            continue
        # Counted only now, after the commit, so a retried slice is never
        # counted twice.
        _merge(total, stats)
        done += 1
        if explicit:
            echo(_slice_line(action, s, stats, time.monotonic() - t0, write))
        elif done % PROGRESS_EVERY == 0 or done == len(todo):
            echo(f"  {done:>3}/{len(todo)} slices · "
                 + _progress(action, total, write)
                 + f" · {time.monotonic() - t_run:.0f}s")
    total["slices_done"] = done
    return total, failed


def _progress(action: str, total: dict, write: bool) -> str:
    if action == "unapply":
        return (f"{_sum(total['written']):,} rows cleared" if write
                else f"{_sum(total['candidates']):,} rows would be cleared")
    return (f"{_sum(total['candidates']):,} with no address · "
            f"{_sum(total['usable']):,} with a usable return address"
            + (f" · {_sum(total['written']):,} written" if write else ""))


def _slice_line(action: str, n: int, stats: dict, secs: float, write: bool) -> str:
    return f"  slice {n:>3} [0x{n:02x}]: {_progress(action, stats, write)} · {secs:.2f}s"


def _apply_lines(total: dict, write: bool) -> list[str]:
    """The per-organisation-type table and the notes under it."""
    types = sorted(total["candidates"], key=lambda t: (-total["candidates"][t], t))
    out = [f"  {'org type':<20} {'no address':>10} {'usable':>9} "
           + (f"{'written':>9} " if write else "")
           + f"{'no parsed return':>17} {'foreign':>8} {'no US state':>12}"]
    for t in types:
        reasons = {r: total["reasons"].get((t, r), 0) for r in REASONS}
        out.append(
            f"  {t:<20} {total['candidates'][t]:>10,} {total['usable'].get(t, 0):>9,} "
            + (f"{total['written'].get(t, 0):>9,} " if write else "")
            + f"{reasons['no_parsed_return']:>17,} {reasons['foreign']:>8,} "
              f"{reasons['no_state'] + reasons['bad_state']:>12,}")
    if not types:
        out.append("  (no organisation without an address in these slices)")
    usable = _sum(total["usable"])
    if usable:
        out.append(f"  of the {usable:,} usable: {total['zip_empty']:,} with a zip that is not "
                   f"5 or 9 digits (zip left empty) · {total['city_empty']:,} with no city on "
                   "the return")
        out.append("  fiscal year of the return used: "
                   + " · ".join(f"{fy}: {n:,}" for fy, n in sorted(total["by_fy"].items())))
        newer = _sum(total["newer_unparsed"])
        out.append(f"  of the {usable:,} usable: {newer:,} "
                   f"({100.0 * newer / usable:.1f}%) have a newer return on file that is not "
                   "parsed yet, so the address is the one on an older return"
                   + (" (" + ", ".join(f"{t}: {n:,}" for t, n in
                                       sorted(total["newer_unparsed"].items())) + ")"
                      if newer else ""))
        if newer:
            out.append("  Run the detail pass first to make that number small, or run "
                       "--unapply and --apply again after it.")
        out.append("  Written: city, state and zip. No street is written (the street line of "
                   "a return can name a person).")
    for org_id, org_type, object_id, fy, a in total["examples"]:
        out.append(f"  example: {org_type} {org_id} <- return {object_id} (FY{fy}): "
                   f"{a.city or '(no city)'} | {a.state} | {a.zip or '(no zip)'}")
    return out


FOLLOW_UPS: tuple[str, ...] = (
    "refresh materialized view concurrently internal.mv_org_state_counts;"
    "   -- the state counts on /foundations and for the analyst",
    "uv run funderdb embed sync --kind foundation"
    "   -- search_documents.state and the place in the document text (thesis search)",
    "uv run funderdb export foundations --out DIR"
    "   -- the Open Foundation List picks up city, state, zip and address_basis",
)


def _notes(total: dict, **extra) -> str:
    return json.dumps({
        "rule_version": RULE_VERSION,
        "candidates": total["candidates"], "usable": total["usable"],
        "written": total["written"],
        "not_usable": {f"{t}:{r}": n for (t, r), n in sorted(total["reasons"].items())},
        "zip_left_empty": total["zip_empty"], "no_city_on_return": total["city_empty"],
        "newer_return_not_parsed": total["newer_unparsed"],
        "by_fiscal_year": dict(sorted(total["by_fy"].items())),
        **extra,
    })


def run(action: str = "apply", slices: Iterable[int] | None = None,
        dry_run: bool = False, echo: Echo = print) -> dict:
    """``action`` is ``apply`` or ``unapply``. ``slices=None`` means all 256.

    A dry run reads and prints and writes nothing: no organisation row, no
    raw_files row, no ledger row. A dry run of ``apply`` also works before
    migration 0030 is applied.
    """
    if action not in ("apply", "unapply"):
        raise ValueError(f"unknown action {action!r}")
    explicit = slices is not None
    todo = sorted({int(s) for s in slices}) if explicit else list(range(N_SLICES))
    for s in todo:
        slice_bounds(s)          # range check
    write = not dry_run

    # Not a `with` block, for the reason recipients.run() gives: a slice
    # reconnects when the loaded instance drops the connection, and a context
    # manager would try to commit or roll back the dead one on exit.
    live = {"conn": connect()}
    try:
        has_columns = _has_columns(live["conn"])
        if not has_columns and (write or action == "unapply"):
            _require_columns(live["conn"])

        rfid: int | None = None
        run_id: int | None = None
        label = "city, state and zip from the latest return" if action == "apply" else "unapply"
        if dry_run:
            echo(f"DRY RUN, {label} ({RULE_VERSION}): {len(todo)} slice(s). Nothing is written.")
            if not has_columns:
                echo(f"  NOTE: migration {MIGRATION} is not applied here. The counts are what "
                     "--apply would write once it is.")
        else:
            rfid, sha = _register_manifest(live["conn"])
            run_id = ledger.start_run(live["conn"], rfid,
                                      LEDGER_NAME if action == "apply" else LEDGER_UNAPPLY)
            echo(f"{label} ({RULE_VERSION}): {len(todo)} slice(s), rule file raw_file_id "
                 f"{rfid} (sha256 {sha[:12]}), ledger run {run_id}")

        t_run = time.monotonic()
        try:
            total, failed = _sweep(live, action, todo, write=write, basis_guard=has_columns,
                                   explicit=explicit, echo=echo)
            if run_id is not None:
                notes = _notes(total, action=action,
                               slices=todo if explicit else len(todo),
                               slices_not_finished=failed)
                written = _sum(total["written"])
                if failed:
                    ledger.fail_run(live["conn"], run_id, notes)
                else:
                    ledger.complete_run(live["conn"], run_id, updated=written,
                                        skipped=_sum(total["candidates"]) - written,
                                        notes=notes)
        except Exception as exc:
            if run_id is not None:
                try:
                    live["conn"].rollback()
                    ledger.fail_run(live["conn"], run_id, f"{type(exc).__name__}: {exc}")
                except Exception:
                    pass
            raise

        echo("")
        echo(f"{'DRY RUN totals' if dry_run else 'totals'} for {total['slices_done']} "
             f"slice(s) in {time.monotonic() - t_run:.0f}s:")
        if action == "apply":
            for line in _apply_lines(total, write):
                echo(line)
        else:
            for t in sorted(total["candidates"], key=lambda k: (-total["candidates"][k], k)):
                echo(f"  {t:<20} {total['candidates'][t]:>10,} "
                     + ("cleared" if write else "would be cleared"))
            if not total["candidates"]:
                echo(f"  no row carries address_basis = '{BASIS}' in these slices")
        if dry_run:
            echo("  Nothing was written.")
        elif _sum(total["written"]):
            echo("")
            echo("Follow-ups (state changed on organisation rows):")
            for i, line in enumerate(FOLLOW_UPS, 1):
                echo(f"  {i}. {line}")
        if failed:
            again = " ".join(f"--slice {n}" for n in failed)
            flag = f"--{action}" + (" --dry-run" if dry_run else "")
            raise RuntimeError(
                f"{len(failed)} slice(s) did not finish: {failed}. Every other slice is "
                + ("read" if dry_run else "done")
                + ". Run the missing one(s) again when the database is less busy: "
                f"`uv run funderdb derive org-address {flag} {again}`.")

        counts = {"slices_done": total["slices_done"],
                  "organisations_with_no_address": _sum(total["candidates"]),
                  "usable_return_address": _sum(total["usable"]),
                  "rows_written": _sum(total["written"])}
        if action == "unapply":
            counts = {"slices_done": total["slices_done"],
                      "rows_with_basis": _sum(total["candidates"]),
                      "rows_cleared": _sum(total["written"])}
        return counts
    finally:
        try:
            live["conn"].close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
def report(echo: Echo = print) -> None:
    """Dated counts. Reads only; changes nothing."""
    live = {"conn": connect()}
    try:
        conn = live["conn"]
        has_columns = _has_columns(conn)
        with conn.cursor() as cur:
            cur.execute("set transaction read only")
            cur.execute(f"set local statement_timeout = '{REPORT_TIMEOUT}'")
            for guard in _MEMORY_GUARDS:
                cur.execute(guard)
            cur.execute("select now() at time zone 'utc'")
            now = cur.fetchone()[0]
            cur.execute(_REPORT_NO_STATE)
            no_state = cur.fetchall()
        conn.rollback()

        echo(f"City, state and zip from the latest return ({RULE_VERSION}), "
             f"measured {now:%Y-%m-%d %H:%M} UTC")
        echo("Counts move with every ingest.")
        echo("")
        echo("A. Organisations with no state")
        echo(f"   {'org type':<20} {'no state':>10} {'no address at all':>18} "
             f"{'city, street or zip only':>25}")
        for org_type, n, blank, parts in no_state:
            echo(f"   {org_type:<20} {n:>10,} {blank:>18,} {parts:>25,}")
        if not no_state:
            echo("   none")
        echo("   A row with a city, street or zip but no state is left alone by this job.")
        echo("")

        echo("B. Of those with no address at all: what the newest parsed, non-superseded "
             "return gives")
        total, failed = _sweep(live, "apply", list(range(N_SLICES)), write=False,
                               basis_guard=has_columns, explicit=False,
                               echo=lambda _line: None)
        for line in _apply_lines({**total, "examples": []}, write=False):
            echo(" " + line)
        if failed:
            echo(f"   NOTE: {len(failed)} slice(s) did not finish and are not counted: {failed}")
        echo("   `usable` is what --apply would write now. After an --apply it is 0.")
        echo("")

        echo(f"C. Rows that carry address_basis = '{BASIS}' now")
        if not has_columns:
            echo(f"   migration {MIGRATION} is not applied here, so there are none.")
            return
        conn = live["conn"]
        with conn.cursor() as cur:
            cur.execute("set transaction read only")
            cur.execute(f"set local statement_timeout = '{REPORT_TIMEOUT}'")
            for guard in _MEMORY_GUARDS:
                cur.execute(guard)
            # The two joins to filings must stay index probes, one per row
            # found. A hash or merge join would read all of internal.filings.
            cur.execute("set local enable_hashjoin = off")
            cur.execute("set local enable_mergejoin = off")
            cur.execute(_REPORT_WRITTEN, {"basis": BASIS})
            written = cur.fetchall()
            cur.execute(_REPORT_RUNS, {"names": [LEDGER_NAME, LEDGER_UNAPPLY]})
            runs = cur.fetchall()
        conn.rollback()
        if written:
            echo(f"   {'org type':<20} {'rows':>10} {'return no longer newest':>24} "
                 f"{'newer return not parsed':>24} {'fiscal years':>14}")
            for org_type, n, stale, unparsed, _street, fy_min, fy_max in written:
                echo(f"   {org_type:<20} {n:>10,} {stale:>24,} {unparsed:>24,} "
                     f"{(fy_min or '?') + '-' + (fy_max or '?'):>14}")
            echo("   `return no longer newest`: a later return was loaded and parsed, or an "
                 "amended return replaced it.")
            echo("   `newer return not parsed`: a newer return is on file and the detail pass "
                 "has not parsed it.")
            echo("   Run the detail pass, then --unapply and --apply, to bring those rows up "
                 "to date.")
            with_street = sum(row[4] for row in written)
            if with_street:
                echo(f"   WARNING: {with_street:,} of these rows have a street. This job writes "
                     "none, and the 0030 trigger takes the basis off a row when another loader "
                     "writes its address. Check that the trigger is in place.")
            else:
                echo("   No row with this basis has a street, as the rule says.")
        else:
            echo("   none. Run `uv run funderdb derive org-address --apply`.")
        if runs:
            echo("   last runs in the ledger (UTC):")
            for name, status, started, completed, updated in runs:
                when = f"{completed:%Y-%m-%d %H:%M}" if completed else f"{started:%Y-%m-%d %H:%M}"
                echo(f"     {when}  {name:<28} {status:<10} {updated:,} rows")
    finally:
        try:
            live["conn"].close()
        except Exception:
            pass
