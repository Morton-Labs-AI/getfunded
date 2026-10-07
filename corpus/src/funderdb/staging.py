"""Hash-first raw-file staging.

Doctrine: file-first ingestion. Every input — bulk CSVs, XML zips, API pulls,
hand-curated seed CSVs — is staged to ``data/raw/<dataset>/<sha256[:12]>_<name>``
and registered in ``internal.raw_files`` before any parsing writes to the
database. No fact row exists without a hashed immutable artifact behind it.

Vintage handling (the "cached forever" fix)
-------------------------------------------
Two kinds of URL exist upstream and they must be cached differently:

* **Immutable** artifacts (an IRS batch zip, a Form D quarterly zip): the
  bytes behind the URL never change, so a cached copy is reused forever. The
  cached file's hash is re-verified against its own filename prefix on every
  reuse; a mismatch is quarantined (``.corrupt_<name>``) and re-downloaded.
* **Mutable** feeds (``eo1.csv``, the annual 990 index CSV, the SBIR award
  CSV, the daily ADV feed): the same URL serves new bytes over time. These
  are staged with ``mutable=True`` and carry a ``max_age``; past it (or on
  ``refresh=True``) we make a *conditional* request (``If-None-Match`` /
  ``If-Modified-Since``). A ``304`` or an identical hash keeps the cached
  file and only advances ``checked_at``; new bytes become a NEW staged file
  with its own hash prefix. The previous vintage stays on disk and stays
  registered — provenance never loses a file it once parsed.

Each staged file has a JSON sidecar (``<file>.meta.json``) recording three
timestamps that are kept apart on purpose:

* ``fetched_at``            — when *we* downloaded these bytes;
* ``source_last_modified``  — what the server said about the bytes (``Last-Modified``);
* ``checked_at``            — the last time upstream confirmed the bytes are still current.

``parsed_at`` (the fourth timestamp) lives only in ``internal.raw_files`` and
is set by ``register_raw_file`` on every ingest. Re-ingesting an old file
therefore advances ``parsed_at`` and nothing else; loaders stamp
``last_verified_at`` from :func:`verified_at` (the file's vintage), never from
``now()``, so a re-parse cannot make stale data look freshly verified.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import time
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import httpx
import psycopg

from .config import get_settings

_CHUNK = 1 << 20  # 1 MiB

# Tests swap this for an httpx.MockTransport; production leaves it None.
_transport: httpx.BaseTransport | None = None


@dataclass(frozen=True)
class StagedFile:
    dataset_name: str
    source_url: str | None
    path: Path
    sha256: str
    byte_size: int
    fetched_at: datetime | None = None
    source_last_modified: datetime | None = None
    etag: str | None = None
    checked_at: datetime | None = None
    from_cache: bool = False

    @property
    def vintage(self) -> datetime | None:
        """Best available "the source looked like this at" instant (UTC)."""
        return self.source_last_modified or self.fetched_at

    @property
    def vintage_date(self) -> date | None:
        v = self.vintage
        return v.date() if v else None


@dataclass(frozen=True)
class DownloadResult:
    status_code: int
    last_modified: datetime | None
    etag: str | None


def _now() -> datetime:
    # Full precision on purpose: two vintages staged seconds apart must still
    # order by time, never fall through to a name (= hash) tie-break.
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def parse_http_date(value: str | None) -> datetime | None:
    """RFC 7231 ``Last-Modified`` -> aware UTC datetime (None when absent/garbage)."""
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------------------
# Sidecar metadata
# ---------------------------------------------------------------------------
def _sidecar_path(path: Path) -> Path:
    return path.with_name(path.name + ".meta.json")


def _read_sidecar(path: Path) -> dict:
    sc = _sidecar_path(path)
    if not sc.exists():
        return {}
    try:
        return json.loads(sc.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _write_sidecar(staged: StagedFile) -> None:
    entry = {
        "dataset": staged.dataset_name,
        "url": staged.source_url,
        "file": staged.path.name,
        "sha256": staged.sha256,
        "bytes": staged.byte_size,
        "fetched_at": _iso(staged.fetched_at),
        "source_last_modified": _iso(staged.source_last_modified),
        "etag": staged.etag,
        "checked_at": _iso(staged.checked_at),
    }
    _sidecar_path(staged.path).write_text(json.dumps(entry, indent=2) + "\n", encoding="utf-8")


def _record_manifest(staged: StagedFile) -> None:
    """Append to an offline JSONL manifest so staging is auditable pre-DB."""
    manifest = staged.path.parent / "manifest.jsonl"
    entry = {
        "dataset": staged.dataset_name,
        "url": staged.source_url,
        "file": staged.path.name,
        "sha256": staged.sha256,
        "bytes": staged.byte_size,
        "fetched_at": _iso(staged.fetched_at),
        "source_last_modified": _iso(staged.source_last_modified),
        "etag": staged.etag,
    }
    with manifest.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def staged_from_path(dataset_name: str, path: Path, source_url: str | None = None,
                     *, sha256: str | None = None) -> StagedFile:
    """Rehydrate a StagedFile for an already-staged path (reads the sidecar).

    Without a sidecar (files staged before vintage tracking) ``fetched_at``
    falls back to the file's mtime, which is the closest surviving evidence.
    """
    meta = _read_sidecar(path)
    sha = sha256 or _sha256_of(path)
    fetched = _parse_iso(meta.get("fetched_at"))
    if fetched is None:
        fetched = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return StagedFile(
        dataset_name, source_url or meta.get("url"), path, sha, path.stat().st_size,
        fetched_at=fetched,
        source_last_modified=_parse_iso(meta.get("source_last_modified")),
        etag=meta.get("etag"),
        checked_at=_parse_iso(meta.get("checked_at")),
        from_cache=True,
    )


def verified_at(staged: StagedFile) -> datetime:
    """The instant a loader may claim a row was verified against its source.

    This is the file's vintage, NOT the wall clock: re-parsing a file fetched
    in July must not make its rows look verified in September.
    """
    return staged.vintage or _now()


# ---------------------------------------------------------------------------
# Cache lookup
# ---------------------------------------------------------------------------
def cached_candidates(dest_dir: Path, name: str) -> list[Path]:
    """Staged copies of ``name`` ordered by VINTAGE (oldest first), never by
    the hash prefix the filename starts with. The last element is the newest."""
    if not dest_dir.exists():
        return []
    paths = [p for p in dest_dir.glob(f"*_{name}")
             if not p.name.startswith((".partial", ".corrupt"))
             and not p.name.endswith(".meta.json")]

    def key(p: Path) -> tuple[float, int, str]:
        meta = _read_sidecar(p)
        fetched = _parse_iso(meta.get("fetched_at"))
        st = p.stat()
        ts = fetched.timestamp() if fetched else st.st_mtime
        # mtime_ns breaks same-instant ties before the name ever can.
        return (ts, st.st_mtime_ns, p.name)

    return sorted(paths, key=key)


def _verify_cached(path: Path) -> str | None:
    """Re-hash a cached file; quarantine it if the bytes no longer match the
    hash prefix in its own name. Returns the sha256 or None if quarantined."""
    sha = _sha256_of(path)
    if path.name.startswith(sha[:12] + "_"):
        return sha
    quarantine = path.with_name(".corrupt_" + path.name)
    print(f"  WARNING: {path.name} no longer matches its hash prefix; "
          f"quarantined as {quarantine.name}", file=sys.stderr)
    path.rename(quarantine)
    sc = _sidecar_path(path)
    if sc.exists():
        sc.rename(quarantine.with_name(quarantine.name + ".meta.json"))
    return None


def newest_cached(dataset_name: str, name: str, source_url: str | None = None) -> StagedFile | None:
    """The newest verified cached copy of ``name`` for a dataset, or None."""
    settings = get_settings()
    dest_dir = settings.raw_dir / dataset_name
    for path in reversed(cached_candidates(dest_dir, name)):
        sha = _verify_cached(path)
        if sha:
            return staged_from_path(dataset_name, path, source_url, sha256=sha)
    return None


# ---------------------------------------------------------------------------
# Staging entry points
# ---------------------------------------------------------------------------
def stage_local(dataset_name: str, source: Path, source_url: str | None = None) -> StagedFile:
    """Stage an already-local file (e.g. the hand-curated seed CSV)."""
    settings = get_settings()
    dest_dir = settings.raw_dir / dataset_name
    dest_dir.mkdir(parents=True, exist_ok=True)
    sha = _sha256_of(source)
    dest = dest_dir / f"{sha[:12]}_{source.name}"
    if dest.exists():
        return staged_from_path(dataset_name, dest, source_url, sha256=sha)
    shutil.copy2(source, dest)
    mtime = datetime.fromtimestamp(source.stat().st_mtime, tz=timezone.utc)
    staged = StagedFile(dataset_name, source_url, dest, sha, dest.stat().st_size,
                        fetched_at=_now(), source_last_modified=mtime)
    _write_sidecar(staged)
    _record_manifest(staged)
    return staged


def stage_download(
    dataset_name: str,
    url: str,
    *,
    filename: str | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 300.0,
    mutable: bool = False,
    refresh: bool = False,
    max_age: timedelta | None = None,
) -> StagedFile:
    """Download ``url`` into the staging area (streaming), hash it, and stage it.

    ``mutable=False`` (default): the URL's bytes never change; any verified
    cached copy is reused without contacting upstream.

    ``mutable=True``: the URL is a feed. The newest cached copy is reused
    while younger than ``max_age`` (measured from the last upstream check);
    otherwise — or always with ``refresh=True`` — a conditional request is
    made and a new vintage is staged only if the bytes actually changed.
    """
    settings = get_settings()
    dest_dir = settings.raw_dir / dataset_name
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = filename or url.rsplit("/", 1)[-1]

    cached = newest_cached(dataset_name, name, url)
    if cached is not None:
        if not mutable:
            return cached
        if not refresh:
            # Strictly younger than max_age: a max_age of 0 means "always check".
            basis = cached.checked_at or cached.fetched_at
            if max_age is None or (basis is not None and _now() - basis < max_age):
                return cached

    tmp = dest_dir / f".partial_{name}"
    cond: dict[str, str] = {}
    if cached is not None and not tmp.exists():
        if cached.etag:
            cond["If-None-Match"] = cached.etag
        if cached.source_last_modified:
            cond["If-Modified-Since"] = cached.source_last_modified.strftime(
                "%a, %d %b %Y %H:%M:%S GMT")
    try:
        result = _download_with_resume(url, tmp, headers={**(headers or {}), **cond},
                                       timeout=timeout)
    except (httpx.TransportError, httpx.HTTPStatusError) as exc:
        if cached is not None and not refresh:
            print(f"  WARNING: {dataset_name}/{name}: upstream unreachable ({exc!r}); "
                  f"using STALE cached vintage fetched {_iso(cached.fetched_at)}",
                  file=sys.stderr)
            return cached
        raise

    now = _now()
    if result.status_code == 304:
        assert cached is not None
        tmp.unlink(missing_ok=True)
        checked = replace(cached, checked_at=now,
                          source_last_modified=result.last_modified or cached.source_last_modified,
                          etag=result.etag or cached.etag)
        _write_sidecar(checked)
        return checked

    sha = _sha256_of(tmp)
    if cached is not None and sha == cached.sha256:
        # Same bytes re-served without a 304 (server has no validators).
        tmp.unlink()
        checked = replace(cached, checked_at=now,
                          source_last_modified=result.last_modified or cached.source_last_modified,
                          etag=result.etag or cached.etag)
        _write_sidecar(checked)
        return checked

    dest = dest_dir / f"{sha[:12]}_{name}"
    tmp.replace(dest)
    staged = StagedFile(dataset_name, url, dest, sha, dest.stat().st_size,
                        fetched_at=now, source_last_modified=result.last_modified,
                        etag=result.etag, checked_at=now)
    _write_sidecar(staged)
    _record_manifest(staged)
    return staged


def _client(timeout: httpx.Timeout) -> httpx.Client:
    return httpx.Client(timeout=timeout, follow_redirects=True, transport=_transport)


def _download_with_resume(
    url: str,
    tmp: Path,
    *,
    headers: dict[str, str] | None,
    timeout: float,
    retries: int = 6,
) -> DownloadResult:
    """Stream to ``tmp``, resuming via Range on transport errors (big gov files stall).

    Returns the final status (200/206, or 304 when a conditional request found
    the cached copy still current) plus the server's validators.
    """
    req_timeout = httpx.Timeout(connect=30.0, read=timeout, write=60.0, pool=30.0)
    settings = get_settings()
    attempt = 0
    while True:
        offset = tmp.stat().st_size if tmp.exists() else 0
        req_headers = dict(headers or {})
        # IRS/Akamai intermittently 404-redirects default python UAs (observed
        # on the 2024 index, 2026-07-29); identify as a normal client.
        req_headers.setdefault("User-Agent", settings.http_user_agent)
        if offset:
            req_headers["Range"] = f"bytes={offset}-"
            # A resumed request must not be conditional: a 304 mid-resume
            # would leave a partial file we cannot interpret.
            req_headers.pop("If-None-Match", None)
            req_headers.pop("If-Modified-Since", None)
        try:
            with _client(req_timeout) as client, client.stream(
                    "GET", url, headers=req_headers) as response:
                validators = DownloadResult(
                    response.status_code,
                    parse_http_date(response.headers.get("Last-Modified")),
                    response.headers.get("ETag"),
                )
                if response.status_code == 304:
                    return validators
                if offset and response.status_code == 200:
                    # Server ignored Range: restart from scratch.
                    mode, offset = "wb", 0
                elif offset and response.status_code == 206:
                    mode = "ab"
                else:
                    response.raise_for_status()
                    mode = "wb"
                with tmp.open(mode) as fh:
                    for chunk in response.iter_bytes(_CHUNK):
                        fh.write(chunk)
            return validators
        except (httpx.TransportError, httpx.HTTPStatusError) as exc:
            attempt += 1
            if attempt >= retries or (
                    isinstance(exc, httpx.HTTPStatusError)
                    and exc.response.status_code in (401, 403, 404, 410)):
                raise
            time.sleep(min(5 * attempt, 30))


# ---------------------------------------------------------------------------
# Database registration
# ---------------------------------------------------------------------------
def register_raw_file(
    conn: psycopg.Connection,
    staged: StagedFile,
    *,
    license_code: str,
    as_of_date: date | None = None,
    content_type: str | None = None,
    meta: dict | None = None,
) -> int:
    """Upsert the staged file into internal.raw_files (idempotent on sha256).

    On conflict the row keeps its ORIGINAL fetched_at / source_last_modified /
    source_url (a known URL is never overwritten with NULL) and only
    ``parsed_at`` moves to now(): re-ingesting an old file is a new parse of
    old bytes, and the record says exactly that.
    """
    if as_of_date is None:
        as_of_date = staged.vintage_date
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into internal.raw_files
              (dataset_name, source_url, storage_path, sha256, byte_size,
               content_type, license_code, as_of_date, meta,
               fetched_at, source_last_modified, parsed_at)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
            on conflict (sha256) do update set
              source_url           = coalesce(excluded.source_url, internal.raw_files.source_url),
              fetched_at           = coalesce(internal.raw_files.fetched_at, excluded.fetched_at),
              source_last_modified = coalesce(internal.raw_files.source_last_modified,
                                              excluded.source_last_modified),
              as_of_date           = coalesce(internal.raw_files.as_of_date, excluded.as_of_date),
              meta                 = coalesce(excluded.meta, internal.raw_files.meta),
              parsed_at            = now()
            returning id
            """,
            (
                staged.dataset_name,
                staged.source_url,
                str(staged.path),
                staged.sha256,
                staged.byte_size,
                content_type,
                license_code,
                as_of_date,
                json.dumps(meta) if meta else None,
                staged.fetched_at,
                staged.source_last_modified,
            ),
        )
        row = cur.fetchone()
        assert row is not None
        return int(row[0])
