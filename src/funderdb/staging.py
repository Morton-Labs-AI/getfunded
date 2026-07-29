"""Hash-first raw-file staging.

Doctrine: file-first ingestion. Every input — bulk CSVs, XML zips, API pulls,
hand-curated seed CSVs — is staged to ``data/raw/<dataset>/<sha256[:12]>_<name>``
and registered in ``internal.raw_files`` before any parsing writes to the
database. No fact row exists without a hashed immutable artifact behind it.

Ported from the April 2026 attempt's ``storage.py`` (sha256-first naming),
with resumable-download and offline-manifest additions.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx
import psycopg

from .config import get_settings

_CHUNK = 1 << 20  # 1 MiB


@dataclass(frozen=True)
class StagedFile:
    dataset_name: str
    source_url: str | None
    path: Path
    sha256: str
    byte_size: int


def _sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        while chunk := fh.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def _record_manifest(staged: StagedFile) -> None:
    """Append to an offline JSONL manifest so staging is auditable pre-DB."""
    manifest = staged.path.parent / "manifest.jsonl"
    entry = {
        "dataset": staged.dataset_name,
        "url": staged.source_url,
        "file": staged.path.name,
        "sha256": staged.sha256,
        "bytes": staged.byte_size,
    }
    with manifest.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry) + "\n")


def stage_local(dataset_name: str, source: Path, source_url: str | None = None) -> StagedFile:
    """Stage an already-local file (e.g. the hand-curated seed CSV)."""
    settings = get_settings()
    dest_dir = settings.raw_dir / dataset_name
    dest_dir.mkdir(parents=True, exist_ok=True)
    sha = _sha256_of(source)
    dest = dest_dir / f"{sha[:12]}_{source.name}"
    if not dest.exists():
        shutil.copy2(source, dest)
    staged = StagedFile(dataset_name, source_url, dest, sha, dest.stat().st_size)
    _record_manifest(staged)
    return staged


def stage_download(
    dataset_name: str,
    url: str,
    *,
    filename: str | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 300.0,
) -> StagedFile:
    """Download ``url`` into the staging area (streaming), hash it, and stage it.

    If a staged file for this dataset with the same final name pattern already
    exists and hashes clean, the download is skipped (re-runs are cheap).
    """
    settings = get_settings()
    dest_dir = settings.raw_dir / dataset_name
    dest_dir.mkdir(parents=True, exist_ok=True)
    name = filename or url.rsplit("/", 1)[-1]

    # Skip re-download if any prior staging of this name exists (BMF/ADV files
    # are point-in-time snapshots; a new vintage gets a new hash prefix anyway
    # because we pass a dated filename for those). In-flight ".partial_" files
    # are NOT staged — they resume below.
    existing = sorted(
        p for p in dest_dir.glob(f"*_{name}") if not p.name.startswith(".partial")
    )
    if existing:
        path = existing[-1]
        sha = _sha256_of(path)
        return StagedFile(dataset_name, url, path, sha, path.stat().st_size)

    tmp = dest_dir / f".partial_{name}"
    _download_with_resume(url, tmp, headers=headers, timeout=timeout)
    sha = _sha256_of(tmp)
    dest = dest_dir / f"{sha[:12]}_{name}"
    tmp.rename(dest)
    staged = StagedFile(dataset_name, url, dest, sha, dest.stat().st_size)
    _record_manifest(staged)
    return staged


def _download_with_resume(
    url: str,
    tmp: Path,
    *,
    headers: dict[str, str] | None,
    timeout: float,
    retries: int = 6,
) -> None:
    """Stream to ``tmp``, resuming via Range on transport errors (big gov files stall)."""
    req_timeout = httpx.Timeout(connect=30.0, read=timeout, write=60.0, pool=30.0)
    attempt = 0
    while True:
        offset = tmp.stat().st_size if tmp.exists() else 0
        req_headers = dict(headers or {})
        # IRS/Akamai intermittently 404-redirects default python UAs (observed
        # on the 2024 index, 2026-07-29); identify as a normal client.
        req_headers.setdefault(
            "User-Agent",
            "Mozilla/5.0 (Macintosh) MortonLabs-funderdb (zach@mortonlabs.ai)",
        )
        if offset:
            req_headers["Range"] = f"bytes={offset}-"
        try:
            with httpx.stream(
                "GET", url, headers=req_headers, timeout=req_timeout, follow_redirects=True
            ) as response:
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
            return
        except (httpx.TransportError, httpx.HTTPStatusError):
            attempt += 1
            if attempt >= retries:
                raise
            time.sleep(min(5 * attempt, 30))


def register_raw_file(
    conn: psycopg.Connection,
    staged: StagedFile,
    *,
    license_code: str,
    as_of_date: date | None = None,
    content_type: str | None = None,
    meta: dict | None = None,
) -> int:
    """Upsert the staged file into internal.raw_files (idempotent on sha256)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into internal.raw_files
              (dataset_name, source_url, storage_path, sha256, byte_size,
               content_type, license_code, as_of_date, meta)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (sha256) do update set source_url = excluded.source_url
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
            ),
        )
        row = cur.fetchone()
        assert row is not None
        return int(row[0])
