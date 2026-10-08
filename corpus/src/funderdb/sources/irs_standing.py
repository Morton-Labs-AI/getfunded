"""IRS standing: is this organization still recognized by the IRS today?

Two lists from the IRS Tax Exempt Organization Search bulk downloads
(https://www.irs.gov/charities-non-profits/tax-exempt-organization-search-bulk-data-downloads):

* the **Automatic Revocation of Exemption List** (dataset ``irs_auto_revocation``),
  https://apps.irs.gov/pub/epostcard/data-download-revocation.zip — every
  organization whose exemption was revoked by operation of law because it
  filed no return or notice for three years in a row. It holds no other kind
  of revocation.
* **Publication 78 data** (dataset ``irs_pub78``),
  https://apps.irs.gov/pub/epostcard/data-download-pub78.zip — organizations
  that can receive tax-deductible contributions, with a deductibility code.

Both are U.S. Government works (``us_public_domain``). The IRS republishes
both under the same name about once a month, so they are mutable feeds.

File layout (measured 2026-10-08, and checked again on every run)
-----------------------------------------------------------------
One pipe-delimited text member per zip, UTF-8, **no header row**. Each file
starts with two blank lines and ends with one. A data line is a line whose
first field is all digits.

Revocation list, 12 fields::

    [0] EIN  [1] legal name  [2] doing-business-as name  [3] street  [4] city
    [5] state  [6] ZIP  [7] country  [8] exemption type  [9] revocation date
    [10] revocation posting date  [11] exemption reinstatement date

Publication 78, 6 fields::

    [0] EIN  [1] legal name  [2] city  [3] state  [4] country
    [5] deductibility codes, comma separated

Dates look like ``15-NOV-2017``.

Allow-list (what leaves the file)
---------------------------------
Revocation list: fields 0, 1, 8, 9, 10, 11. Publication 78: fields 0 and 5.
Street, city, state, ZIP, country and the doing-business-as name are never
loaded and never printed (the layout check prints their length only).

Load doctrine
-------------
* **Every row is loaded**, not only EINs the database already knows, so an
  organization added by a later ingest has its answer the moment it arrives.
* **Each load is a full snapshot in one transaction**: rows are upserted,
  rows the new file no longer carries are deleted, and
  ``internal.irs_list_snapshots`` is pointed at the new file. A reader sees
  the old list or the new list, never a mix, and an organization the IRS
  removed from Publication 78 does not keep a stale row.
* A new file that holds under 90% of the rows now loaded is refused
  (``--allow-shrink`` overrides), so a cut-off download cannot wipe a list.
* Dates are stored **as filed**. Two corrections are applied where the lists
  are read (migration 0028, ``internal.org_irs_standing``), not here:
  a reinstatement counts only when it is on or after the revocation date, and
  a listed revocation date from 2020-04-01 to 2020-07-14 reads 2020-07-15
  (``effective_revocation_date``), as the IRS says it should.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path
from typing import Iterator

from .. import ledger, staging
from ..db import connect

BULK_PAGE = ("https://www.irs.gov/charities-non-profits/"
             "tax-exempt-organization-search-bulk-data-downloads")
BASE_URL = "https://apps.irs.gov/pub/epostcard/"
LICENSE_CODE = "us_public_domain"
# Same URL, new bytes about once a month: a mutable feed.
MAX_AGE = timedelta(days=30)

# The IRS says listed revocation dates in this window are wrong and should
# read 2020-07-15 (filing dates were extended in the COVID-19 emergency).
# Counted here for the run notes; the correction itself lives in the views.
WINDOW_2020 = (date(2020, 4, 1), date(2020, 7, 14))

# A new file with fewer than this share of the rows now loaded is refused: the
# revocation list only grows and Publication 78 moves by a fraction of a
# percent a month, so a big drop means a cut-off or wrong file, and loading it
# would silently un-revoke (or un-list) every organization that fell out.
MIN_ROW_SHARE = 0.9

_MONTHS = {"JAN": 1, "FEB": 2, "MAR": 3, "APR": 4, "MAY": 5, "JUN": 6,
           "JUL": 7, "AUG": 8, "SEP": 9, "OCT": 10, "NOV": 11, "DEC": 12}

# Same guards as resolve/recipients.py: the report reads a few hundred
# thousand rows on a small shared instance and must not take its memory.
_MEMORY_GUARDS: tuple[str, ...] = (
    "set local max_parallel_workers_per_gather = 0",
    "set local work_mem = '32MB'",
    "set local hash_mem_multiplier = 1.0",
)


@dataclass(frozen=True)
class ListSpec:
    key: str                 # --only value
    dataset: str             # internal.raw_files.dataset_name
    filename: str
    n_fields: int
    label: str
    # Field positions that are loaded. Every other field is dropped at parse
    # time and shown only as a length in the layout check.
    loaded: tuple[int, ...]
    names: tuple[str, ...]

    @property
    def url(self) -> str:
        return BASE_URL + self.filename


REVOCATION = ListSpec(
    key="revocation",
    dataset="irs_auto_revocation",
    filename="data-download-revocation.zip",
    n_fields=12,
    label="Automatic Revocation of Exemption List",
    loaded=(0, 1, 8, 9, 10, 11),
    names=("ein", "legal_name", "dba_name", "street", "city", "state", "zip", "country",
           "exemption_type", "revocation_date", "posting_date", "reinstatement_date"),
)
PUB78 = ListSpec(
    key="pub78",
    dataset="irs_pub78",
    filename="data-download-pub78.zip",
    n_fields=6,
    label="Publication 78 data",
    loaded=(0, 5),
    names=("ein", "legal_name", "city", "state", "country", "deductibility_codes"),
)
SPECS: dict[str, ListSpec] = {REVOCATION.key: REVOCATION, PUB78.key: PUB78}
ONLY_CHOICES = tuple(SPECS)


class LayoutError(RuntimeError):
    """The file does not look like the layout this loader was written for."""


@dataclass
class ParseStats:
    lines: int = 0
    blank_lines: int = 0
    non_data_lines: int = 0          # not blank, first field not all digits
    rows: int = 0                    # rows accepted for loading
    bad_field_count: int = 0
    bad_ein: int = 0                 # first field is digits but not nine of them
    duplicates: int = 0
    # revocation list only
    no_revocation_date: int = 0
    bad_posting_date: int = 0
    bad_reinstatement_date: int = 0
    reinstatement_before_revocation: int = 0
    window_2020: int = 0
    distinct_eins: int = 0
    latest_no_reinstatement_date: int = 0   # EINs whose latest row has a blank date
    latest_not_reinstated: int = 0          # ... or a date before the revocation date
    # Publication 78 only
    no_codes: int = 0
    code_counts: dict[str, int] = field(default_factory=dict)
    member: str = ""

    @property
    def skipped(self) -> int:
        return (self.bad_field_count + self.bad_ein + self.duplicates
                + self.no_revocation_date + self.no_codes)


def parse_irs_date(raw: str) -> date | None:
    """``15-NOV-2017`` -> date. Anything else -> None (never a guess)."""
    parts = raw.strip().upper().split("-")
    if len(parts) != 3:
        return None
    day, mon, year = parts
    month = _MONTHS.get(mon)
    if month is None or not (day.isdigit() and year.isdigit() and len(year) == 4):
        return None
    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


def parse_codes(raw: str) -> list[str]:
    """``PC,SOUNK`` -> ['PC', 'SOUNK'] (upper-cased, blanks dropped, order kept)."""
    out: list[str] = []
    for part in raw.split(","):
        code = part.strip().upper()
        if code and code not in out:
            out.append(code)
    return out


# ---------------------------------------------------------------------------
# Reading the zip
# ---------------------------------------------------------------------------
def _open_member(path: Path) -> tuple[zipfile.ZipFile, io.TextIOWrapper, str]:
    """Open the one text member of the zip, straight from the archive."""
    zf = zipfile.ZipFile(path)
    members = [i for i in zf.infolist() if not i.is_dir()]
    if not members:
        zf.close()
        raise LayoutError(f"{path.name}: the zip holds no file")
    info = max(members, key=lambda i: i.file_size)
    fh = io.TextIOWrapper(zf.open(info), encoding="utf-8", errors="replace", newline="")
    return zf, fh, info.filename


def _masked(spec: ListSpec, fields: list[str]) -> str:
    """One data line for the eye: loaded fields in full, the rest as lengths."""
    parts = []
    for i, value in enumerate(fields):
        name = spec.names[i] if i < len(spec.names) else "extra"
        if i in spec.loaded:
            parts.append(f"[{i}] {name}={value!r}")
        else:
            parts.append(f"[{i}] {name}=<not loaded, {len(value)} chars>")
    return "  ".join(parts)


def _check_first_rows(spec: ListSpec, rows: list[list[str]], echo) -> None:
    """Print and check the first three DATA lines. Stops the run when the
    layout moved, before any row is counted or loaded."""
    echo(f"  {spec.label}: first {len(rows)} data lines "
         f"(expect {spec.n_fields} pipe fields each)")
    for fields in rows:
        echo("    " + _masked(spec, fields))
    for n, fields in enumerate(rows, 1):
        if len(fields) != spec.n_fields:
            raise LayoutError(
                f"{spec.filename}: data line {n} has {len(fields)} fields, expected "
                f"{spec.n_fields}. The IRS changed the layout; nothing was loaded.")
        if len(fields[0].strip()) != 9:
            raise LayoutError(
                f"{spec.filename}: data line {n} has an EIN that is not nine digits. "
                "Nothing was loaded.")
        if spec is REVOCATION and parse_irs_date(fields[9]) is None:
            raise LayoutError(
                f"{spec.filename}: data line {n} field [9] is {fields[9]!r}, not a date "
                "like 15-NOV-2017. The IRS changed the layout; nothing was loaded.")
        if spec is PUB78 and not parse_codes(fields[5]):
            raise LayoutError(
                f"{spec.filename}: data line {n} field [5] carries no deductibility "
                "code. The IRS changed the layout; nothing was loaded.")


def _data_lines(spec: ListSpec, path: Path, stats: ParseStats, echo) -> Iterator[list[str]]:
    """Yield the pipe fields of every data line, after the three-line check."""
    zf, fh, member = _open_member(path)
    stats.member = member
    try:
        head: list[list[str]] = []
        checked = False
        for raw in fh:
            stats.lines += 1
            line = raw.rstrip("\r\n")
            if not line.strip():
                stats.blank_lines += 1
                continue
            fields = line.split("|")
            if not fields[0].strip().isdigit():
                stats.non_data_lines += 1
                continue
            if not checked:
                head.append(fields)
                if len(head) < 3:
                    continue
                _check_first_rows(spec, head, echo)
                checked = True
                yield from head
                continue
            yield fields
        if not checked:
            # Fewer than three data lines: check what there is, then stop if
            # the file is empty (an empty list must never replace a full one).
            if not head:
                raise LayoutError(f"{spec.filename}: no data line found. Nothing was loaded.")
            _check_first_rows(spec, head, echo)
            yield from head
    finally:
        fh.close()
        zf.close()


def parse_revocations(path: Path, stats: ParseStats, echo=print) -> Iterator[tuple]:
    """Yield (ein, revocation_date, legal_name, exemption_type, posting_date,
    reinstatement_date) for every loadable row. Allow-listed fields only."""
    # ein -> packed (revocation ordinal, reinstatement ordinal) of its LATEST row
    latest: dict[int, int] = {}
    # ein -> every revocation ordinal seen, kept only for EINs with 2+ rows
    multi: dict[int, set[int]] = {}
    shift = 1 << 20  # date ordinals stay below 2**20 until the year 2871
    for f in _data_lines(REVOCATION, path, stats, echo):
        if len(f) != REVOCATION.n_fields:
            stats.bad_field_count += 1
            continue
        ein = f[0].strip()
        if len(ein) != 9:
            stats.bad_ein += 1
            continue
        revoked = parse_irs_date(f[9])
        if revoked is None:
            stats.no_revocation_date += 1
            continue
        posted = parse_irs_date(f[10])
        if posted is None and f[10].strip():
            stats.bad_posting_date += 1
        reinstated = parse_irs_date(f[11])
        if reinstated is None and f[11].strip():
            stats.bad_reinstatement_date += 1

        key, rev_ord = int(ein), revoked.toordinal()
        packed = rev_ord * shift + (reinstated.toordinal() if reinstated else 0)
        prior = latest.get(key)
        if prior is None:
            latest[key] = packed
        else:
            seen = multi.setdefault(key, {prior // shift})
            if rev_ord in seen:
                stats.duplicates += 1
                continue
            seen.add(rev_ord)
            if rev_ord > prior // shift:
                latest[key] = packed

        if reinstated is not None and reinstated < revoked:
            stats.reinstatement_before_revocation += 1
        if WINDOW_2020[0] <= revoked <= WINDOW_2020[1]:
            stats.window_2020 += 1
        stats.rows += 1
        yield (ein, revoked, f[1].strip() or None, f[8].strip() or None, posted, reinstated)

    stats.distinct_eins = len(latest)
    for packed in latest.values():
        rev_ord, re_ord = divmod(packed, shift)
        if re_ord == 0:
            stats.latest_no_reinstatement_date += 1
            stats.latest_not_reinstated += 1
        elif re_ord < rev_ord:
            stats.latest_not_reinstated += 1


def parse_pub78(path: Path, stats: ParseStats, echo=print) -> Iterator[tuple]:
    """Yield (ein, deductibility_codes) for every loadable row."""
    seen: set[int] = set()
    for f in _data_lines(PUB78, path, stats, echo):
        if len(f) != PUB78.n_fields:
            stats.bad_field_count += 1
            continue
        ein = f[0].strip()
        if len(ein) != 9:
            stats.bad_ein += 1
            continue
        codes = parse_codes(f[5])
        if not codes:
            stats.no_codes += 1
            continue
        key = int(ein)
        if key in seen:
            stats.duplicates += 1
            continue
        seen.add(key)
        for code in codes:
            stats.code_counts[code] = stats.code_counts.get(code, 0) + 1
        stats.rows += 1
        yield (ein, codes)
    stats.distinct_eins = len(seen)


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------
def _selected(only: str | None) -> list[ListSpec]:
    if only is None:
        return [REVOCATION, PUB78]
    if only not in SPECS:
        raise ValueError(f"--only must be one of {', '.join(ONLY_CHOICES)} (got {only!r})")
    return [SPECS[only]]


def stage_one(spec: ListSpec, refresh: bool = False) -> staging.StagedFile:
    return staging.stage_download(spec.dataset, spec.url, mutable=True,
                                  refresh=refresh, max_age=MAX_AGE)


def _describe(spec: ListSpec, staged: staging.StagedFile, echo) -> None:
    dated = (f"IRS file date {staged.source_last_modified.date()}"
             if staged.source_last_modified else
             f"no IRS file date; retrieved {staged.vintage_date}")
    echo(f"{spec.label} [{spec.dataset}]")
    echo(f"  {spec.url}")
    echo(f"  {staged.byte_size:,} bytes  sha256 {staged.sha256}  {dated}"
         f"{'  (cached)' if staged.from_cache else '  (downloaded)'}")


def _echo_stats(spec: ListSpec, s: ParseStats, echo) -> None:
    echo(f"  member {s.member}: {s.lines:,} lines "
         f"({s.blank_lines:,} blank, {s.non_data_lines:,} other non-data)")
    if spec is REVOCATION:
        echo(f"  revocation rows: {s.rows:,}")
        echo(f"  distinct EINs: {s.distinct_eins:,}")
        echo(f"  EINs whose latest row has no reinstatement date: "
             f"{s.latest_no_reinstatement_date:,}")
        echo(f"  EINs whose latest row is not reinstated "
             f"(no date, or a date before the revocation date): {s.latest_not_reinstated:,}")
        echo(f"  rows with a reinstatement date before the revocation date: "
             f"{s.reinstatement_before_revocation:,}")
        echo(f"  rows with a listed revocation date from 2020-04-01 to 2020-07-14 "
             f"(read as 2020-07-15): {s.window_2020:,}")
        echo(f"  skipped: {s.skipped:,} (no revocation date {s.no_revocation_date:,}, "
             f"wrong field count {s.bad_field_count:,}, EIN not nine digits {s.bad_ein:,}, "
             f"duplicate key {s.duplicates:,})")
        echo(f"  dates set to NULL: posting {s.bad_posting_date:,}, "
             f"reinstatement {s.bad_reinstatement_date:,}")
    else:
        echo(f"  Publication 78 EINs: {s.rows:,}")
        codes = ", ".join(f"{c} {n:,}" for c, n in
                          sorted(s.code_counts.items(), key=lambda kv: (-kv[1], kv[0])))
        echo(f"  deductibility codes: {codes}")
        echo(f"  skipped: {s.skipped:,} (no code {s.no_codes:,}, "
             f"wrong field count {s.bad_field_count:,}, EIN not nine digits {s.bad_ein:,}, "
             f"duplicate EIN {s.duplicates:,})")


# ---------------------------------------------------------------------------
# Dry run (no database)
# ---------------------------------------------------------------------------
def dry_run(only: str | None = None, refresh: bool = False, echo=print) -> dict[str, dict]:
    """Download (or reuse) both zips, hash them, parse and count. No database."""
    out: dict[str, dict] = {}
    for spec in _selected(only):
        staged = stage_one(spec, refresh=refresh)
        _describe(spec, staged, echo)
        stats = ParseStats()
        parser = parse_revocations if spec is REVOCATION else parse_pub78
        for _ in parser(staged.path, stats, echo):
            pass
        _echo_stats(spec, stats, echo)
        out[spec.key] = {"rows": stats.rows, "distinct_eins": stats.distinct_eins,
                         "skipped": stats.skipped, "sha256": staged.sha256,
                         "vintage": str(staged.vintage_date)}
    echo("dry-run: nothing was written to the database.")
    return out


# ---------------------------------------------------------------------------
# Load (full snapshot per list, one transaction each)
# ---------------------------------------------------------------------------
_REV_STAGE_DDL = """
create temp table _irs_rev_stage (
  ein                text not null,
  revocation_date    date not null,
  legal_name         text,
  exemption_type     text,
  posting_date       date,
  reinstatement_date date
) on commit drop
"""

# The WHERE on DO UPDATE leaves an identical row untouched, so loading the
# same file twice rewrites nothing.
_REV_UPSERT = """
with up as (
  insert into internal.irs_revocations as t
    (ein, revocation_date, legal_name, exemption_type, posting_date, reinstatement_date,
     raw_file_id, source_record_locator)
  select s.ein, s.revocation_date, s.legal_name, s.exemption_type, s.posting_date,
         s.reinstatement_date, %(rfid)s,
         'row:EIN=' || s.ein || ';rev=' || to_char(s.revocation_date, 'YYYY-MM-DD')
  from _irs_rev_stage s
  on conflict (ein, revocation_date) do update set
    legal_name         = excluded.legal_name,
    exemption_type     = excluded.exemption_type,
    posting_date       = excluded.posting_date,
    reinstatement_date = excluded.reinstatement_date,
    raw_file_id        = excluded.raw_file_id,
    source_record_locator = excluded.source_record_locator
  where (t.legal_name, t.exemption_type, t.posting_date, t.reinstatement_date, t.raw_file_id)
        is distinct from
        (excluded.legal_name, excluded.exemption_type, excluded.posting_date,
         excluded.reinstatement_date, excluded.raw_file_id)
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted), count(*) filter (where not inserted) from up
"""

_PUB78_STAGE_DDL = """
create temp table _irs_pub78_stage (
  ein                 text not null,
  deductibility_codes text[] not null
) on commit drop
"""

_PUB78_UPSERT = """
with up as (
  insert into internal.irs_pub78 as t
    (ein, deductibility_codes, raw_file_id, source_record_locator)
  select s.ein, s.deductibility_codes, %(rfid)s, 'row:EIN=' || s.ein
  from _irs_pub78_stage s
  on conflict (ein) do update set
    deductibility_codes   = excluded.deductibility_codes,
    raw_file_id           = excluded.raw_file_id,
    source_record_locator = excluded.source_record_locator
  where (t.deductibility_codes, t.raw_file_id)
        is distinct from (excluded.deductibility_codes, excluded.raw_file_id)
  returning (xmax = 0) as inserted
)
select count(*) filter (where inserted), count(*) filter (where not inserted) from up
"""

_SNAPSHOT_UPSERT = """
insert into internal.irs_list_snapshots (dataset_name, raw_file_id, row_count, loaded_at)
values (%(dataset)s, %(rfid)s, %(rows)s, now())
on conflict (dataset_name) do update set
  raw_file_id = excluded.raw_file_id,
  row_count   = excluded.row_count,
  loaded_at   = excluded.loaded_at
"""


_SNAPSHOT_ROWS = "select row_count from internal.irs_list_snapshots where dataset_name = %s"


def _load_one(conn, spec: ListSpec, staged: staging.StagedFile, raw_file_id: int,
              echo, allow_shrink: bool = False) -> tuple[ParseStats, dict[str, int]]:
    stats = ParseStats()
    if spec is REVOCATION:
        table, stage, ddl, upsert = ("internal.irs_revocations", "_irs_rev_stage",
                                     _REV_STAGE_DDL, _REV_UPSERT)
        columns = ("ein, revocation_date, legal_name, exemption_type, "
                   "posting_date, reinstatement_date")
        rows = parse_revocations(staged.path, stats, echo)
    else:
        table, stage, ddl, upsert = ("internal.irs_pub78", "_irs_pub78_stage",
                                     _PUB78_STAGE_DDL, _PUB78_UPSERT)
        columns = "ein, deductibility_codes"
        rows = parse_pub78(staged.path, stats, echo)

    params = {"rfid": raw_file_id, "dataset": spec.dataset}
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute(ddl)
        with cur.copy(f"copy {stage} ({columns}) from stdin") as copy:
            for row in rows:
                copy.write_row(row)
        if stats.rows == 0:
            raise LayoutError(f"{spec.filename}: no loadable row. Nothing was loaded.")
        cur.execute(_SNAPSHOT_ROWS, (spec.dataset,))
        prior = cur.fetchone()
        if prior and not allow_shrink and stats.rows < prior[0] * MIN_ROW_SHARE:
            raise LayoutError(
                f"{spec.filename}: the file holds {stats.rows:,} rows but the list now loaded "
                f"holds {prior[0]:,}. A drop this large looks like a cut-off file, so nothing "
                "was loaded. Check the file, then use --refresh for a new copy or "
                "--allow-shrink to load it as it is.")
        cur.execute(upsert, params)
        inserted, updated = cur.fetchone()
        # Full snapshot: a row the new file no longer carries goes away in
        # the same transaction, so a reader never sees a mix of two files.
        cur.execute(f"delete from {table} where raw_file_id <> %(rfid)s", params)
        removed = cur.rowcount
        cur.execute(_SNAPSHOT_UPSERT, {**params, "rows": stats.rows})
    conn.commit()
    return stats, {"inserted": inserted, "updated": updated, "removed": removed,
                   "unchanged": stats.rows - inserted - updated}


def ingest(only: str | None = None, refresh: bool = False, allow_shrink: bool = False,
           echo=print) -> dict[str, dict]:
    """Stage, register and load each list. One transaction per list."""
    results: dict[str, dict] = {}
    with connect() as conn:
        for spec in _selected(only):
            staged = stage_one(spec, refresh=refresh)
            _describe(spec, staged, echo)
            raw_file_id = staging.register_raw_file(
                conn, staged, license_code=LICENSE_CODE, content_type="application/zip",
                meta={"documentation": BULK_PAGE, "list": spec.label},
            )
            conn.commit()
            run_id = ledger.start_run(conn, raw_file_id, spec.dataset)
            try:
                stats, n = _load_one(conn, spec, staged, raw_file_id, echo,
                                     allow_shrink=allow_shrink)
                ledger.complete_run(
                    conn, run_id, inserted=n["inserted"], updated=n["updated"],
                    skipped=stats.skipped,
                    notes=f"{spec.filename}: full snapshot of {stats.rows:,} rows "
                          f"({n['unchanged']:,} unchanged, {n['removed']:,} removed; "
                          f"vintage {staged.vintage_date}, "
                          f"{'cached' if staged.from_cache else 'fetched'})",
                )
            except Exception as exc:
                # The connection may already be dead; never let cleanup mask
                # the original error.
                try:
                    conn.rollback()
                    ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                except Exception:
                    pass
                raise
            _echo_stats(spec, stats, echo)
            echo(f"  loaded: inserted={n['inserted']:,} updated={n['updated']:,} "
                 f"unchanged={n['unchanged']:,} removed={n['removed']:,}  "
                 f"vintage={staged.vintage_date}")
            results[spec.key] = {**n, "rows": stats.rows, "skipped": stats.skipped,
                                 "vintage": str(staged.vintage_date),
                                 "from_cache": staged.from_cache}
    return results


# ---------------------------------------------------------------------------
# Report (read-only)
# ---------------------------------------------------------------------------
_REPORT_SNAPSHOTS = """
select s.dataset_name, s.row_count, s.loaded_at,
       (coalesce(rf.source_last_modified, rf.fetched_at) at time zone 'UTC')::date as as_of,
       rf.source_last_modified is not null as irs_dated, rf.sha256
from internal.irs_list_snapshots s
join internal.raw_files rf on rf.id = s.raw_file_id
order by s.dataset_name
"""

_REPORT_STANDING = """
select s.standing, count(*) as n
from internal.org_irs_standing s
where s.org_type = 'private_foundation'
group by s.standing
order by count(*) desc
"""

_REPORT_REVOKED_OPEN = """
select count(*)
from internal.org_irs_standing s
join internal.mv_org_application_posture ap on ap.org_id = s.org_id
where s.org_type = 'private_foundation'
  and s.standing = 'revoked'
  and ap.application_posture = 'open'
"""

_REPORT_SAMPLE = """
select s.org_id, s.ein, s.revocation_date, s.effective_revocation_date
from internal.org_irs_standing s
join internal.mv_org_application_posture ap on ap.org_id = s.org_id
where s.org_type = 'private_foundation'
  and s.standing = 'revoked'
  and ap.application_posture = 'open'
order by s.revocation_date desc, s.org_id
limit 3
"""


def report(echo=print) -> dict:
    """Counts per standing for private foundations, and how many foundations
    are automatically revoked while their latest return says they accept
    applications. Read-only."""
    out: dict = {"standing": {}, "snapshots": {}}
    with connect() as conn:
        conn.read_only = True
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '10min'")
            for guard in _MEMORY_GUARDS:
                cur.execute(guard)
            cur.execute(_REPORT_SNAPSHOTS)
            snapshots = cur.fetchall()
            echo("IRS lists loaded")
            if not snapshots:
                echo("  none. Run `funderdb ingest irs-standing` first.")
            for dataset, n, loaded_at, as_of, irs_dated, sha in snapshots:
                out["snapshots"][dataset] = {"rows": n, "as_of": str(as_of)}
                echo(f"  {dataset:<20} {n:>10,} rows  "
                     f"{'IRS file date' if irs_dated else 'retrieved'} {as_of}  "
                     f"loaded {loaded_at:%Y-%m-%d %H:%M} UTC  sha256 {sha[:12]}")
            if len(snapshots) < 2:
                echo("  Standing is NULL for every organization until BOTH lists are loaded.")

            cur.execute(_REPORT_STANDING)
            rows = cur.fetchall()
            total = sum(n for _, n in rows)
            echo("")
            echo("Private foundations by IRS standing")
            for standing, n in rows:
                out["standing"][standing or "(lists not loaded)"] = n
                echo(f"  {standing or '(lists not loaded)':<24} {n:>10,}")
            echo(f"  {'TOTAL':<24} {total:>10,}")

            cur.execute(_REPORT_REVOKED_OPEN)
            revoked_open = cur.fetchone()[0]
            out["revoked_and_open"] = revoked_open
            echo("")
            echo(f"Automatically revoked foundations whose latest return says "
                 f"they accept applications: {revoked_open:,}")
            cur.execute(_REPORT_SAMPLE)
            for org_id, ein, revoked, effective in cur.fetchall():
                echo(f"  example: org {org_id}  EIN {ein}  revocation date {revoked}"
                     f"{'' if effective == revoked else f' (read as {effective})'}")
        conn.rollback()
    return out
