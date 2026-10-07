"""Export correctness: CSV record counting, atomic publish, per-source licensing."""

from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from funderdb import export

# One header + ONE record whose purpose field holds two embedded newlines and
# an escaped quote. Byte-counting "\n" reports 4 lines; there are 2 records.
MULTILINE_CSV = (
    b'id,purpose_text,amount\n'
    b'1,"general support\nfor the ""annual""\nfund",5000\n'
)


def test_count_csv_records_ignores_quoted_newlines():
    n, in_quotes = export.count_csv_records(MULTILINE_CSV)
    assert (n, in_quotes) == (2, False)          # header + 1 data record
    assert MULTILINE_CSV.count(b"\n") == 4       # what the old code counted


@pytest.mark.parametrize("cut", range(1, len(MULTILINE_CSV)))
def test_count_csv_records_is_chunk_boundary_safe(cut):
    a, b = MULTILINE_CSV[:cut], MULTILINE_CSV[cut:]
    n1, q = export.count_csv_records(a)
    n2, q = export.count_csv_records(b, q)
    assert (n1 + n2, q) == (2, False)


def test_count_csv_records_plain_chunks_fast_path():
    assert export.count_csv_records(b"a,b\nc,d\ne,f\n") == (3, False)
    assert export.count_csv_records(b"inside\nquotes\n", True) == (0, True)
    assert export.count_csv_records(b"") == (0, False)


class _Copy:
    def __init__(self, chunks):
        self.chunks = chunks

    def __iter__(self):
        return iter(self.chunks)

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Cursor:
    """Yields the COPY stream in chunks that split inside the quoted field."""

    def __init__(self, payload: bytes, rowcount: int, cut: int = 20):
        self.payload = payload
        self.rowcount = -1
        self._after = rowcount
        self.cut = cut
        self.copies: list[str] = []

    def copy(self, sql):
        self.copies.append(sql)
        self.rowcount = self._after
        return _Copy([self.payload[:self.cut], self.payload[self.cut:]])


def test_write_csv_gz_counts_records_and_matches_server(tmp_path):
    cur = _Cursor(MULTILINE_CSV, rowcount=1)
    meta = export._write_csv_gz(cur, "select * from public.x order by id",
                                tmp_path / "x.csv.gz")
    assert meta["rows"] == 1
    assert gzip.decompress((tmp_path / "x.csv.gz").read_bytes()) == MULTILINE_CSV
    assert "null ''" in cur.copies[0] and "header true" in cur.copies[0]


def test_write_csv_gz_is_byte_stable_across_names(tmp_path):
    a = export._write_csv_gz(_Cursor(MULTILINE_CSV, 1), "q", tmp_path / "a.csv.gz")
    b = export._write_csv_gz(_Cursor(MULTILINE_CSV, 1), "q", tmp_path / "b.csv.gz")
    assert a["sha256"] == b["sha256"] and a["sha256_uncompressed"] == b["sha256_uncompressed"]


def test_write_csv_gz_rejects_server_count_mismatch(tmp_path):
    with pytest.raises(RuntimeError, match="!= server COPY count"):
        export._write_csv_gz(_Cursor(MULTILINE_CSV, rowcount=4), "q", tmp_path / "x.csv.gz")


def test_write_csv_gz_rejects_truncated_stream(tmp_path):
    with pytest.raises(RuntimeError, match="inside a quoted field"):
        export._write_csv_gz(_Cursor(MULTILINE_CSV[:30], rowcount=-1), "q",
                             tmp_path / "x.csv.gz")


# ---------------------------------------------------------------------------
# versioned, atomic publish
# ---------------------------------------------------------------------------
def test_vintage_label_is_utc_and_sortable():
    assert export.vintage_label(datetime(2026, 8, 7, 15, 30, tzinfo=timezone.utc)) == \
        "20260807T153000Z"


def test_publish_writes_manifest_last_then_renames(tmp_path):
    root = tmp_path / "export"
    tmp = root / ".tmp-20260807T153000Z"
    final = root / "20260807T153000Z"
    tmp.mkdir(parents=True)
    (tmp / "organizations.csv.gz").write_bytes(b"x")
    assert not (tmp / "manifest.json").exists()
    out = export.publish(tmp, final, {"vintage": "20260807T153000Z", "files": []})
    assert out == final and not tmp.exists()
    assert json.loads((final / "manifest.json").read_text())["vintage"] == "20260807T153000Z"
    assert (root / "LATEST").read_text().strip() == "20260807T153000Z"
    assert not (root / ".LATEST.tmp").exists()
    # a vintage is immutable: publishing it twice is refused
    tmp.mkdir()
    with pytest.raises(RuntimeError, match="already exists"):
        export.publish(tmp, final, {})


def test_stale_tmp_dirs_are_removed(tmp_path):
    root = tmp_path / "export"
    (root / ".tmp-20260101T000000Z").mkdir(parents=True)
    (root / "20260102T000000Z").mkdir()
    export._clean_stale_tmp(root, echo=lambda s: None)
    assert sorted(p.name for p in root.iterdir()) == ["20260102T000000Z"]


# ---------------------------------------------------------------------------
# licensing per source
# ---------------------------------------------------------------------------
LICENSING_MAP = {
    "us_public_domain": {"license_code": "us_public_domain",
                         "license_name": "U.S. Government public domain",
                         "republishable": True, "attribution_required": False,
                         "license_url": None, "notes": None},
    "cc_by": {"license_code": "cc_by", "license_name": "Creative Commons Attribution",
              "republishable": True, "attribution_required": True,
              "license_url": None, "notes": None},
    "publisher_website": {"license_code": "publisher_website",
                          "license_name": "Publisher website content",
                          "republishable": False, "attribution_required": False,
                          "license_url": None, "notes": None},
}


def test_build_licensing_labels_each_source():
    lic = export.build_licensing(
        LICENSING_MAP,
        {"irs_eo_bmf": ["us_public_domain"], "seed_federal_programs": ["cc_by"],
         "funder_website": ["publisher_website"]},
        {"organizations.csv.gz": ["irs_eo_bmf", "seed_federal_programs"],
         "funding_programs.csv.gz": ["seed_federal_programs"]},
    )
    assert set(lic["sources"]) == {"irs_eo_bmf", "seed_federal_programs"}
    assert lic["sources"]["irs_eo_bmf"]["license_codes"] == ["us_public_domain"]
    assert lic["sources"]["seed_federal_programs"]["licenses"][0]["attribution_required"]
    assert lic["non_republishable_sources_present"] == []
    assert lic["compilation"]["code"] == "cc_by"
    assert "does not relicense" in lic["note"]


def test_build_licensing_flags_non_republishable_leak():
    lic = export.build_licensing(
        LICENSING_MAP, {"funder_website": ["publisher_website"]},
        {"organizations.csv.gz": ["funder_website"]})
    assert lic["non_republishable_sources_present"] == ["funder_website"]
    text = export._license_text(lic)
    assert "NOT republishable" in text and "Morton" not in text


def test_readme_mentions_per_source_licensing():
    m = {"vintage": "v", "generated_at": "t", "generator": {"schema_migration": None},
         "row_count_total": 0, "files": [], "excluded": {}}
    text = export._readme(m)
    assert "sources licensed individually" in text and "Morton" not in text
    assert "quoted newlines" in text


def test_table_list_has_unique_order_keys():
    for view, stem, order in export.TABLES:
        assert view.startswith("public.") and stem and order
    assert len({t[1] for t in export.TABLES}) == len(export.TABLES)
    assert Path(export.__file__).name == "export.py"
