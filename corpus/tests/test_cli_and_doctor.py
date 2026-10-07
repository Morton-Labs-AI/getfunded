"""CLI discoverability (`funderdb --help`) and the offline half of `doctor`."""

from __future__ import annotations

import click
from click.testing import CliRunner

from funderdb import cli, doctor
from funderdb.config import Settings


def _walk(group: click.Group, prefix: str = ""):
    for name, cmd in group.commands.items():
        full = f"{prefix}{name}"
        yield full, cmd
        if isinstance(cmd, click.Group):
            yield from _walk(cmd, full + " ")


def test_top_level_help_lists_setup_commands():
    r = CliRunner().invoke(cli.main, ["--help"])
    assert r.exit_code == 0, r.output
    for cmd in ("doctor", "migrate", "bootstrap", "ingest", "export", "status"):
        assert f"\n  {cmd}" in r.output, f"{cmd} missing from --help"


def test_every_command_has_one_line_help():
    missing = [name for name, cmd in _walk(cli.main) if not (cmd.help or "").strip()]
    assert missing == [], f"commands without help text: {missing}"
    # and the short help (first line) is non-trivial
    short = {name: cmd.get_short_help_str(limit=200) for name, cmd in _walk(cli.main)}
    assert all(len(v) > 10 for v in short.values()), short


def test_subcommand_help_renders():
    runner = CliRunner()
    for args in (["ingest", "--help"], ["ingest", "adv", "--help"], ["migrate", "--help"],
                 ["bootstrap", "--help"], ["export", "public", "--help"]):
        r = runner.invoke(cli.main, args)
        assert r.exit_code == 0, (args, r.output)


def test_new_flags_are_wired():
    adv = cli.main.commands["ingest"].commands["adv"]
    assert {p.name for p in adv.params} >= {"feed_date", "refresh", "max_age_days"}
    pf = cli.main.commands["ingest"].commands["990pf"]
    assert {p.name for p in pf.params} >= {"limit", "refresh", "years"}
    bmf = cli.main.commands["ingest"].commands["bmf"]
    assert "refresh" in {p.name for p in bmf.params}
    boot = cli.main.commands["bootstrap"]
    profile = next(p for p in boot.params if p.name == "profile")
    assert set(profile.type.choices) == {"small", "full"}


def test_migrate_without_database_url_exits_cleanly(settings):
    r = CliRunner().invoke(cli.main, ["migrate", "--dry-run"])
    assert r.exit_code == 1
    assert "DATABASE_URL is not set" in r.output


def test_doctor_offline_has_no_failures(settings):
    checks = doctor.run_checks(settings)
    labels = [c.label for c in checks]
    for label in ("python", "uv", "migrations", "data dir", "disk", "SEC_USER_AGENT",
                  "VOYAGE_API_KEY", "DATABASE_URL"):
        assert label in labels
    assert not any(c.failed for c in checks), doctor.format_checks(checks)
    db = next(c for c in checks if c.label == "DATABASE_URL")
    assert db.status == "WARN" and "not set" in db.detail


def test_doctor_reports_unreachable_database():
    s = Settings(_env_file=None, database_url="postgresql://nobody@127.0.0.1:1/x")

    def connect():
        raise ConnectionRefusedError("connection refused")

    checks = doctor.check_database(s, connect=connect)
    assert checks[0].status == "FAIL" and "cannot connect" in checks[0].detail


def test_doctor_cli_exit_code(settings):
    r = CliRunner().invoke(cli.main, ["doctor"])
    assert r.exit_code == 0, r.output
    assert "all required checks passed" in r.output


def test_sec_user_agent_has_no_default():
    s = Settings(_env_file=None)
    assert s.sec_user_agent is None
    try:
        s.require_sec_user_agent()
    except RuntimeError as exc:
        assert "SEC_USER_AGENT" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
    assert "example.org" in Settings(_env_file=None, sec_user_agent="X y@example.org") \
        .require_sec_user_agent()
