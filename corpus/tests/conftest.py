"""Shared fixtures: an isolated DATA_ROOT and settings that never read .env."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from funderdb import config  # noqa: E402


@pytest.fixture
def settings(tmp_path, monkeypatch):
    """A Settings object rooted in tmp_path, installed everywhere get_settings
    is looked up. `_env_file=None` keeps a developer's .env out of the tests."""
    s = config.Settings(_env_file=None, data_root=tmp_path / "data",
                        sec_user_agent="Test Org tests@example.org", database_url=None)
    original = config.get_settings
    original.cache_clear()
    monkeypatch.setattr(config, "get_settings", lambda: s)
    # Modules import get_settings by name; patch the ones under test.
    for modname in ("funderdb.staging", "funderdb.sources.sec_adv",
                    "funderdb.sources.irs_990pf", "funderdb.export"):
        try:
            mod = __import__(modname, fromlist=["get_settings"])
        except ImportError:
            continue
        if hasattr(mod, "get_settings"):
            monkeypatch.setattr(mod, "get_settings", lambda: s)
    yield s
    original.cache_clear()
