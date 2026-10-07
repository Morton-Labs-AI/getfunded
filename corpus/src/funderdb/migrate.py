"""Migration runner — `funderdb migrate`.

Applies ``migrations/NNNN_*.sql`` in filename order and records each one in
``internal.schema_migrations`` (filename, sha256, applied_at). A file whose
bytes changed after it was applied is a CONFLICT and stops the run unless
``--force`` is given, because a migration that silently differs from what the
database ran is the single most common way two forks drift apart.

Design rules:

* One transaction per file: the SQL and its ledger row commit together, so a
  failed migration leaves no half-recorded state.
* The ledger lives in ``internal`` — the schema 0001 creates — and the runner
  creates both schema and ledger itself (idempotently) because the ledger must
  exist before 0001 runs.
* No DB-specific assumptions: the runner needs only ``cursor()``, ``execute``,
  ``fetchall``, ``commit`` and ``rollback``, which is also what lets the plan
  and ledger logic be unit-tested against a fake connection.
* Extensions are checked up front (``pg_available_extensions``) with a message
  that names the package to install, rather than failing at migration 8 with
  ``type "halfvec" does not exist``.
"""

from __future__ import annotations

import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable

_FILENAME_RE = re.compile(r"^(\d{4})_[A-Za-z0-9_\-]+\.sql$")

LEDGER_TABLE = "internal.schema_migrations"

LEDGER_DDL = """
create schema if not exists internal;
create table if not exists internal.schema_migrations (
  filename   text primary key,
  sha256     char(64) not null,
  applied_at timestamptz not null default now(),
  applied_by text not null default current_user
);
"""

# name -> (why it is needed, how to get it)
REQUIRED_EXTENSIONS: dict[str, tuple[str, str]] = {
    "vector": ("pgvector: halfvec(512) embeddings + HNSW search (migration 0008)",
               "install the pgvector package for your Postgres version, e.g. "
               "`apt install postgresql-16-pgvector`, or use the pgvector/pgvector Docker "
               "image; Supabase and most managed providers ship it"),
    "pg_trgm": ("trigram indexes on organization names (migration 0001)",
                "part of postgresql-contrib; `apt install postgresql-contrib`"),
}
OPTIONAL_EXTENSIONS: dict[str, str] = {
    "pgcrypto": "only needed for gen_random_uuid() on Postgres < 13 (built in since 13)",
    "uuid-ossp": "not used by the migrations; listed because some forks add uuid_generate_v4()",
    "pg_cron": "optional: scheduled materialized-view refresh; nothing in migrations needs it",
}


@dataclass(frozen=True)
class Migration:
    filename: str
    number: int
    path: Path
    sha256: str

    @property
    def label(self) -> str:
        return f"{self.number:04d}"


@dataclass(frozen=True)
class PlanEntry:
    migration: Migration
    # apply | skip (applied, same hash) | conflict (applied, hash changed)
    # reapply (conflict overridden by --force) | beyond-target
    action: str
    applied_sha: str | None = None


@dataclass(frozen=True)
class Plan:
    entries: list[PlanEntry]
    unknown_applied: list[str]   # ledger rows with no file on disk

    @property
    def to_apply(self) -> list[PlanEntry]:
        return [e for e in self.entries if e.action in ("apply", "reapply")]

    @property
    def conflicts(self) -> list[PlanEntry]:
        return [e for e in self.entries if e.action == "conflict"]

    def summary(self) -> str:
        counts: dict[str, int] = {}
        for e in self.entries:
            counts[e.action] = counts.get(e.action, 0) + 1
        return ", ".join(f"{n} {k}" for k, n in sorted(counts.items()))


@dataclass(frozen=True)
class ExtensionStatus:
    name: str
    available: bool
    installed_version: str | None
    required: bool


class MigrationError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Pure functions: discovery and planning
# ---------------------------------------------------------------------------
def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def discover(migrations_dir: Path) -> list[Migration]:
    """Every ``NNNN_name.sql`` in filename order. Duplicate numbers are an error
    (two forks adding 0025 is exactly the collision this catches)."""
    if not migrations_dir.is_dir():
        raise MigrationError(f"migrations directory not found: {migrations_dir}")
    found: list[Migration] = []
    for path in sorted(migrations_dir.iterdir()):
        if path.suffix != ".sql":
            continue
        m = _FILENAME_RE.match(path.name)
        if not m:
            raise MigrationError(
                f"{path.name}: migration files must be named NNNN_description.sql")
        found.append(Migration(path.name, int(m.group(1)), path, sha256_of(path)))
    seen: dict[int, str] = {}
    for mig in found:
        if mig.number in seen:
            raise MigrationError(
                f"duplicate migration number {mig.label}: {seen[mig.number]} and {mig.filename}")
        seen[mig.number] = mig.filename
    return found


def parse_target(to: str | int | None) -> int | None:
    if to is None or to == "":
        return None
    if isinstance(to, int):
        return to
    s = str(to).strip()
    m = re.match(r"^(\d{1,4})", s)
    if not m:
        raise MigrationError(f"--to expects a migration number like 0012 (got {to!r})")
    return int(m.group(1))


def plan(migrations: Iterable[Migration], applied: dict[str, str], *,
         to: str | int | None = None, force: bool = False) -> Plan:
    """Decide what to do with every file given the ledger (filename -> sha256)."""
    target = parse_target(to)
    migrations = list(migrations)
    on_disk = {m.filename for m in migrations}
    entries: list[PlanEntry] = []
    for mig in migrations:
        prior = applied.get(mig.filename)
        if target is not None and mig.number > target:
            entries.append(PlanEntry(mig, "beyond-target", prior))
        elif prior is None:
            entries.append(PlanEntry(mig, "apply"))
        elif prior.strip().lower() == mig.sha256:
            entries.append(PlanEntry(mig, "skip", prior))
        else:
            entries.append(PlanEntry(mig, "reapply" if force else "conflict", prior))
    unknown = sorted(f for f in applied if f not in on_disk)
    return Plan(entries, unknown)


def format_plan(p: Plan) -> str:
    width = max((len(e.migration.filename) for e in p.entries), default=20)
    lines = []
    for e in p.entries:
        note = ""
        if e.action == "conflict":
            note = (f"  applied sha {e.applied_sha[:12]} != file sha "
                    f"{e.migration.sha256[:12]} (use --force to re-run)")
        elif e.action == "reapply":
            note = f"  applied sha {e.applied_sha[:12]} -> {e.migration.sha256[:12]} (--force)"
        lines.append(f"  {e.action:<13} {e.migration.filename:<{width}}{note}")
    for f in p.unknown_applied:
        lines.append(f"  {'ledger-only':<13} {f:<{width}}  (recorded as applied, no such file)")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Connection-touching functions (kept tiny so a fake connection can stand in)
# ---------------------------------------------------------------------------
def ensure_ledger(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(LEDGER_DDL)
    conn.commit()


def read_ledger(conn) -> dict[str, str]:
    with conn.cursor() as cur:
        cur.execute(f"select filename, sha256 from {LEDGER_TABLE} order by filename")
        rows = cur.fetchall()
    return {str(r[0]): str(r[1]).strip() for r in rows}


def check_extensions(conn) -> list[ExtensionStatus]:
    names = list(REQUIRED_EXTENSIONS) + list(OPTIONAL_EXTENSIONS)
    with conn.cursor() as cur:
        cur.execute(
            "select name, installed_version from pg_available_extensions where name = any(%s)",
            (names,))
        rows = {str(r[0]): r[1] for r in cur.fetchall()}
    out = []
    for name in names:
        out.append(ExtensionStatus(
            name, name in rows, rows.get(name), required=name in REQUIRED_EXTENSIONS))
    return out


def extension_problems(statuses: Iterable[ExtensionStatus]) -> list[str]:
    """Human-readable reasons the migrations cannot run, empty when all is well."""
    problems = []
    for st in statuses:
        if st.required and not st.available:
            why, how = REQUIRED_EXTENSIONS[st.name]
            problems.append(
                f"extension {st.name!r} is not available on this server — needed for {why}. "
                f"To fix: {how}.")
    return problems


def apply_one(conn, mig: Migration, *, echo: Callable[[str], None] = print) -> None:
    """Run one file and record it, atomically."""
    sql = mig.path.read_text(encoding="utf-8")
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            cur.execute(
                f"""insert into {LEDGER_TABLE} (filename, sha256)
                    values (%s, %s)
                    on conflict (filename) do update
                      set sha256 = excluded.sha256, applied_at = now(),
                          applied_by = current_user""",
                (mig.filename, mig.sha256))
        conn.commit()
    except Exception as exc:
        conn.rollback()
        raise MigrationError(f"{mig.filename} failed: {type(exc).__name__}: {exc}") from exc
    echo(f"  applied       {mig.filename}")


def baseline(conn, migrations: Iterable[Migration], through: str | int,
             *, echo: Callable[[str], None] = print) -> int:
    """Record files <= ``through`` as applied WITHOUT running them.

    For a database whose schema was built by hand before the runner existed
    (the original project applied 0001-0024 through a dashboard). Nothing is
    executed; the ledger simply starts telling the truth from here on.
    """
    target = parse_target(through)
    if target is None:
        raise MigrationError("--baseline needs a migration number")
    ensure_ledger(conn)
    already = read_ledger(conn)
    n = 0
    with conn.cursor() as cur:
        for mig in migrations:
            if mig.number > target or mig.filename in already:
                continue
            cur.execute(
                f"insert into {LEDGER_TABLE} (filename, sha256) values (%s, %s)",
                (mig.filename, mig.sha256))
            echo(f"  baselined     {mig.filename}")
            n += 1
    conn.commit()
    return n


def run(conn, migrations_dir: Path, *, to: str | int | None = None, force: bool = False,
        dry_run: bool = False, echo: Callable[[str], None] = print) -> Plan:
    """Plan and (unless dry_run) apply. Returns the plan that was computed."""
    migrations = discover(migrations_dir)
    if not migrations:
        raise MigrationError(f"no *.sql migrations under {migrations_dir}")

    statuses = check_extensions(conn)
    problems = extension_problems(statuses)
    for st in statuses:
        if st.required:
            state = (f"installed {st.installed_version}" if st.installed_version
                     else "available (migrations will CREATE EXTENSION)" if st.available
                     else "MISSING")
            echo(f"  extension     {st.name:<10} {state}")
    if problems:
        raise MigrationError("\n".join(problems))

    ensure_ledger(conn)
    applied = read_ledger(conn)
    p = plan(migrations, applied, to=to, force=force)
    echo(f"plan: {p.summary()}")
    echo(format_plan(p))
    if p.conflicts:
        raise MigrationError(
            f"{len(p.conflicts)} applied migration(s) changed on disk; refusing to continue. "
            "Restore the file, or re-run with --force to re-apply and re-record it.")
    if dry_run:
        echo("dry-run: nothing applied.")
        return p
    for entry in p.to_apply:
        apply_one(conn, entry.migration, echo=echo)
    if not p.to_apply:
        echo("up to date: nothing to apply.")
    return p


def main_cli(argv: list[str] | None = None) -> int:  # pragma: no cover - thin wrapper
    """Allow `python -m funderdb.migrate --dry-run` without click."""
    import argparse

    from .config import get_settings
    from .db import connect

    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--to", default=None)
    args = ap.parse_args(argv)
    with connect() as conn:
        try:
            run(conn, get_settings().migrations_dir, to=args.to, force=args.force,
                dry_run=args.dry_run)
        except MigrationError as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main_cli())
