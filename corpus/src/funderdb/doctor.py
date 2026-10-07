"""`funderdb doctor` — environment checks before anyone loads a byte.

Every check is a small pure-ish function returning a :class:`Check` so the
list is easy to extend and easy to test offline. A FAIL means the pipeline
cannot run; a WARN means something optional is missing (SEC sources,
embeddings) and says which commands that disables.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from .config import Settings

MIN_PYTHON = (3, 12)
MIN_FREE_GB_SMALL = 10     # bootstrap --profile small
MIN_FREE_GB_FULL = 250     # full staging of every source


@dataclass(frozen=True)
class Check:
    status: str   # OK | WARN | FAIL
    label: str
    detail: str

    @property
    def failed(self) -> bool:
        return self.status == "FAIL"


def check_python() -> Check:
    v = sys.version_info
    ok = (v.major, v.minor) >= MIN_PYTHON
    return Check("OK" if ok else "FAIL", "python",
                 f"{v.major}.{v.minor}.{v.micro}"
                 + ("" if ok else f" (need >= {MIN_PYTHON[0]}.{MIN_PYTHON[1]})"))


def check_uv() -> Check:
    exe = shutil.which("uv")
    if not exe:
        return Check("WARN", "uv", "not on PATH — install from https://docs.astral.sh/uv/ "
                     "(the pipeline runs fine from an activated venv too)")
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True,
                             timeout=10).stdout.strip()
    except Exception as exc:  # pragma: no cover - defensive
        return Check("WARN", "uv", f"found at {exe} but `uv --version` failed: {exc}")
    return Check("OK", "uv", out or exe)


def check_migrations_dir(settings: Settings) -> Check:
    d = settings.migrations_dir
    if not d.is_dir():
        return Check("FAIL", "migrations", f"directory not found: {d}")
    n = len(list(d.glob("*.sql")))
    return Check("OK" if n else "FAIL", "migrations", f"{n} files under {d}")


def check_data_dir(settings: Settings) -> Check:
    root = settings.data_root
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe = root / ".doctor-write-probe"
        probe.write_text("ok")
        probe.unlink()
    except OSError as exc:
        return Check("FAIL", "data dir", f"{root} is not writable: {exc}")
    return Check("OK", "data dir", f"{root.resolve()} writable")


def check_disk(settings: Settings) -> Check:
    root = settings.data_root if settings.data_root.exists() else Path(".")
    usage = shutil.disk_usage(root)
    free_gb = usage.free / 1e9
    if free_gb < MIN_FREE_GB_SMALL:
        return Check("FAIL", "disk", f"{free_gb:.1f} GB free under {root}; "
                     f"the small profile needs ~{MIN_FREE_GB_SMALL} GB")
    if free_gb < MIN_FREE_GB_FULL:
        return Check("WARN", "disk", f"{free_gb:.1f} GB free under {root}; enough for "
                     f"--profile small, the full staging set needs ~{MIN_FREE_GB_FULL} GB")
    return Check("OK", "disk", f"{free_gb:.0f} GB free under {root}")


def check_sec_user_agent(settings: Settings) -> Check:
    try:
        ua = settings.require_sec_user_agent()
    except RuntimeError:
        return Check("WARN", "SEC_USER_AGENT",
                     "not set — `ingest adv`, `ingest adv-schedules` and `ingest formd` will "
                     "refuse to run until .env names your organisation and a contact e-mail")
    return Check("OK", "SEC_USER_AGENT", ua)


def check_voyage(settings: Settings) -> Check:
    if settings.voyage_api_key:
        return Check("OK", "VOYAGE_API_KEY", "set (semantic search embeddings enabled)")
    return Check("WARN", "VOYAGE_API_KEY",
                 "not set — `embed sync` is disabled; every ingest and export still works")


def check_database(settings: Settings, connect: Callable | None = None) -> list[Check]:
    """DATABASE_URL reachability + extensions + ledger state. Only when set."""
    if not settings.database_url:
        return [Check("WARN", "DATABASE_URL",
                      "not set — staging and --dry-run commands work; everything that writes "
                      "needs it (see docs/SELF-INSTALL.md)")]
    from . import migrate

    if connect is None:
        from .db import connect as _connect

        connect = _connect
    out: list[Check] = []
    try:
        with connect() as conn:
            with conn.cursor() as cur:
                cur.execute("select version(), current_user, current_database()")
                version, user, db = cur.fetchone()
            out.append(Check("OK", "DATABASE_URL",
                             f"reachable: {db} as {user} — {str(version).split(',')[0]}"))
            statuses = migrate.check_extensions(conn)
            problems = migrate.extension_problems(statuses)
            for st in statuses:
                if not st.required:
                    continue
                if not st.available:
                    out.append(Check("FAIL", f"extension {st.name}", "not available"))
                else:
                    out.append(Check("OK", f"extension {st.name}",
                                     f"installed {st.installed_version}" if st.installed_version
                                     else "available (not yet created; migrate will)"))
            for msg in problems:
                out.append(Check("FAIL", "extensions", msg))
            with conn.cursor() as cur:
                cur.execute("select to_regclass('internal.schema_migrations')")
                has_ledger = cur.fetchone()[0] is not None
            if has_ledger:
                applied = migrate.read_ledger(conn)
                on_disk = migrate.discover(settings.migrations_dir)
                p = migrate.plan(on_disk, applied)
                pending = len(p.to_apply)
                conflicts = len(p.conflicts)
                status = "OK" if not pending and not conflicts else "WARN"
                out.append(Check(status, "schema",
                                 f"{len(applied)} applied, {pending} pending, "
                                 f"{conflicts} changed-since-applied"
                                 + ("" if status == "OK" else " — run `funderdb migrate`")))
            else:
                with conn.cursor() as cur:
                    cur.execute("select to_regclass('internal.raw_files')")
                    has_schema = cur.fetchone()[0] is not None
                if has_schema:
                    out.append(Check("WARN", "schema",
                                     "tables exist but no migration ledger — this database was "
                                     "built by hand; run `funderdb migrate --baseline 0024` "
                                     "(or the number you are at) before `funderdb migrate`"))
                else:
                    out.append(Check("WARN", "schema",
                                     "empty database — run `funderdb migrate` "
                                     "(or `funderdb bootstrap`)"))
            conn.rollback()
    except Exception as exc:
        out.append(Check("FAIL", "DATABASE_URL",
                         f"cannot connect: {type(exc).__name__}: {str(exc).strip()[:200]}"))
    return out


def run_checks(settings: Settings, connect: Callable | None = None) -> list[Check]:
    checks = [
        check_python(),
        check_uv(),
        check_migrations_dir(settings),
        check_data_dir(settings),
        check_disk(settings),
        check_sec_user_agent(settings),
        check_voyage(settings),
    ]
    checks.extend(check_database(settings, connect))
    return checks


def format_checks(checks: list[Check]) -> str:
    width = max(len(c.label) for c in checks)
    return "\n".join(f"  {c.status:<4} {c.label:<{width}}  {c.detail}" for c in checks)
