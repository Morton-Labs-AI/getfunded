"""Cache-vintage behaviour of funderdb.staging (no network: httpx.MockTransport).

The audit's P1: a cached file for a mutable URL was reused forever, and a
re-ingest advanced verification timestamps. These tests pin the fixed
contract: immutable URLs reuse the cache; mutable URLs re-check upstream past
max-age or on refresh; a 304 / identical bytes keeps the vintage; new bytes
become a new vintage ordered by fetch time, never by hash prefix; corrupt
cache entries are quarantined; and the raw_files upsert never moves
fetched_at.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from funderdb import staging

URL = "https://example.org/pub/feed.csv"
DATASET = "test_feed"


class Upstream:
    """A fake server with ETag/Last-Modified validators and a call counter."""

    def __init__(self, body: bytes, etag: str = '"v1"',
                 last_modified: str = "Wed, 01 Jul 2026 10:00:00 GMT"):
        self.body = body
        self.etag = etag
        self.last_modified = last_modified
        self.calls: list[httpx.Request] = []
        self.down = False

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        if self.down:
            raise httpx.ConnectError("upstream down", request=request)
        headers = {"ETag": self.etag, "Last-Modified": self.last_modified}
        if request.headers.get("If-None-Match") == self.etag:
            return httpx.Response(304, headers=headers, request=request)
        return httpx.Response(200, content=self.body, headers=headers, request=request)


@pytest.fixture
def upstream(monkeypatch):
    up = Upstream(b"ein,name\n1,A\n")
    monkeypatch.setattr(staging, "_transport", httpx.MockTransport(up.handler))
    monkeypatch.setattr(staging.time, "sleep", lambda *_: None)  # no retry backoff
    yield up
    monkeypatch.setattr(staging, "_transport", None)


def _age_sidecar(staged: staging.StagedFile, days: int) -> None:
    """Rewrite the sidecar so the cached copy looks `days` old."""
    sc = staging._sidecar_path(staged.path)
    meta = json.loads(sc.read_text())
    old = (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0)
    meta["fetched_at"] = old.isoformat()
    meta["checked_at"] = old.isoformat()
    sc.write_text(json.dumps(meta))


def test_first_download_records_vintage(settings, upstream):
    s = staging.stage_download(DATASET, URL)
    assert s.path.exists() and s.path.name.startswith(s.sha256[:12] + "_feed.csv")
    assert s.from_cache is False
    assert s.etag == '"v1"'
    assert s.source_last_modified == datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    assert s.fetched_at is not None and s.vintage == s.source_last_modified
    sidecar = json.loads(staging._sidecar_path(s.path).read_text())
    assert sidecar["sha256"] == s.sha256 and sidecar["etag"] == '"v1"'
    manifest = (s.path.parent / "manifest.jsonl").read_text().strip().splitlines()
    assert json.loads(manifest[-1])["source_last_modified"] == "2026-07-01T10:00:00+00:00"


def test_immutable_url_reuses_cache_without_network(settings, upstream):
    first = staging.stage_download(DATASET, URL)
    second = staging.stage_download(DATASET, URL)
    assert second.path == first.path and second.from_cache is True
    assert len(upstream.calls) == 1
    # The rehydrated record carries the recorded vintage, not the mtime.
    assert second.source_last_modified == first.source_last_modified


def test_mutable_within_max_age_reuses_cache(settings, upstream):
    staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=30))
    s = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=30))
    assert s.from_cache is True and len(upstream.calls) == 1


def test_mutable_past_max_age_makes_conditional_request_and_keeps_304(settings, upstream):
    first = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=30))
    _age_sidecar(first, days=40)
    s = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=30))
    assert len(upstream.calls) == 2
    req = upstream.calls[-1]
    assert req.headers["If-None-Match"] == '"v1"'
    assert req.headers["If-Modified-Since"] == "Wed, 01 Jul 2026 10:00:00 GMT"
    assert s.path == first.path and s.sha256 == first.sha256
    # checked_at advanced; fetched_at did NOT (the bytes are still July's).
    assert s.checked_at is not None and s.checked_at > s.fetched_at
    assert list(s.path.parent.glob(".partial_*")) == []


def test_refresh_forces_check_even_within_max_age(settings, upstream):
    staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=30))
    s = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=30),
                               refresh=True)
    assert len(upstream.calls) == 2 and s.from_cache is True  # 304 -> same bytes


def test_identical_bytes_without_validators_do_not_duplicate(settings, upstream, monkeypatch):
    def no_validators(request):  # server sends neither ETag nor Last-Modified: always 200
        upstream.calls.append(request)
        return httpx.Response(200, content=upstream.body, request=request)

    monkeypatch.setattr(staging, "_transport", httpx.MockTransport(no_validators))
    first = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(0))
    s = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(0))
    assert len(upstream.calls) == 2                     # it DID re-fetch ...
    assert s.path == first.path and s.from_cache is True  # ... but same bytes, same file
    assert s.checked_at is not None and s.source_last_modified is None
    assert len(list(first.path.parent.glob("*_feed.csv"))) == 1


def test_new_bytes_become_new_vintage_ordered_by_time_not_hash(settings, upstream):
    first = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(0))
    # Pick a second body whose hash prefix sorts BEFORE the first one's, so
    # that lexicographic (hash) order and vintage order disagree.
    i = 0
    while True:
        body = f"ein,name\n2,B{i}\n".encode()
        if hashlib.sha256(body).hexdigest()[:12] < first.sha256[:12]:
            break
        i += 1
    upstream.body, upstream.etag = body, '"v2"'
    second = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(0))
    assert second.path != first.path and second.from_cache is False
    assert second.sha256[:12] < first.sha256[:12]            # hash order says "older"
    cands = staging.cached_candidates(first.path.parent, "feed.csv")
    assert cands[-1] == second.path                          # vintage order says "newest"
    assert staging.newest_cached(DATASET, "feed.csv").path == second.path
    assert first.path.exists()                               # the old vintage is kept


def test_corrupt_cache_is_quarantined_and_refetched(settings, upstream):
    first = staging.stage_download(DATASET, URL)
    first.path.write_bytes(b"garbage")
    s = staging.stage_download(DATASET, URL)
    assert s.path.name == first.path.name and s.path.read_bytes() == upstream.body
    assert (first.path.parent / f".corrupt_{first.path.name}").exists()
    assert len(upstream.calls) == 2


def test_stale_cache_survives_upstream_outage_unless_refresh(settings, upstream, capsys):
    first = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=1))
    _age_sidecar(first, days=10)
    upstream.down = True
    s = staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=1))
    assert s.path == first.path
    assert "STALE" in capsys.readouterr().err
    with pytest.raises(httpx.TransportError):
        staging.stage_download(DATASET, URL, mutable=True, max_age=timedelta(days=1),
                               refresh=True)


def test_verified_at_is_vintage_not_wall_clock(settings, upstream):
    s = staging.stage_download(DATASET, URL)
    assert staging.verified_at(s) == datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc)
    no_lm = staging.StagedFile(DATASET, URL, s.path, s.sha256, s.byte_size,
                               fetched_at=datetime(2026, 8, 2, tzinfo=timezone.utc))
    assert staging.verified_at(no_lm) == datetime(2026, 8, 2, tzinfo=timezone.utc)


class _Cur:
    def __init__(self, log):
        self.log = log

    def execute(self, sql, params=None):
        self.log.append((sql, params))

    def fetchone(self):
        return (42,)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Conn:
    def __init__(self):
        self.log = []

    def cursor(self):
        return _Cur(self.log)


def test_register_raw_file_keeps_original_fetch_time_and_url(settings, upstream):
    s = staging.stage_download(DATASET, URL)
    conn = _Conn()
    rfid = staging.register_raw_file(conn, s, license_code="us_public_domain")
    assert rfid == 42
    sql, params = conn.log[-1]
    norm = " ".join(sql.split()).lower()
    assert "parsed_at = now()" in norm
    assert "fetched_at = coalesce(internal.raw_files.fetched_at, excluded.fetched_at)" in norm
    assert "source_url = coalesce(excluded.source_url, internal.raw_files.source_url)" in norm
    # positional params: ..., as_of_date, meta, fetched_at, source_last_modified
    assert params[7] == s.vintage_date
    assert params[-2] == s.fetched_at and params[-1] == s.source_last_modified


def test_parse_http_date_tolerates_garbage():
    assert staging.parse_http_date(None) is None
    assert staging.parse_http_date("not a date") is None
    assert staging.parse_http_date("Wed, 01 Jul 2026 10:00:00 GMT") == datetime(
        2026, 7, 1, 10, 0, tzinfo=timezone.utc)
