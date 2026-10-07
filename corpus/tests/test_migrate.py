"""`funderdb migrate`: plan computation and ledger logic against a fake connection."""

from __future__ import annotations

from pathlib import Path

import pytest

from funderdb import migrate as mig


class FakeCursor:
    def __init__(self, conn):
        self.conn = conn
        self._rows: list = []

    def execute(self, sql, params=None):
        self.conn.executed.append((sql, params))
        norm = " ".join(sql.split()).lower()
        if sql in self.conn.fail_on:
            raise RuntimeError("syntax error at or near 'boom'")
        if "pg_available_extensions" in norm:
            wanted = params[0]
            self._rows = [(n, v) for n, v in self.conn.extensions.items() if n in wanted]
        elif norm.startswith("select filename, sha256 from internal.schema_migrations"):
            self._rows = sorted(self.conn.ledger.items())
        elif norm.startswith("insert into internal.schema_migrations"):
            filename, sha = params
            self.conn.pending_ledger[filename] = sha
        elif "create table if not exists internal.schema_migrations" in norm:
            self.conn.ledger_created = True
        else:
            self.conn.pending_sql.append(sql)

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, extensions=None, ledger=None):
        self.extensions = extensions if extensions is not None else {
            "vector": None, "pg_trgm": "1.6", "pgcrypto": None}
        self.ledger: dict[str, str] = dict(ledger or {})
        self.pending_ledger: dict[str, str] = {}
        self.pending_sql: list[str] = []
        self.applied_sql: list[str] = []
        self.executed: list = []
        self.fail_on: set[str] = set()
        self.ledger_created = False
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1
        self.ledger.update(self.pending_ledger)
        self.applied_sql.extend(self.pending_sql)
        self.pending_ledger.clear()
        self.pending_sql.clear()

    def rollback(self):
        self.rollbacks += 1
        self.pending_ledger.clear()
        self.pending_sql.clear()


@pytest.fixture
def mdir(tmp_path) -> Path:
    d = tmp_path / "migrations"
    d.mkdir()
    (d / "0000_roles.sql").write_text("-- roles\nselect 1;\n")
    (d / "0001_schema.sql").write_text("create schema internal;\n")
    (d / "0002_tables.sql").write_text("create table internal.t (i int);\n")
    (d / "notes.md").write_text("ignored\n")
    return d


# ---------------------------------------------------------------------------
# discovery
# ---------------------------------------------------------------------------
def test_discover_orders_by_filename_and_hashes(mdir):
    ms = mig.discover(mdir)
    assert [m.filename for m in ms] == ["0000_roles.sql", "0001_schema.sql", "0002_tables.sql"]
    assert [m.number for m in ms] == [0, 1, 2]
    assert all(len(m.sha256) == 64 for m in ms)


def test_discover_rejects_bad_names_and_duplicates(mdir):
    (mdir / "0003 bad name.sql").write_text("select 1;")
    with pytest.raises(mig.MigrationError, match="NNNN_description"):
        mig.discover(mdir)
    (mdir / "0003 bad name.sql").unlink()
    (mdir / "0002_other.sql").write_text("select 2;")
    with pytest.raises(mig.MigrationError, match="duplicate migration number 0002"):
        mig.discover(mdir)


# ---------------------------------------------------------------------------
# planning (pure)
# ---------------------------------------------------------------------------
def test_plan_fresh_database_applies_everything(mdir):
    p = mig.plan(mig.discover(mdir), {})
    assert [e.action for e in p.entries] == ["apply", "apply", "apply"]
    assert len(p.to_apply) == 3 and not p.conflicts


def test_plan_skips_applied_and_flags_changed(mdir):
    ms = mig.discover(mdir)
    applied = {ms[0].filename: ms[0].sha256, ms[1].filename: "0" * 64}
    p = mig.plan(ms, applied)
    assert [e.action for e in p.entries] == ["skip", "conflict", "apply"]
    assert p.conflicts[0].migration.filename == "0001_schema.sql"
    forced = mig.plan(ms, applied, force=True)
    assert [e.action for e in forced.entries] == ["skip", "reapply", "apply"]
    assert [e.migration.filename for e in forced.to_apply] == [
        "0001_schema.sql", "0002_tables.sql"]


def test_plan_respects_target_and_reports_ledger_only_rows(mdir):
    ms = mig.discover(mdir)
    p = mig.plan(ms, {"9999_vanished.sql": "a" * 64}, to="0001")
    assert [e.action for e in p.entries] == ["apply", "apply", "beyond-target"]
    assert p.unknown_applied == ["9999_vanished.sql"]
    assert "ledger-only" in mig.format_plan(p)
    assert mig.parse_target("0012") == 12 and mig.parse_target(7) == 7
    with pytest.raises(mig.MigrationError):
        mig.parse_target("twelve")


# ---------------------------------------------------------------------------
# run / ledger against the fake connection
# ---------------------------------------------------------------------------
def test_run_applies_in_order_and_records_ledger(mdir):
    conn = FakeConn()
    out: list[str] = []
    p = mig.run(conn, mdir, echo=out.append)
    assert conn.ledger_created
    assert conn.applied_sql == ["-- roles\nselect 1;\n", "create schema internal;\n",
                                "create table internal.t (i int);\n"]
    ms = {m.filename: m.sha256 for m in mig.discover(mdir)}
    assert conn.ledger == ms
    assert len(p.to_apply) == 3 and conn.rollbacks == 0
    # second run: nothing to do, nothing executed
    conn2 = FakeConn(ledger=conn.ledger)
    out2: list[str] = []
    p2 = mig.run(conn2, mdir, echo=out2.append)
    assert p2.to_apply == [] and conn2.applied_sql == []
    assert any("up to date" in line for line in out2)


def test_run_refuses_changed_file_unless_forced(mdir):
    conn = FakeConn()
    mig.run(conn, mdir, echo=lambda s: None)
    (mdir / "0001_schema.sql").write_text("create schema internal; -- edited\n")
    conn2 = FakeConn(ledger=conn.ledger)
    with pytest.raises(mig.MigrationError, match="changed on disk"):
        mig.run(conn2, mdir, echo=lambda s: None)
    assert conn2.applied_sql == []
    conn3 = FakeConn(ledger=conn.ledger)
    mig.run(conn3, mdir, force=True, echo=lambda s: None)
    assert conn3.applied_sql == ["create schema internal; -- edited\n"]
    assert conn3.ledger["0001_schema.sql"] == mig.sha256_of(mdir / "0001_schema.sql")


def test_dry_run_executes_no_migration(mdir):
    conn = FakeConn()
    out: list[str] = []
    p = mig.run(conn, mdir, dry_run=True, echo=out.append)
    assert len(p.to_apply) == 3 and conn.applied_sql == [] and conn.ledger == {}
    assert any("dry-run" in line for line in out)


def test_to_stops_at_target(mdir):
    conn = FakeConn()
    mig.run(conn, mdir, to="0001", echo=lambda s: None)
    assert sorted(conn.ledger) == ["0000_roles.sql", "0001_schema.sql"]


def test_failure_rolls_back_only_that_file(mdir):
    conn = FakeConn()
    conn.fail_on.add("create table internal.t (i int);\n")
    with pytest.raises(mig.MigrationError, match="0002_tables.sql failed"):
        mig.run(conn, mdir, echo=lambda s: None)
    assert sorted(conn.ledger) == ["0000_roles.sql", "0001_schema.sql"]
    assert conn.rollbacks == 1
    assert "create table internal.t (i int);\n" not in conn.applied_sql


def test_missing_required_extension_fails_before_touching_the_ledger(mdir):
    conn = FakeConn(extensions={"pg_trgm": "1.6"})  # no pgvector
    with pytest.raises(mig.MigrationError, match="pgvector"):
        mig.run(conn, mdir, echo=lambda s: None)
    assert not conn.ledger_created and conn.applied_sql == []


def test_optional_extensions_never_block(mdir):
    conn = FakeConn(extensions={"vector": "0.8.0", "pg_trgm": "1.6"})  # no pg_cron etc.
    statuses = mig.check_extensions(conn)
    assert mig.extension_problems(statuses) == []
    assert {s.name for s in statuses if s.required} == {"vector", "pg_trgm"}


def test_baseline_records_without_running(mdir):
    conn = FakeConn()
    n = mig.baseline(conn, mig.discover(mdir), "0001", echo=lambda s: None)
    assert n == 2 and conn.applied_sql == []
    assert sorted(conn.ledger) == ["0000_roles.sql", "0001_schema.sql"]
    # the follow-up run applies only what is left
    mig.run(conn, mdir, echo=lambda s: None)
    assert conn.applied_sql == ["create table internal.t (i int);\n"]


def test_real_migrations_directory_is_well_formed():
    """The repo's own migrations: parseable, unique numbers, 0000 exists and
    creates every role that later files grant to."""
    repo = Path(__file__).resolve().parents[1]
    ms = mig.discover(repo / "migrations")
    assert ms[0].filename == "0000_roles_bootstrap.sql"
    roles_sql = ms[0].path.read_text().lower()
    for role in ("funder_ro", "funder_rw", "ofdb_publisher"):
        assert f"create role {role}" in roles_sql
    # every "grant ... to <role>" names a role 0000 creates
    import re

    granted = set()
    for m in ms[1:]:
        for g in re.findall(r"\bto\s+(funder_\w+|ofdb_\w+)", m.path.read_text(), re.I):
            granted.add(g.lower())
    assert granted <= {"funder_ro", "funder_rw", "ofdb_publisher"}
