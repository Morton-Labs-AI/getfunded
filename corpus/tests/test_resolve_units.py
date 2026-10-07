"""Unit tests for the pure functions in resolve/common.py (zero DB: plain
asserts, runnable as `uv run python tests/test_resolve_units.py`; also
pytest-shaped)."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from funderdb.resolve.common import JOBS, union_find_clusters, wilson_low  # noqa: E402


def test_wilson_low_gate_boundaries():
    # The pass rule everywhere (apply gate, eval, status): n >= 100 and Wilson
    # 95% lower bound > 0.90. These pin the cliff edge at three sample sizes.
    assert wilson_low(96, 100) > 0.90
    assert wilson_low(95, 100) <= 0.90
    assert wilson_low(189, 200) > 0.90   # 0.904 — the labeling.py docstring case
    assert wilson_low(188, 200) <= 0.90  # 0.898 does NOT clear
    # The funds gate's declared fixed n is 250, not 252: the 2 pre-UI CLI
    # labels are parked and excluded from every gate computation.
    assert wilson_low(235, 250) > 0.90   # 0.9034 — passes
    assert wilson_low(234, 250) <= 0.90  # 0.8986 — does NOT clear


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


def test_class_case_sql_matches_class_info():
    # class_case_sql and class_info are edited in separate places and are
    # joined only by string equality of the class name: a typo silently
    # produces a class the eval never prints, or a class_info row that never
    # matches a row. The tolerance rule itself is SQL and is verified against
    # the database (.phase-b-scripts/verify_nameonly_class.py) rather than
    # re-implemented here, which would only prove a copy agrees with itself.
    import re

    for job_key, spec in JOBS.items():
        emitted = set(re.findall(r"then\s+'([a-z_]+)'", spec.class_case_sql))
        emitted |= set(re.findall(r"else\s+'([a-z_]+)'\s+end", spec.class_case_sql))
        declared = {c for c, _desc, _rule in spec.class_info}
        assert emitted == declared, (
            f"{job_key}: class_case_sql emits {sorted(emitted)} but "
            f"class_info declares {sorted(declared)}")


def test_gate_stratum_is_a_real_stratum():
    for job_key, spec in JOBS.items():
        assert spec.gate_stratum in spec.strata, (
            f"{job_key}: gate_stratum {spec.gate_stratum!r} is not in strata")


if __name__ == "__main__":
    test_wilson_low_gate_boundaries()
    test_wilson_low_zero_of_zero()
    test_union_find_transitive()
    test_union_find_cap_drops_component_whole()
    test_union_find_oversize_leaves_other_components_alone()
    test_union_find_cap_boundary()
    test_class_case_sql_matches_class_info()
    test_gate_stratum_is_a_real_stratum()
    print("resolve unit tests: 8/8 OK")
