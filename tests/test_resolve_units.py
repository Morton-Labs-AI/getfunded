"""Unit tests for the pure functions in resolve/common.py (zero DB: plain
asserts, runnable as `uv run python tests/test_resolve_units.py`; also
pytest-shaped)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from funderdb.resolve.common import union_find_clusters, wilson_low  # noqa: E402


def test_wilson_low_gate_boundaries():
    # The pass rule everywhere (apply gate, eval, status): n >= 100 and Wilson
    # 95% lower bound > 0.90. These pin the cliff edge at three sample sizes.
    assert wilson_low(96, 100) > 0.90
    assert wilson_low(95, 100) <= 0.90
    assert wilson_low(189, 200) > 0.90   # 0.904 — the labeling.py docstring case
    assert wilson_low(188, 200) <= 0.90  # 0.898 does NOT clear
    assert wilson_low(237, 252) > 0.90
    assert wilson_low(236, 252) <= 0.90


def test_wilson_low_zero_of_zero():
    # No labels certify nothing: n=0 must return 0.0, not divide by zero.
    assert wilson_low(0, 0) == 0.0


def test_union_find_transitive():
    clusters, oversize = union_find_clusters([("a", "b"), ("b", "c")], cap=5)
    assert clusters == [["a", "b", "c"]]
    assert oversize == set()


def test_union_find_cap_drops_component_whole():
    # A merge that would push a component past cap marks every involved id
    # oversize, and any cluster touching an oversize id is dropped entirely —
    # no partial cluster survives (its links stay pending).
    clusters, oversize = union_find_clusters([("a", "b"), ("b", "c")], cap=2)
    assert clusters == []
    assert oversize == {"a", "b", "c"}


def test_union_find_oversize_leaves_other_components_alone():
    clusters, oversize = union_find_clusters(
        [("a", "b"), ("b", "c"), ("x", "y")], cap=2)
    assert clusters == [["x", "y"]]
    assert oversize == {"a", "b", "c"}


def test_union_find_cap_boundary():
    # Exactly-cap components survive: the cap rejects only merges that would
    # push a component PAST cap members, not ones that land on it.
    clusters, oversize = union_find_clusters([("a", "b"), ("b", "c")], cap=3)
    assert clusters == [["a", "b", "c"]]
    assert oversize == set()


if __name__ == "__main__":
    test_wilson_low_gate_boundaries()
    test_wilson_low_zero_of_zero()
    test_union_find_transitive()
    test_union_find_cap_drops_component_whole()
    test_union_find_oversize_leaves_other_components_alone()
    test_union_find_cap_boundary()
    print("resolve unit tests: 6/6 OK")
