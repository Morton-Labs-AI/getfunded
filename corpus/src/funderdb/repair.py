"""Repairs: fill a value that an older version of a parser left empty.

`funderdb repair qualifying-distributions`
------------------------------------------
The hole. Part XII of Form 990-PF ("Qualifying Distributions") is the group
QualifyingDistriPartXIIGrp in return versions before 2021v4.0 and
PFQualifyingDistributionsGrp after. The parser knew only the new name until
`_GROUP_ALIASES` was added to sources/irs_990pf.py. Every return of version
2018v3.x, 2019v5.x or 2020v4.x that was loaded before that has
internal.filing_financials.qualifying_distributions empty. New loads are
right. The rows already in the table are not, and no loader goes back to a
filing whose markers are set.

The repair, zip by zip:

    read the affected rows from the database (one read-only statement)
    group them by the zip their numbers were parsed from
    for each zip
        skip it if the ledger says this repair already finished it
        use a local copy when there is one (the staging folder first, then
          each --also-look-in folder, which is only ever read)
        otherwise download it (resume + sha256, through funderdb.staging),
          after a refusal check against --min-free-gb
        stop if the bytes are not the bytes the rows were parsed from
        register the zip in raw_files, as every loader does
        read ONLY the affected members, parse Part XII with the loader's own
          parser, and fill the column where it is still empty
        write one "repair:" ledger row with the counts
        with --discard-zips: delete the zip if this command downloaded it

Which zip holds a return. The row says so: filing_financials.raw_file_id is
the zip the numbers were parsed from, and raw_files keeps its source URL,
size and sha256. That is exact, so nothing is probed and no index CSV is
read. (The ingest loaders have to offer every filing of a year to every zip
of that year, because a pre-2024 index names no zip. Here the question is
already answered by provenance.) The download uses the registered source
URL; when a row has none, the URL is built by irs_990pf.batch_url, the
function the loaders use.

Why the sha256 must match. The repair does not change raw_file_id or the
record locator of a row, so the zip it reads must be the same bytes the row
already points at. A local copy or a download with another sha256 is not
used: the zip is reported and its rows stay empty.

What is never done. A value that is not empty is never changed (the UPDATE
itself checks `is null`). A return whose XML has no Part XII amount stays
empty: missing is not zero. Nothing in an --also-look-in folder is written,
renamed or deleted. A zip that was on disk before this command ran is never
deleted.

Idempotent and resumable. A filled row leaves the affected set, so a second
run does not read it again. A zip whose rows could not all be filled (the
XML has no amount) is remembered by its ledger row, so a second run does not
open or download it again. A run that stops in the middle of a zip writes no
"completed" row; the next run does that zip again and reads only the rows
that are still empty.

After a repair run `funderdb refresh-views`: the app reads the newest
financials of each funder from a materialized view.
"""

from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx
import psycopg
from lxml import etree

from . import backfill as bf
from . import ledger, staging
from .config import get_settings
from .sources import irs_990pf
from .sources.irs_990pf import NS, PfFiling

DATASET = irs_990pf.DATASET

# Return versions whose Part XII group has the old name (see _GROUP_ALIASES in
# sources/irs_990pf.py). Matched as a prefix of filings.return_version.
AFFECTED_VERSIONS = ("2018v3", "2019v5", "2020v4")

# Object-id years (first four digits of the object id) of the returns that
# were loaded before the fix. Returns of the same versions with an older
# object id were loaded after it, by `funderdb backfill`; an empty value on
# those means the return has no Part XII amount.
DEFAULT_YEARS = (2021, 2022, 2023)

# The columns the renamed group feeds. Read from the parser's own tables, so
# a column added under the same group is repaired too. Today it is one:
# qualifying_distributions.
REPAIR_COLUMNS = tuple(col for col, group, _ in irs_990pf.FIN_FIELDS
                       if group in irs_990pf._GROUP_ALIASES)

# Every finished zip gets one ledger row whose notes start with this mark.
LEDGER_MARK = "repair:qualifying-distributions"

BATCH = bf.CHUNK            # rows per UPDATE transaction, the loaders' size
_INT8_MAX = 2**63 - 1       # the columns are bigint
_MINE = "downloaded_by"     # sidecar key: this command downloaded the zip

_AFFECTED = f"""
    from internal.filing_financials ff
    join internal.filings f on f.object_id = ff.object_id
    where f.return_type = '990PF'
      and ({" or ".join(f"ff.{c} is null" for c in REPAIR_COLUMNS)})
      and f.return_version like any(%(versions)s::text[])
      and left(ff.object_id, 4) = any(%(years)s::text[])
"""

_UPDATE = f"""
    update internal.filing_financials ff
    set {", ".join(f"{c} = coalesce(ff.{c}, s.{c})" for c in REPAIR_COLUMNS)}
    from unnest(%s::text[], {", ".join("%s::bigint[]" for _ in REPAIR_COLUMNS)})
         as s(object_id, {", ".join(REPAIR_COLUMNS)})
    where ff.object_id = s.object_id
      and ({" or ".join(f"(ff.{c} is null and s.{c} is not null)" for c in REPAIR_COLUMNS)})
"""


class ZipUnavailable(Exception):
    """The zip cannot be used: not on the host, or not the registered bytes."""


def _say(msg: str = "") -> None:
    print(msg, flush=True)


def _version_prefix(version: str | None) -> str:
    for p in AFFECTED_VERSIONS:
        if (version or "").startswith(p):
            return p
    return version or "?"


# ---------------------------------------------------------------------------
# The affected rows, and the zips they were parsed from
# ---------------------------------------------------------------------------
def _params(years: tuple[int, ...]) -> dict:
    return {"versions": [v + "%" for v in AFFECTED_VERSIONS],
            "years": [str(y) for y in years]}


def count_affected(conn, years: tuple[int, ...]) -> dict[int, dict[str, int]]:
    """raw_file_id -> {return version: affected returns}. For the plan: one
    read-only statement, and only a few dozen rows come back."""
    out: dict[int, dict[str, int]] = defaultdict(dict)
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '10min'")
        cur.execute("select ff.raw_file_id, f.return_version, count(*)" + _AFFECTED
                    + " group by 1, 2", _params(years))
        for raw_file_id, version, n in cur.fetchall():
            out[int(raw_file_id)][version or "?"] = int(n)
    conn.rollback()
    return dict(out)


def find_affected(conn, years: tuple[int, ...]) -> dict[int, list[tuple[str, str]]]:
    """raw_file_id -> [(object_id, return version)]. The one read-only
    statement the run is built on."""
    out: dict[int, list[tuple[str, str]]] = defaultdict(list)
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '10min'")
        cur.execute("select ff.object_id, f.return_version, ff.raw_file_id" + _AFFECTED,
                    _params(years))
        for object_id, version, raw_file_id in cur.fetchall():
            out[int(raw_file_id)].append((object_id, version or "?"))
    conn.rollback()
    return dict(out)


def raw_file_rows(conn, ids: list[int]) -> tuple[dict[int, tuple], bool]:
    """id -> (sha256, source_url, storage_path, byte_size), and whether the
    role could read the last three. The web app's role may read only
    (id, sha256) of raw_files; a plan made with it finds names and sizes on
    disk instead (see _from_disk)."""
    try:
        with conn.cursor() as cur:
            cur.execute("select id, sha256, source_url, storage_path, byte_size "
                        "from internal.raw_files where id = any(%s::bigint[])", (ids,))
            rows = {int(r[0]): (r[1], r[2], r[3], r[4]) for r in cur.fetchall()}
        conn.rollback()
        return rows, True
    except psycopg.errors.InsufficientPrivilege:
        conn.rollback()
    with conn.cursor() as cur:
        cur.execute("select id, sha256 from internal.raw_files where id = any(%s::bigint[])",
                    (ids,))
        rows = {int(r[0]): (r[1], None, None, None) for r in cur.fetchall()}
    conn.rollback()
    return rows, False


def _stem(text: str | None) -> str | None:
    """'https://.../2021/2021_TEOS_XML_01A.zip' or
    'data/raw/irs_990_xml/58b8a701ff7d_2021_TEOS_XML_01A.zip' -> the zip stem."""
    base = (text or "").rsplit("/", 1)[-1]
    if not base.lower().endswith(".zip"):
        return None
    return bf._HASH_PREFIX.sub("", base)[:-4] or None


def _folders(also: tuple[Path, ...]) -> list[tuple[Path, str]]:
    """Where a local copy may be: the staging folder first, then the extras."""
    own = get_settings().raw_dir / DATASET
    return [(own, "staged")] + [(Path(d), "also-look-in") for d in also]


def _from_disk(sha256: str, also: tuple[Path, ...]) -> tuple[str | None, str | None, int | None]:
    """(zip stem, source URL, bytes) of a zip known only by its sha256: from
    a staged file whose name starts with the hash, else from a staging
    manifest (manifest.jsonl keeps a line for every file that was ever
    staged in a folder, also for files that were deleted since)."""
    folders = [f for f, _ in _folders(also) if f.is_dir()]
    for folder in folders:
        for path in sorted(folder.glob(f"{sha256[:12]}_*.zip")):
            return _stem(path.name), None, path.stat().st_size
    for folder in folders:
        manifest = folder / "manifest.jsonl"
        if not manifest.is_file():
            continue
        for line in manifest.read_text(encoding="utf-8", errors="replace").splitlines():
            try:
                entry = json.loads(line)
            except ValueError:
                continue
            if entry.get("sha256") == sha256 and _stem(entry.get("file")):
                return _stem(entry["file"]), entry.get("url"), entry.get("bytes")
    return None, None, None


@dataclass
class ZipPlan:
    raw_file_id: int
    sha256: str
    name: str | None          # zip stem as the IRS host spells it; None = not known
    url: str | None
    size: int | None          # bytes
    size_from: str            # 'raw_files' | 'local file' | 'manifest' | 'HEAD' | 'unknown'
    by_version: dict[str, int] = field(default_factory=dict)
    object_ids: list[str] = field(default_factory=list)   # run only
    on_host: bool | None = None                           # HEAD answer; None = not asked

    @property
    def affected(self) -> int:
        return sum(self.by_version.values())

    @property
    def label(self) -> str:
        return self.name or f"raw file {self.raw_file_id} (sha256 {self.sha256[:12]})"


def build_plan(conn, years: tuple[int, ...], also: tuple[Path, ...], *,
               with_ids: bool) -> tuple[list[ZipPlan], bool]:
    """The zips that hold affected returns, in name order. ``with_ids`` reads
    the object ids too (the run needs them; the plan only needs counts)."""
    ids_by_file: dict[int, list[tuple[str, str]]] = {}
    if with_ids:
        ids_by_file = find_affected(conn, years)
        counts: dict[int, dict[str, int]] = {}
        for rfid, rows in ids_by_file.items():
            per: dict[str, int] = defaultdict(int)
            for _oid, version in rows:
                per[version] += 1
            counts[rfid] = dict(per)
    else:
        counts = count_affected(conn, years)
    if not counts:
        return [], True
    files, full = raw_file_rows(conn, sorted(counts))
    plans: list[ZipPlan] = []
    for rfid, by_version in counts.items():
        sha256, source_url, storage_path, byte_size = files[rfid]
        name = _stem(source_url) or _stem(storage_path)
        url, size, size_from = source_url, byte_size, "raw_files"
        if name is None or size is None:
            d_name, d_url, d_size = _from_disk(sha256, also)
            if name is None:
                name, url = d_name, url or d_url
            if size is None and d_size is not None:
                size, size_from = int(d_size), "manifest" if d_url else "local file"
        if size is None:
            size_from = "unknown"
        if name and not url and irs_990pf.batch_year(name, 0):
            # No URL on record: build it the way the loaders do.
            url = irs_990pf.batch_url(name, irs_990pf.batch_year(name, 0))
        plans.append(ZipPlan(rfid, sha256, name, url, size, size_from, by_version,
                             sorted(o for o, _ in ids_by_file.get(rfid, ()))))
    plans.sort(key=lambda z: (z.name is None, irs_990pf.batch_year(z.name or "", 0),
                              z.name or "", z.raw_file_id))
    return plans, full


# ---------------------------------------------------------------------------
# Local copies, the ledger, the disk
# ---------------------------------------------------------------------------
def local_copy(z: ZipPlan, also: tuple[Path, ...]) -> tuple[Path | None, str]:
    """A copy of the zip on this machine, found by file name only: the name
    starts with the first 12 characters of the registered sha256. Nothing is
    hashed here; `obtain` hashes a copy before it is used."""
    if z.name is None:
        return None, "no"
    for folder, where in _folders(also):
        for path in reversed(staging.cached_candidates(folder, f"{z.name}.zip")):
            if path.name.startswith(z.sha256[:12] + "_"):
                return path, where
    return None, "no"


def _partial_bytes(z: ZipPlan) -> int:
    partial = get_settings().raw_dir / DATASET / f".partial_{z.name}.zip"
    return partial.stat().st_size if partial.exists() else 0


def still_to_download(z: ZipPlan, also: tuple[Path, ...]) -> int | None:
    """Bytes a download would add to the disk. 0 = a local copy exists."""
    if local_copy(z, also)[0] is not None:
        return 0
    return None if z.size is None else max(z.size - _partial_bytes(z), 0)


def completed_notes(conn, raw_file_ids: list[int]) -> dict[int, list[str]]:
    """raw_file_id -> notes of every completed repair ledger row for it."""
    out: dict[int, list[str]] = defaultdict(list)
    with conn.cursor() as cur:
        cur.execute(
            "select raw_file_id, notes from internal.ingestion_ledger "
            "where dataset_name = %s and status = 'completed' and notes like %s "
            "and raw_file_id = any(%s::bigint[])",
            (DATASET, LEDGER_MARK + "%", raw_file_ids),
        )
        for rfid, notes in cur.fetchall():
            out[int(rfid)].append(notes or "")
    conn.rollback()
    return dict(out)


def note_covers(note: str, years: tuple[int, ...], affected_now: int) -> bool:
    """Is this zip finished for this request? Yes when a completed run covered
    the same object-id years and the rows that are empty now are no more than
    the rows that run had to leave empty (the XML has no amount for them)."""
    y = re.search(r"years=([\d,]+);", note)
    left = re.search(r'"left_empty": (\d+)', note)
    if not y or not left:
        return False
    done = {int(p) for p in y.group(1).split(",") if p}
    return set(years) <= done and affected_now <= int(left.group(1))


def _complete(notes: dict[int, list[str]], z: ZipPlan, years: tuple[int, ...]) -> bool:
    return any(note_covers(n, years, z.affected) for n in notes.get(z.raw_file_id, ()))


def head_zip(client: httpx.Client, z: ZipPlan) -> None:
    """One HEAD request: is the zip on the host, and how big is it there."""
    time.sleep(bf._HEAD_PAUSE)
    try:
        resp = client.head(z.url)
    except httpx.HTTPError:
        return                       # not asked successfully: on_host stays None
    # The IRS host answers 302 -> error page for a zip that is gone.
    z.on_host = resp.status_code == 200
    length = resp.headers.get("Content-Length")
    if z.on_host and length and length.isdigit():
        if z.size is None:
            z.size, z.size_from = int(length), "HEAD"
        elif int(length) != z.size:
            z.on_host = False        # another file than the registered one


# ---------------------------------------------------------------------------
# Getting the zip
# ---------------------------------------------------------------------------
def _is_mine(path: Path) -> bool:
    return staging._read_sidecar(path).get(_MINE) == LEDGER_MARK


def _mark_mine(path: Path) -> None:
    """Note in the sidecar that this command downloaded the zip. A later run
    that finds the zip already staged then still knows it may discard it."""
    meta = staging._read_sidecar(path)
    if meta:
        meta[_MINE] = LEDGER_MARK
        staging._sidecar_path(path).write_text(json.dumps(meta, indent=2) + "\n",
                                                encoding="utf-8")


def obtain(z: ZipPlan, also: tuple[Path, ...]) -> tuple[staging.StagedFile, bool]:
    """The zip as a StagedFile, and whether this command downloaded it.

    1. A copy in the staging folder: funderdb.staging re-hashes it.
    2. A copy in an --also-look-in folder: hashed here and used in place.
       Nothing in that folder is written, renamed or deleted.
    3. Otherwise a download with resume and sha256 through funderdb.staging,
       after one HEAD request (the IRS host answers a missing zip with a
       redirect to an error page, which must not be staged as a zip).
    Raises ZipUnavailable when the bytes are not the registered ones."""
    filename = f"{z.name}.zip"
    staged = staging.newest_cached(DATASET, filename, z.url)
    if staged is None:
        for folder, _where in _folders(also)[1:]:
            for path in reversed(staging.cached_candidates(folder, filename)):
                if (path.name.startswith(z.sha256[:12] + "_")
                        and staging._sha256_of(path) == z.sha256):
                    return staging.staged_from_path(DATASET, path, z.url, sha256=z.sha256), False
        if not z.url:
            raise ZipUnavailable("no local copy and no source URL on record")
        with httpx.Client(headers={"User-Agent": get_settings().http_user_agent},
                          timeout=60.0, follow_redirects=False,
                          transport=staging._transport) as client:
            head_zip(client, z)
        if z.on_host is False:
            raise ZipUnavailable("the IRS host does not serve the registered file "
                                 "(missing, or another size)")
        staged = staging.stage_download(DATASET, z.url, filename=filename, timeout=600.0)
    downloaded = not staged.from_cache
    if downloaded:
        _mark_mine(staged.path)
    if staged.sha256 != z.sha256:
        if downloaded:
            # Our own download, and not the registered bytes: move it aside the
            # way funderdb.staging does, so no later run takes it for the zip.
            aside = staged.path.with_name(".corrupt_" + staged.path.name)
            staged.path.rename(aside)
            sidecar = staging._sidecar_path(staged.path)
            if sidecar.exists():
                sidecar.rename(aside.with_name(aside.name + ".meta.json"))
        raise ZipUnavailable(f"sha256 {staged.sha256[:12]} is not the registered "
                             f"{z.sha256[:12]}; the rows were parsed from other bytes")
    return staged, downloaded or _is_mine(staged.path)


def discard(conn, raw_file_id: int, staged: staging.StagedFile) -> None:
    """Delete a zip this command downloaded. The registry row keeps the
    sha256 and the source URL. Its `local_copy` note is updated only when the
    row points at this file or already carries such a note; a row that points
    at a copy somewhere else is left as it is."""
    now = datetime.now(timezone.utc).isoformat()
    note = {"local_copy": {
        "state": "discarded", "discarded_at": now,
        "reason": "funderdb repair qualifying-distributions --discard-zips",
        "refetch_url": staged.source_url, "sha256": staged.sha256,
        "byte_size": staged.byte_size}}
    with conn.cursor() as cur:
        cur.execute(
            "update internal.raw_files set meta = coalesce(meta, '{}'::jsonb) || %s::jsonb "
            "where id = %s and (storage_path = %s or meta ? 'local_copy')",
            (json.dumps(note), raw_file_id, str(staged.path)),
        )
    conn.commit()
    meta = staging._read_sidecar(staged.path)
    staged.path.unlink(missing_ok=True)
    if meta:
        meta["local_copy"] = {"state": "discarded", "discarded_at": now}
        staging._sidecar_path(staged.path).write_text(json.dumps(meta, indent=2) + "\n",
                                                       encoding="utf-8")


# ---------------------------------------------------------------------------
# Repairing one zip
# ---------------------------------------------------------------------------
def part_xii_values(data: bytes) -> dict[str, int | None] | None:
    """The repair columns of one return, read by the loader's own parser
    (irs_990pf._parse_financials, which knows both names of the group).
    None when the member is not a Form 990-PF."""
    root = etree.fromstring(data)
    ret = root.find(f"{NS}ReturnData")
    pf = ret.find(f"{NS}IRS990PF") if ret is not None else None
    if pf is None:
        return None
    fin = irs_990pf._parse_financials(pf)
    return {c: fin.get(c) for c in REPAIR_COLUMNS}


def apply_batch(conn, rows: list[tuple[str, dict[str, int | None]]]) -> int:
    """Fill the repair columns where they are still empty. One transaction.
    Returns the number of rows that changed. A value that is not empty is
    never changed: the statement itself checks `is null`."""
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.execute("set local statement_timeout = '30min'")
        cur.execute(_UPDATE, ([oid for oid, _ in rows],
                              *[[v[c] for _, v in rows] for c in REPAIR_COLUMNS]))
        changed = cur.rowcount
    conn.commit()
    return changed


def repair_zip(conn, path: Path, object_ids: list[str]) -> dict[str, int]:
    """Read only the affected members of one zip and fill their rows."""
    counts: dict[str, int] = defaultdict(int)
    counts["affected"] = len(object_ids)
    todo = [PfFiling(oid, "", "", "", "") for oid in object_ids]
    batch: list[tuple[str, dict[str, int | None]]] = []
    sent = 0

    def flush() -> None:
        nonlocal batch, sent
        counts["filled"] += apply_batch(conn, batch)
        sent += len(batch)
        batch = []

    for f, data in irs_990pf._iter_wanted_members(path, todo, counts):
        counts["members_read"] += 1
        try:
            values = part_xii_values(data)
        except etree.XMLSyntaxError:
            counts["xml_errors"] += 1
            continue
        if values is None:
            counts["not_form_990pf"] += 1
            continue
        for c, v in values.items():
            if v is not None and abs(v) > _INT8_MAX:
                values[c] = None          # cannot be a real amount; stays empty
                counts["out_of_range"] += 1
        if all(v is None for v in values.values()):
            counts["no_amount_in_xml"] += 1
            continue
        batch.append((f.object_id, values))
        if len(batch) >= BATCH:
            flush()
    flush()
    counts["not_in_zip"] = (counts["affected"] - counts["members_read"]
                            - counts.get("member_errors", 0))
    # Rows another session filled between the read and the write.
    counts["filled_meanwhile"] = sent - counts["filled"]
    counts["left_empty"] = counts["affected"] - sent
    return {k: v for k, v in counts.items() if v or k in ("affected", "filled", "left_empty")}


def _ledger_note(z: ZipPlan, years: tuple[int, ...], counts: dict) -> str:
    return (f"{LEDGER_MARK} zip={z.name}; years={','.join(str(y) for y in sorted(years))}; "
            f"columns={','.join(REPAIR_COLUMNS)}; " + json.dumps(dict(sorted(counts.items()))))


# ---------------------------------------------------------------------------
# The plan (dry run)
# ---------------------------------------------------------------------------
def print_plan(plans: list[ZipPlan], *, years: tuple[int, ...], also: tuple[Path, ...],
               min_free_gb: float, discard_zips: bool, limit_zips: int | None,
               notes: dict[int, list[str]] | None, ledger_state: str, names_from_db: bool,
               echo=_say) -> dict:
    free, where = bf.free_bytes()
    floor = min_free_gb * bf.GB
    by_version: dict[str, int] = defaultdict(int)
    for z in plans:
        for version, n in z.by_version.items():
            by_version[_version_prefix(version)] += n
    echo("Returns to repair: Form 990-PF rows with an empty "
         + ", ".join(REPAIR_COLUMNS))
    echo(f"  return versions: {', '.join(v + '.x' for v in AFFECTED_VERSIONS)}    "
         f"object-id years: {', '.join(str(y) for y in years)}")
    echo(f"  found: {sum(by_version.values()):,} returns in {len(plans)} zips"
         + ("  (" + ", ".join(f"{v}.x {n:,}" for v, n in sorted(by_version.items())) + ")"
            if by_version else ""))
    echo("zip names and sizes: "
         + ("from raw_files" if names_from_db else
            "this database role cannot read them from raw_files; taken from the staged "
            "files and staging manifests on disk, matched by sha256"))
    echo(f"ledger: {ledger_state}")
    echo(f"staging folder: {get_settings().raw_dir / DATASET}")
    for d in also:
        echo(f"also looked in (read only): {d}")
    echo(f"free disk under {where}: {bf._gb(free)}    --min-free-gb: {min_free_gb:g}")
    echo("")
    echo(f"{'zip':<22} {'size':>9} {'returns':>8}  {'local copy':<13} {'ledger':<9} "
         f"{'to download':>11} {'free after':>11}  start?")
    running = free
    stopped = False       # the real run stops at the first refusal
    started = 0
    t = {"zips": len(plans), "returns": 0, "bytes": 0, "local_zips": 0, "local_bytes": 0,
         "download_zips": 0, "download_bytes": 0, "largest_download": 0, "complete": 0,
         "returns_complete": 0, "refused": 0, "not_reached": 0, "unusable": 0,
         "returns_unusable": 0}
    for z in plans:
        path, where_local = local_copy(z, also)
        need = still_to_download(z, also)
        done = notes is not None and _complete(notes, z, years)
        state = "n/a" if notes is None else ("complete" if done else "pending")
        t["returns"] += z.affected
        t["bytes"] += z.size or 0
        if path is not None:
            t["local_zips"] += 1
            t["local_bytes"] += z.size or path.stat().st_size
        after = None
        if done:
            after = running
            t["complete"] += 1
            t["returns_complete"] += z.affected
            verdict, need_txt = "skip (complete: an earlier run could not fill these)", "-"
        elif z.name is None:
            t["unusable"] += 1
            t["returns_unusable"] += z.affected
            verdict, need_txt = "NO (zip name not known; use the pipeline connection)", "?"
        elif path is None and (not z.url or z.on_host is False):
            t["unusable"] += 1
            t["returns_unusable"] += z.affected
            verdict, need_txt = "NO (no local copy, and not on the IRS host)", "?"
        elif limit_zips is not None and started >= limit_zips:
            t["not_reached"] += 1
            verdict, need_txt = f"not reached (--limit-zips {limit_zips})", bf._gb(need)
        elif stopped:
            t["not_reached"] += 1
            verdict, need_txt = "not reached (the run stops at the first refusal)", bf._gb(need)
        elif need is None:
            t["refused"] += 1
            stopped = True
            verdict, need_txt = "NO (size unknown)", "?"
        else:
            need_txt = bf._gb(need)
            after = running - need
            if need and after < floor:
                t["refused"] += 1
                stopped = True
                after = None
                verdict = f"NO (would leave less than {min_free_gb:g} GB)"
            else:
                started += 1
                verdict = "yes"
                if need:
                    t["download_zips"] += 1
                    t["download_bytes"] += need
                    t["largest_download"] = max(t["largest_download"], need)
                    if not discard_zips:
                        running = after      # kept zips add up; discarded ones do not
                    else:
                        after = running      # back to this once the zip is deleted
        echo(f"{z.label:<22} {bf._gb(z.size):>9} {z.affected:>8,}  {where_local:<13} "
             f"{state:<9} {need_txt:>11} {bf._gb(after):>11}  {verdict}")
    echo("")
    echo(f"total: {t['zips']} zips, {bf._gb(t['bytes'])}, {t['returns']:,} returns")
    echo(f"on this machine already: {t['local_zips']} zips, {bf._gb(t['local_bytes'])} "
         "(found by file name; each one is hashed before it is used)")
    echo(f"to download: {t['download_zips']} zips, {bf._gb(t['download_bytes'])}"
         + (f"; largest single download: {bf._gb(t['largest_download'])}"
            if t["download_zips"] else ""))
    if t["download_zips"]:
        if discard_zips:
            echo("--discard-zips: each downloaded zip is deleted after its ledger row is "
                 "written, so the peak extra disk is one zip.")
        else:
            echo("Without --discard-zips every downloaded zip stays on disk.")
    if t["complete"]:
        echo(f"already complete: {t['complete']} zips ({t['returns_complete']:,} returns that "
             "an earlier run could not fill from the XML; they stay empty)")
    if t["unusable"]:
        echo(f"cannot be repaired as things stand: {t['unusable']} zips, "
             f"{t['returns_unusable']:,} returns")
    if t["refused"]:
        echo(f"As things stand the run would stop at the first refused zip; "
             f"{t['not_reached']} more zip(s) would not be reached.")
    echo("")
    echo("After the repair: uv run funderdb refresh-views   "
         "# the app reads each funder's newest financials from a materialized view")
    return t


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------
def run(years: tuple[int, ...] = DEFAULT_YEARS, *, also_look_in: tuple[Path, ...] = (),
        min_free_gb: float = 6.0, limit_zips: int | None = None,
        discard_zips: bool = False, dry_run: bool = False, resume: bool = True,
        prefetch: int = 0, echo=_say) -> dict:
    from .db import connect

    also = tuple(Path(d) for d in also_look_in)
    if not REPAIR_COLUMNS:
        raise RuntimeError("the parser lists no renamed group; there is nothing to repair")

    if dry_run:
        echo("Repair plan (dry run: nothing is downloaded, nothing is written)")
        with connect() as conn:
            conn.read_only = True
            plans, full = build_plan(conn, years, also, with_ids=False)
            notes: dict[int, list[str]] | None = None
            ledger_state = "not checked (--no-resume)"
            if resume and plans:
                try:
                    notes = completed_notes(conn, [z.raw_file_id for z in plans])
                    ledger_state = "checked (read only)"
                except psycopg.Error as exc:
                    # The web app's role cannot read the ledger. The plan is
                    # still right; it cannot say what an earlier run finished.
                    conn.rollback()
                    ledger_state = ("not checked (this database role cannot read the ledger: "
                                    f"{str(exc).strip().splitlines()[0]})")
        need_head = [z for z in plans if z.url and local_copy(z, also)[0] is None
                     and not (notes is not None and _complete(notes, z, years))]
        if need_head:
            with httpx.Client(headers={"User-Agent": get_settings().http_user_agent},
                              timeout=60.0, follow_redirects=False,
                              transport=staging._transport) as client:
                for z in need_head:
                    head_zip(client, z)
        totals = print_plan(plans, years=years, also=also, min_free_gb=min_free_gb,
                            discard_zips=discard_zips, limit_zips=limit_zips, notes=notes,
                            ledger_state=ledger_state, names_from_db=full, echo=echo)
        return {"dry_run": True, **totals}

    summary: dict = {"zips_done": 0, "zips_skipped": 0, "zips_unusable": 0,
                     "stopped": None, "rows": defaultdict(int)}
    floor = min_free_gb * bf.GB
    with connect() as conn:
        plans, _full = build_plan(conn, years, also, with_ids=True)
        notes = completed_notes(conn, [z.raw_file_id for z in plans]) if resume and plans else {}
        pending = [z for z in plans if not _complete(notes, z, years)]
        summary["zips_skipped"] = len(plans) - len(pending)
        echo(f"{sum(z.affected for z in plans):,} returns with an empty "
             f"{', '.join(REPAIR_COLUMNS)} in {len(plans)} zips; {len(pending)} zips to do, "
             f"{summary['zips_skipped']} already complete")

        # Download-ahead, the backfill's pattern: one worker thread gets the
        # next zips (one connection to the IRS host at a time) while this
        # thread repairs the current one.
        executor = ThreadPoolExecutor(max_workers=1) if prefetch > 0 else None
        futures: dict[int, Future] = {}

        def ensure_prefetch(i: int) -> None:
            if executor is None:
                return
            last = i + prefetch
            if limit_zips is not None:
                last = min(last, i + (limit_zips - summary["zips_done"]) - 1)
            for nxt in pending[i:last + 1]:
                if nxt.raw_file_id in futures or nxt.name is None:
                    continue
                need_nxt = still_to_download(nxt, also)
                queued = sum((still_to_download(q, also) or 0) for q in pending
                             if q.raw_file_id in futures and not futures[q.raw_file_id].done())
                free_now, _ = bf.free_bytes()
                if need_nxt is None or (need_nxt and free_now - queued - need_nxt < floor):
                    break
                futures[nxt.raw_file_id] = executor.submit(obtain, nxt, also)

        try:
            for i, z in enumerate(pending):
                if limit_zips is not None and summary["zips_done"] >= limit_zips:
                    summary["stopped"] = f"--limit-zips {limit_zips} reached"
                    break
                if z.name is None:
                    summary["zips_unusable"] += 1
                    echo(f"  {z.label}: its raw_files row names no zip; {z.affected:,} "
                         "returns left as they are")
                    continue
                need = still_to_download(z, also)
                free, where = bf.free_bytes()
                if need is None or (need and free - need < floor):
                    summary["stopped"] = "disk"
                    echo(f"  {z.name}: REFUSED. Free disk under {where} is {bf._gb(free)}; "
                         f"this download needs {bf._gb(need)} and --min-free-gb is "
                         f"{min_free_gb:g}. Free some space and run the same command again.")
                    break
                t0 = time.monotonic()
                ensure_prefetch(i)
                try:
                    fut = futures.get(z.raw_file_id)
                    staged, mine = fut.result() if fut is not None else obtain(z, also)
                except (ZipUnavailable, httpx.HTTPError) as exc:
                    # Nothing was read. The attempt is still worth a ledger
                    # row, on the raw file the rows point at.
                    reason = str(exc) if isinstance(exc, ZipUnavailable) else repr(exc)
                    run_id = ledger.start_run(conn, z.raw_file_id, DATASET)
                    ledger.fail_run(conn, run_id, f"{LEDGER_MARK} zip={z.name}; not repaired: "
                                                  f"{reason}")
                    summary["zips_unusable"] += 1
                    echo(f"  {z.name}: NOT REPAIRED, {reason}. {z.affected:,} returns left "
                         "as they are.")
                    continue
                # Same sha256 as the registered row (obtain checked it), so
                # this returns that row's id and only moves parsed_at.
                raw_file_id = staging.register_raw_file(
                    conn, staged, license_code="us_public_domain",
                    content_type="application/zip",
                )
                conn.commit()
                if not staged.from_cache:
                    bf._note_refetched(conn, raw_file_id)
                run_id = ledger.start_run(conn, raw_file_id, DATASET)
                try:
                    counts = repair_zip(conn, staged.path, z.object_ids)
                    ledger.complete_run(conn, run_id, updated=counts["filled"],
                                        skipped=counts["left_empty"],
                                        notes=_ledger_note(z, years, counts))
                except Exception as exc:
                    try:
                        conn.rollback()
                        ledger.fail_run(conn, run_id, f"{type(exc).__name__}: {exc}")
                    except Exception:
                        pass
                    raise
                summary["zips_done"] += 1
                for k, v in counts.items():
                    summary["rows"][k] += v
                source = ("downloaded" if not staged.from_cache
                          else "local copy" if staged.path.parent == get_settings().raw_dir / DATASET
                          else "local copy (also-look-in)")
                echo(f"  {z.name}: {source} {bf._gb(staged.byte_size)}, sha256 "
                     f"{staged.sha256[:12]} matches, {time.monotonic() - t0:.0f}s  "
                     f"{dict(sorted(counts.items()))}")
                if discard_zips and mine:
                    discard(conn, raw_file_id, staged)
                    echo(f"  {z.name}: downloaded copy deleted (raw_files row {raw_file_id} "
                         "keeps sha256 and source URL)")
        finally:
            if executor is not None:
                # A zip already downloading finishes (the next run reuses it);
                # queued ones that have not started are dropped.
                executor.shutdown(wait=True, cancel_futures=True)

    rows = summary["rows"] = dict(summary["rows"])
    echo(f"\nzips repaired: {summary['zips_done']}   already complete (skipped): "
         f"{summary['zips_skipped']}"
         + (f"   not usable: {summary['zips_unusable']}" if summary["zips_unusable"] else "")
         + (f"   stopped: {summary['stopped']}" if summary["stopped"] else ""))
    if summary["zips_done"]:
        echo(f"returns: {rows.get('affected', 0):,} were empty; {rows.get('filled', 0):,} "
             f"filled from Part XII; {rows.get('left_empty', 0):,} left empty "
             f"({rows.get('no_amount_in_xml', 0):,} because the return states no amount)")
        echo("Next: uv run funderdb refresh-views   "
             "# the app reads each funder's newest financials from a materialized view")
    return summary
