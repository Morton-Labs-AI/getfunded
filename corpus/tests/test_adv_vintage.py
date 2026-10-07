"""SEC ADV feed selection: by feed DATE in the filename, never by hash prefix."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from funderdb import staging
from funderdb.sources import sec_adv


def _touch(feed_dir: Path, prefix: str, mm: str, dd: str, yyyy: str) -> Path:
    feed_dir.mkdir(parents=True, exist_ok=True)
    p = feed_dir / f"{prefix}_IA_FIRM_SEC_Feed_{mm}_{dd}_{yyyy}.xml.gz"
    p.write_bytes(b"x")
    return p


def test_feed_date_of_parses_dated_name():
    assert sec_adv.feed_date_of("abc123def456_IA_FIRM_SEC_Feed_07_25_2026.xml.gz") == \
        date(2026, 7, 25)
    assert sec_adv.feed_date_of("abc_IA_FIRM_SEC_Feed_13_45_2026.xml.gz") is None
    assert sec_adv.feed_date_of("something_else.xml.gz") is None


def test_newest_staged_feed_orders_by_date_not_hash(tmp_path):
    feed_dir = tmp_path / "sec_form_adv"
    july = _touch(feed_dir, "ffffffffffff", "07", "25", "2026")   # hash prefix sorts LAST
    sept = _touch(feed_dir, "000000000000", "09", "10", "2026")   # hash prefix sorts FIRST
    _touch(feed_dir, ".partial_zzzz", "09", "30", "2026")          # in-flight, ignored
    # Lexicographic order of the full name would pick July; vintage picks September.
    assert sorted(p.name for p in feed_dir.glob("*_IA_FIRM_SEC_Feed_*"))[-1] == july.name
    d, p = sec_adv.newest_staged_feed(feed_dir)
    assert (d, p) == (date(2026, 9, 10), sept)


def test_stage_feed_reuses_recent_staged_feed_without_network(settings, monkeypatch):
    feed_dir = settings.raw_dir / sec_adv.DATASET
    today = datetime.now(timezone.utc).date()
    d = today - timedelta(days=2)
    p = _touch(feed_dir, "0" * 12, f"{d.month:02d}", f"{d.day:02d}", str(d.year))
    calls = []
    monkeypatch.setattr(staging, "_transport",
                        httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(500)))
    s = sec_adv.stage_feed()
    assert s.path == p and s.from_cache and calls == []
    assert s.source_url == sec_adv.feed_url(d)


def test_stage_feed_fetches_newest_available_when_stale(settings, monkeypatch):
    feed_dir = settings.raw_dir / sec_adv.DATASET
    today = datetime.now(timezone.utc).date()
    old = today - timedelta(days=20)
    _touch(feed_dir, "0" * 12, f"{old.month:02d}", f"{old.day:02d}", str(old.year))
    requested = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path.rsplit("/", 1)[-1])
        assert request.headers["User-Agent"] == "Test Org tests@example.org"
        # today's feed is not published yet; yesterday's is.
        if sec_adv.feed_date_of(requested[-1]) == today:
            return httpx.Response(404, request=request)
        return httpx.Response(200, content=b"<Firms/>", request=request)

    monkeypatch.setattr(staging, "_transport", httpx.MockTransport(handler))
    monkeypatch.setattr(staging.time, "sleep", lambda *_: None)
    s = sec_adv.stage_feed()
    assert sec_adv.feed_date_of(s.path) == today - timedelta(days=1)
    assert s.from_cache is False
    assert requested[0].endswith(f"{today.month:02d}_{today.day:02d}_{today.year}.xml.gz")


def test_stage_feed_requires_sec_user_agent(settings):
    settings.sec_user_agent = None
    with pytest.raises(RuntimeError, match="SEC_USER_AGENT"):
        sec_adv.stage_feed(date(2026, 7, 25))


def test_explicit_feed_date_is_immutable_and_cached(settings, monkeypatch):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, content=b"<Firms/>", request=request)

    monkeypatch.setattr(staging, "_transport", httpx.MockTransport(handler))
    a = sec_adv.stage_feed(date(2026, 7, 25))
    b = sec_adv.stage_feed(date(2026, 7, 25))
    assert a.path == b.path and len(calls) == 1
    assert sec_adv.feed_date_of(a.path) == date(2026, 7, 25)
