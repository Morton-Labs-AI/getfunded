from __future__ import annotations

import sys
import time as _time
from datetime import date

import click
from pathlib import Path

_REFRESH_HELP = ("Re-check the upstream feed even if a cached copy is younger than its "
                 "max-age (conditional request; a new vintage is staged only if the bytes changed).")


@click.group(context_settings={"help_option_names": ["-h", "--help"]})
def main() -> None:
    """Open Funder Database ingestion pipeline.

    Start with `funderdb doctor`, then `funderdb bootstrap --profile small`.
    Every `ingest` command stages its raw files under data/raw/<dataset>/
    with a sha256 prefix before loading, and records the run in the ledger.
    """


# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
@main.command()
def doctor() -> None:
    """Check Python, uv, extensions, DATABASE_URL reachability and disk space."""
    from .config import get_settings
    from .doctor import format_checks, run_checks

    checks = run_checks(get_settings())
    click.echo(format_checks(checks))
    failed = [c for c in checks if c.failed]
    if failed:
        click.echo(f"\n{len(failed)} check(s) FAILED — see docs/SELF-INSTALL.md")
        raise SystemExit(1)
    click.echo("\nall required checks passed")


@main.command()
@click.option("--dry-run", is_flag=True, help="Print the plan; apply nothing.")
@click.option("--to", "to", default=None, metavar="NNNN",
              help="Stop after this migration number (inclusive).")
@click.option("--force", is_flag=True,
              help="Re-run files whose sha256 changed since they were applied, and re-record them.")
@click.option("--baseline", default=None, metavar="NNNN",
              help="Record files <= NNNN as applied WITHOUT running them (for a database "
                   "whose schema was built by hand before the runner existed).")
def migrate(dry_run: bool, to: str | None, force: bool, baseline: str | None) -> None:
    """Apply migrations/*.sql in order, recording each in internal.schema_migrations."""
    from . import migrate as mig
    from .config import get_settings
    from .db import connect

    settings = get_settings()
    try:
        with connect() as conn:
            if baseline:
                n = mig.baseline(conn, mig.discover(settings.migrations_dir), baseline,
                                 echo=click.echo)
                click.echo(f"baselined {n} migration(s) through {baseline}")
            mig.run(conn, settings.migrations_dir, to=to, force=force, dry_run=dry_run,
                    echo=click.echo)
    except (mig.MigrationError, RuntimeError) as exc:
        click.echo(f"\nerror: {exc}", err=True)
        raise SystemExit(1)


@main.command()
@click.option("--profile", type=click.Choice(["small", "full"]), default="small",
              show_default=True,
              help="small: BMF foundations + seed + one 990-PF index year with --limit filings "
                   "(laptop, < 1 hour). full: every source, every year (days, ~250 GB).")
@click.option("--limit", type=int, default=2000, show_default=True,
              help="Small profile: maximum 990-PF filings to parse.")
@click.option("--year", type=int, default=None,
              help="Small profile: 990-PF index year (default: newest published).")
@click.option("--skip-migrate", is_flag=True, help="Assume the schema is already current.")
@click.option("--refresh", is_flag=True, help=_REFRESH_HELP)
@click.pass_context
def bootstrap(ctx: click.Context, profile: str, limit: int, year: int | None,
              skip_migrate: bool, refresh: bool) -> None:
    """One-command self-install: check env, migrate, run a sized ingest, print status."""
    from .config import get_settings
    from .doctor import check_database, check_voyage, format_checks

    settings = get_settings()
    if not settings.database_url:
        click.echo("DATABASE_URL is not set. Copy .env.example to .env and fill it in "
                   "(docs/SELF-INSTALL.md walks through it).", err=True)
        raise SystemExit(1)
    env_checks = check_database(settings) + [check_voyage(settings)]
    click.echo(format_checks(env_checks))
    if any(c.failed for c in env_checks):
        raise SystemExit(1)
    if profile == "full":
        try:
            settings.require_sec_user_agent()
        except RuntimeError as exc:
            click.echo(f"\n{exc}", err=True)
            raise SystemExit(1)

    steps: list[tuple[str, callable]] = []
    if not skip_migrate:
        steps.append(("migrate", lambda: ctx.invoke(migrate)))
    steps.append(("ingest seed", lambda: ctx.invoke(ingest_seed)))

    if profile == "small":
        from .sources import irs_990pf

        pf_year = year or _newest_index_year(irs_990pf, refresh=refresh)
        steps += [
            ("ingest bmf (private foundations)",
             lambda: ctx.invoke(ingest_bmf, refresh=refresh)),
            (f"ingest filings --year {pf_year}",
             lambda: ctx.invoke(ingest_filings, years=(pf_year,), refresh=refresh)),
            (f"ingest 990pf --year {pf_year} --limit {limit}",
             lambda: ctx.invoke(ingest_990pf, years=(pf_year,), limit=limit, refresh=refresh)),
        ]
    else:
        steps += [
            ("ingest bmf --all-orgs", lambda: ctx.invoke(ingest_bmf, all_orgs=True, refresh=refresh)),
            ("ingest filings", lambda: ctx.invoke(ingest_filings, refresh=refresh)),
            ("ingest 990pf", lambda: ctx.invoke(ingest_990pf, refresh=refresh)),
            ("ingest 990pf-detail", lambda: ctx.invoke(ingest_990pf_detail)),
            ("ingest 990", lambda: ctx.invoke(ingest_990)),
            ("ingest 990-detail", lambda: ctx.invoke(ingest_990_detail)),
            ("ingest websites", lambda: ctx.invoke(ingest_websites)),
            ("ingest adv", lambda: ctx.invoke(ingest_adv, refresh=refresh)),
            ("ingest formd", lambda: ctx.invoke(ingest_formd)),
            ("ingest sbir", lambda: ctx.invoke(ingest_sbir, refresh=refresh)),
            ("contacts sync-part-xv", lambda: ctx.invoke(contacts_sync_part_xv)),
        ]
    steps.append(("status", lambda: ctx.invoke(status)))

    total = len(steps)
    t_start = _time.monotonic()
    for i, (label, fn) in enumerate(steps, 1):
        click.echo(f"\n[{i}/{total}] {label}", err=False)
        t0 = _time.monotonic()
        fn()
        click.echo(f"[{i}/{total}] done in {_fmt_secs(_time.monotonic() - t0)}")
    click.echo(f"\nbootstrap ({profile}) complete in {_fmt_secs(_time.monotonic() - t_start)}")


def _fmt_secs(s: float) -> str:
    m, sec = divmod(int(s), 60)
    h, m = divmod(m, 60)
    return f"{h}h{m:02d}m{sec:02d}s" if h else f"{m}m{sec:02d}s"


def _newest_index_year(irs_990pf, refresh: bool) -> int:
    """The newest 990 index year the IRS has published (current year, else the
    previous one in early January before the new index exists)."""
    import httpx

    y = date.today().year
    for candidate in (y, y - 1):
        try:
            irs_990pf.stage_index(candidate, refresh=refresh)
            return candidate
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code != 404:
                raise
    raise click.ClickException(f"no 990 index CSV published for {y} or {y - 1}")


# ---------------------------------------------------------------------------
# Staging (no database)
# ---------------------------------------------------------------------------
@main.group()
def stage() -> None:
    """Download and hash-stage raw files (no database required)."""


@stage.command("bmf")
@click.option("--refresh", is_flag=True, help=_REFRESH_HELP)
def stage_bmf(refresh: bool) -> None:
    """Download the four IRS EO BMF region CSVs (eo1-eo4) into data/raw."""
    from .sources import irs_bmf

    for staged in irs_bmf.stage_files(refresh=refresh):
        click.echo(f"{staged.path.name}  {staged.byte_size:,} bytes  sha256={staged.sha256[:12]}"
                   f"  vintage={staged.vintage_date}  {'cached' if staged.from_cache else 'fetched'}")


# ---------------------------------------------------------------------------
# Ingest
# ---------------------------------------------------------------------------
@main.group()
def ingest() -> None:
    """Parse staged files and load them into the database."""


@ingest.command("bmf")
@click.option("--dry-run", is_flag=True, help="Parse and count locally; no database writes.")
@click.option("--limit", type=int, default=None, help="Dry-run: stop after N rows per file.")
@click.option("--all-orgs", is_flag=True,
              help="Full exempt-org spine: every BMF org, not just private foundations.")
@click.option("--refresh", is_flag=True, help=_REFRESH_HELP)
def ingest_bmf(dry_run: bool, limit: int | None, all_orgs: bool, refresh: bool) -> None:
    """IRS Exempt Organizations Business Master File: the organization spine."""
    from .sources import irs_bmf

    if dry_run:
        counts = irs_bmf.dry_run(limit=limit)
        total = sum(counts.values())
        for fname, n in counts.items():
            click.echo(f"{fname}: {n:,} private-foundation rows")
        click.echo(f"TOTAL: {total:,}")
        return
    results = irs_bmf.ingest(all_orgs=all_orgs, refresh=refresh)
    for fname, r in results.items():
        click.echo(
            f"{fname}: inserted={r['inserted']:,} updated={r['updated']:,} "
            f"skipped={r['skipped']:,}  vintage={r['vintage']}"
            f"{' (cached)' if r['from_cache'] else ''}"
        )


@ingest.command("adv")
@click.option("--feed-date", type=click.DateTime(formats=["%Y-%m-%d"]), default=None,
              help="Stage and load this day's IA_FIRM_SEC_Feed (default: newest).")
@click.option("--refresh", is_flag=True,
              help="Fetch the newest available feed even if a recent one is staged.")
@click.option("--max-age-days", type=int, default=7, show_default=True,
              help="Reuse a staged feed this many days old before fetching a newer one.")
def ingest_adv(feed_date, refresh: bool, max_age_days: int) -> None:
    """SEC Form ADV daily firm feed: registered + exempt-reporting advisers."""
    from datetime import timedelta

    from .sources import sec_adv

    r = sec_adv.ingest(feed_date.date() if feed_date else None, refresh=refresh,
                       max_age=timedelta(days=max_age_days))
    click.echo(f"feed_date={r['feed_date']} parsed={r['parsed']:,} inserted={r['inserted']:,} "
               f"updated={r['updated']:,}{' (cached)' if r['from_cache'] else ''}")


@ingest.command("990pf")
@click.option("--year", "years", type=int, multiple=True, default=(2026, 2025),
              show_default=True)
@click.option("--limit", type=int, default=None,
              help="Stop after N filings this run (resumable; used by bootstrap --profile small).")
@click.option("--refresh", is_flag=True, help=_REFRESH_HELP + " Applies to the index CSV.")
def ingest_990pf(years: tuple[int, ...], limit: int | None, refresh: bool) -> None:
    """990-PF officers + grants from the IRS bulk XML zips (index-driven)."""
    from .sources import irs_990pf

    totals = irs_990pf.ingest(years=years, limit=limit, refresh=refresh)
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("990pf-detail")
@click.option("--year", "years", type=int, multiple=True, default=(2026, 2025, 2024))
@click.option("--dry-run", is_flag=True,
              help="Parse staged zips + per-returnVersion FIN_FIELDS coverage "
                   "histogram; no DB writes, no downloads.")
@click.option("--limit", type=int, default=None,
              help="Dry-run: stop after N filings scanned.")
def ingest_990pf_detail(years: tuple[int, ...], dry_run: bool, limit: int | None) -> None:
    """990-PF financials/officers/Schedule B/how-to-apply from staged zips.

    Never inserts grant rows (those stay behind the G2 disk gate) — upgrades
    already-known filings with the detail tables and header columns.
    """
    from .sources import irs_990pf

    totals = (irs_990pf.dry_run_details(years=years, limit=limit)
              if dry_run else irs_990pf.reparse_details(years=years))
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("990")
@click.option("--year", "years", type=int, multiple=True, default=(2026, 2025))
@click.option("--dry-run", is_flag=True,
              help="Measure Schedule I prevalence over already-staged zips; "
                   "no DB writes, no downloads.")
@click.option("--limit", type=int, default=None,
              help="Dry-run: stop after N filings scanned.")
def ingest_990(years: tuple[int, ...], dry_run: bool, limit: int | None) -> None:
    """Public-charity 990 Schedule I grants (shares the 990-PF staging)."""
    from .sources import irs_990_sched_i

    totals = (irs_990_sched_i.dry_run(years=years, limit=limit)
              if dry_run else irs_990_sched_i.ingest(years=years))
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("990-detail")
@click.option("--year", "years", type=int, multiple=True, default=(2026, 2025, 2024))
def ingest_990_detail(years: tuple[int, ...]) -> None:
    """Form 990 core-form financials for public charities, from staged zips.

    Revenue, expenses, balance sheet, the Part IX program-vs-admin expense
    split, and Part VII officer compensation. Newest-first, resumable, never
    downloads and never touches grant rows (Schedule I is a separate pass).
    """
    from .sources import irs_990_detail

    totals = irs_990_detail.reparse_details(years=years)
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("websites")
@click.option("--year", "years", type=int, multiple=True,
              default=(2026, 2025, 2024, 2023, 2022, 2021))
@click.option("--dry-run", is_flag=True,
              help="Measure website yield over already-staged zips; "
                   "no DB writes, no downloads.")
@click.option("--limit", type=int, default=None,
              help="Dry-run: stop after N filings parsed.")
def ingest_websites(years: tuple[int, ...], dry_run: bool, limit: int | None) -> None:
    """Filer-stated websites (WebsiteAddressTxt) from staged 990/990-PF XML.

    First-party public-domain data, republishable, flows to the export.
    Both form types in one sweep; idempotent via filings.website_parsed_at.
    """
    from .sources import irs_990_websites

    totals = (irs_990_websites.dry_run(years=years, limit=limit)
              if dry_run else irs_990_websites.ingest(years=years))
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("irs-standing")
@click.option("--only", type=click.Choice(["revocation", "pub78"]), default=None,
              help="Load one list only. Standing stays empty until BOTH lists are loaded.")
@click.option("--dry-run", is_flag=True,
              help="Download, hash, parse and count both lists; needs no database, "
                   "writes nothing to it.")
@click.option("--report", "show_report", is_flag=True,
              help="Read-only: private foundations per IRS standing, and how many "
                   "automatically revoked foundations still say they accept applications.")
@click.option("--refresh", is_flag=True, help=_REFRESH_HELP)
@click.option("--allow-shrink", is_flag=True,
              help="Load a file even when it holds under 90% of the rows now loaded "
                   "(refused by default: it usually means a cut-off file).")
def ingest_irs_standing(only: str | None, dry_run: bool, show_report: bool,
                        refresh: bool, allow_shrink: bool) -> None:
    """IRS standing: the automatic revocation list and Publication 78.

    Loads every row of both IRS lists as a full snapshot (one transaction per
    list), so internal.org_irs_standing can say whether the IRS still lists an
    organization. Every EIN on the two lists is loaded, known to the database
    or not, so an ingest that adds organizations later needs no second run.
    """
    from .sources import irs_standing

    if dry_run and show_report:
        raise click.UsageError("--dry-run and --report cannot be used together.")
    try:
        if dry_run:
            irs_standing.dry_run(only=only, refresh=refresh)
        elif show_report:
            irs_standing.report()
        else:
            irs_standing.ingest(only=only, refresh=refresh, allow_shrink=allow_shrink)
    except irs_standing.LayoutError as exc:
        # The file is not what the loader expects. Nothing was loaded.
        click.echo(f"error: {exc}", err=True)
        raise SystemExit(1)


@ingest.command("filings")
@click.option("--year", "years", type=int, multiple=True,
              default=(2021, 2022, 2023, 2024, 2025, 2026))
@click.option("--refresh", is_flag=True, help=_REFRESH_HELP + " Applies to the index CSVs.")
def ingest_filings(years: tuple[int, ...], refresh: bool) -> None:
    """Filings spine from the annual index CSVs (no zips) + supersession sweep."""
    from .sources import irs_filings

    totals = irs_filings.ingest(years=years, refresh=refresh)
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("formd")
@click.option("--start", default="2024q1", show_default=True,
              help="First quarter to ingest (e.g. 2024q1).")
def ingest_formd(start: str) -> None:
    """SEC Form D quarterly data sets: Reg D offerings, issuers, related persons."""
    from .sources import sec_formd

    totals = sec_formd.ingest(start=start)
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("adv-schedules")
def ingest_adv_schedules() -> None:
    """SEC Form ADV monthly filing zips: Schedule A/B owners + 7.B.1 private funds."""
    from .sources import sec_adv_schedules

    counts = sec_adv_schedules.ingest()
    for k, v in counts.items():
        click.echo(f"{k}: {v:,}")


@ingest.command("sbir")
@click.option("--refresh", is_flag=True, help=_REFRESH_HELP)
def ingest_sbir(refresh: bool) -> None:
    """SBIR/STTR award data: federal non-dilutive awards to small businesses."""
    from .sources import sbir

    totals = sbir.ingest(refresh=refresh)
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("seed")
def ingest_seed() -> None:
    """Curated federal agencies + funding programs from data/seed/*.csv."""
    from .sources import seed

    counts = seed.ingest()
    click.echo(
        f"agencies: +{counts['agencies_inserted']} / ~{counts['agencies_updated']}   "
        f"programs: +{counts['programs_inserted']} / ~{counts['programs_updated']}"
    )


# ---------------------------------------------------------------------------
# Backfill (older index years, one zip at a time)
# ---------------------------------------------------------------------------
@main.command()
@click.option("--years", default="2020,2019,2018,2017", show_default=True,
              help="Index years to backfill, comma-separated, in the order to run them.")
@click.option("--forms", default="990pf", show_default=True,
              help="990pf, or 990pf,990 to also load Form 990 core financials and "
                   "Schedule I grants from the same zips.")
@click.option("--min-free-gb", type=float, default=6.0, show_default=True,
              help="Refuse to start a download that would leave less free disk than this.")
@click.option("--limit-zips", type=int, default=None,
              help="Stop after N zips have been processed in this run.")
@click.option("--discard-zips", is_flag=True,
              help="Delete each local zip after its ledger row is written. The raw_files "
                   "row keeps the sha256 and source URL, with a note that the copy can be "
                   "fetched again.")
@click.option("--dry-run", is_flag=True,
              help="Plan only: list the zips, their sizes, what is already complete and "
                   "the free disk. Downloads nothing, writes nothing, needs no database.")
@click.option("--resume/--no-resume", default=True, show_default=True,
              help="Skip zips the ledger already marks complete for these forms.")
@click.option("--finish", is_flag=True,
              help="Run the four follow-up steps at the end instead of printing them.")
@click.option("--indexed-only", is_flag=True,
              help="Load only returns that an index CSV lists. By default returns that are "
                   "in a zip but in no index (about 47,750 990-PFs in the 2020 zips) are "
                   "loaded too, read from their own header.")
@click.option("--parse-only", "parse_only_zip", type=click.Path(exists=True, dir_okay=False),
              default=None,
              help="Parse this already-downloaded zip and print counts and the "
                   "per-returnVersion coverage histogram. No database, no zip download.")
@click.option("--limit", type=int, default=None,
              help="--parse-only: stop after N returns.")
@click.option("--prefetch", type=int, default=0, show_default=True,
              help="Download up to N zips ahead while the current one loads (one "
                   "connection to the IRS host at a time). Each one waits on disk "
                   "until its turn, so allow about 0.4 GB per zip.")
def backfill(years: str, forms: str, min_free_gb: float, limit_zips: int | None,
             discard_zips: bool, dry_run: bool, resume: bool, finish: bool,
             indexed_only: bool, parse_only_zip: str | None, limit: int | None,
             prefetch: int) -> None:
    """Backfill older IRS index years, one zip at a time, safely on a small disk.

    For each zip: stage it (resume + sha256), load the 990-PF grants,
    financials, officers, Schedule B, Part XV and websites it holds, write one
    ledger row, and (with --discard-zips) delete the local copy. After a
    year's last zip the amended-return sweep runs for that year. The expensive
    follow-up steps are printed at the end; --finish runs them. Re-running a
    finished year adds no rows.
    """
    from pathlib import Path

    from . import backfill as bf

    try:
        year_list = bf.parse_years(years)
        form_list = bf.parse_forms(forms)
    except ValueError as exc:
        raise click.UsageError(str(exc))

    if parse_only_zip:
        explicit = click.get_current_context().get_parameter_source("years").name != "DEFAULT"
        try:
            bf.parse_only(Path(parse_only_zip), form_list,
                          year=year_list[0] if explicit else None, limit=limit,
                          include_unindexed=not indexed_only, echo=click.echo)
        except ValueError as exc:
            raise click.UsageError(str(exc))
        return

    try:
        result = bf.run(year_list, form_list, min_free_gb=min_free_gb, limit_zips=limit_zips,
                        discard_zips=discard_zips, dry_run=dry_run, resume=resume,
                        finish=finish, include_unindexed=not indexed_only,
                        prefetch=max(0, prefetch), echo=click.echo)
    except RuntimeError as exc:
        click.echo(f"\nerror: {exc}", err=True)
        raise SystemExit(1)
    if result.get("stopped") == "disk":
        raise SystemExit(2)


# ---------------------------------------------------------------------------
# Repair (fill a value an older parser left empty, from the original zips)
# ---------------------------------------------------------------------------
@main.group()
def repair() -> None:
    """Repair values that an older version of a parser left empty.

    A repair reads the original source file again and fills only what is
    empty. It never changes a value that is already there.
    """


@repair.command("qualifying-distributions")
@click.option("--years", default="2021,2022,2023", show_default=True,
              help="Object-id years of the returns to repair (the first four digits of "
                   "the object id), comma-separated.")
@click.option("--also-look-in", "also_look_in", multiple=True,
              type=click.Path(exists=True, file_okay=False),
              help="An extra folder that may hold the zips (for example the raw folder of "
                   "an older clone). It is only read: nothing in it is changed or deleted. "
                   "Can be given more than once.")
@click.option("--min-free-gb", type=float, default=6.0, show_default=True,
              help="Refuse to start a download that would leave less free disk than this.")
@click.option("--limit-zips", type=int, default=None,
              help="Stop after N zips have been repaired in this run.")
@click.option("--discard-zips", is_flag=True,
              help="Delete a zip after its ledger row is written, but only a zip this "
                   "command downloaded. A zip that was already on disk is never deleted.")
@click.option("--prefetch", type=int, default=0, show_default=True,
              help="Get up to N zips ahead while the current one is repaired (one "
                   "connection to the IRS host at a time).")
@click.option("--dry-run", is_flag=True,
              help="Plan only: the zips, their sizes, the returns to repair in each, what "
                   "is on this machine, the total download and the free disk. Reads the "
                   "database, writes nothing, downloads nothing.")
@click.option("--resume/--no-resume", default=True, show_default=True,
              help="Skip zips the ledger already marks complete for this repair.")
def repair_qualifying_distributions(years: str, also_look_in: tuple[str, ...],
                                    min_free_gb: float, limit_zips: int | None,
                                    discard_zips: bool, prefetch: int, dry_run: bool,
                                    resume: bool) -> None:
    """Fill qualifying distributions on 990-PF returns loaded before the Part XII fix.

    Returns of version 2018v3, 2019v5 and 2020v4 name Part XII differently,
    and an older parser left the amount empty on them. This reads those
    returns again from the zip each one was loaded from, and fills the amount
    where it is empty. A return that states no amount stays empty. Run
    `funderdb refresh-views` afterwards. Running it twice changes nothing.
    """
    from pathlib import Path

    from . import backfill as bf
    from . import repair as repair_mod

    try:
        year_list = bf.parse_years(years)
    except ValueError as exc:
        raise click.UsageError(str(exc))
    try:
        result = repair_mod.run(
            year_list, also_look_in=tuple(Path(d) for d in also_look_in),
            min_free_gb=min_free_gb, limit_zips=limit_zips, discard_zips=discard_zips,
            dry_run=dry_run, resume=resume, prefetch=max(0, prefetch), echo=click.echo)
    except RuntimeError as exc:
        click.echo(f"\nerror: {exc}", err=True)
        raise SystemExit(1)
    if result.get("stopped") == "disk":
        raise SystemExit(2)


@main.command("refresh-views")
def refresh_views() -> None:
    """Rebuild the materialized views the app reads (after a backfill or ingest)."""
    from . import backfill as bf

    t0 = _time.monotonic()
    bf.refresh_views()
    click.echo(f"materialized views refreshed in {_fmt_secs(_time.monotonic() - t0)}")


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------
@main.group()
def contacts() -> None:
    """Contact channels: tiered load + publication audit.

    Its own group, not `ingest`: this derives from already-ingested rows, and
    the only surface in the database that can publish a contact deserves an
    audit command sitting next to its loader.
    """


@contacts.command("sync-part-xv")
@click.option("--dry-run", is_flag=True,
              help="Classify and count only; writes nothing.")
@click.option("--sample", "sample_n", type=int, default=None,
              help="Dry-run: also print N sampled role-based (publishable) rows.")
@click.option("--sample-named", is_flag=True,
              help="With --sample, show the NAMED (withheld) bucket instead.")
def contacts_sync_part_xv(dry_run: bool, sample_n: int | None,
                          sample_named: bool) -> None:
    """990-PF Part XV application contacts -> contact_channels, tiered.

    Role-based inboxes (grants@) publish; named individuals (jane_doe@) stay
    internal-only. Idempotent — a re-run re-tiers rows this loader owns, so a
    classifier correction can DOWNGRADE a published row.
    """
    from .sources import part_xv_contacts

    if dry_run:
        for k, v in part_xv_contacts.project().items():
            click.echo(f"{k}: {v:,}")
        if sample_n:
            bucket = "NAMED (withheld)" if sample_named else "ROLE-BASED (publishable)"
            click.echo(f"\n-- {sample_n} sampled {bucket} rows --")
            for email, contact, org, state in part_xv_contacts.sample(
                    sample_n, role=not sample_named):
                click.echo(f"{email:<44} {(contact or '')[:26]:<26} "
                           f"{(org or '')[:34]:<34} {state or ''}")
        return
    for k, v in part_xv_contacts.sync().items():
        click.echo(f"{k}: {v:,}")


@contacts.command("audit")
def contacts_audit() -> None:
    """Publication invariants. Every count must be 0."""
    from .sources import part_xv_contacts

    failed = 0
    for label, n in part_xv_contacts.audit():
        status_ = "OK  " if n == 0 else "FAIL"
        if n:
            failed += 1
        click.echo(f"{status_} {n:>8,}  {label}")
    if failed:
        raise SystemExit(1)


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------
@main.group()
def embed() -> None:
    """Semantic-search corpus: build docs + embed via Voyage (needs VOYAGE_API_KEY)."""


@embed.command("sync")
@click.option("--dry-run", is_flag=True, help="Build + count + cost estimate; no writes, no API.")
@click.option("--kind", "kinds", multiple=True,
              type=click.Choice(["foundation", "company", "adviser", "program"]))
@click.option("--rebuild", is_flag=True, help="Ignore hashes; re-embed everything.")
@click.option("--skip-index", is_flag=True,
              help="Embed but defer the HNSW build (tight disk; run again later to build it).")
def embed_sync(dry_run: bool, kinds: tuple[str, ...], rebuild: bool,
               skip_index: bool) -> None:
    """Rebuild aggregate documents and embed the ones whose hash changed."""
    from . import embed as embed_mod

    result = embed_mod.sync(list(kinds) or None, dry_run=dry_run, rebuild=rebuild,
                            skip_index=skip_index)
    for kind, c in result["build"].items():
        click.echo(f"{kind}: {c['docs']:,} docs · {c['tokens']:,} tokens · ~${c['est_cost_usd']}")
        if "sample" in c:
            click.echo(f"  sample: {c['sample'][:300]}…")
    if "embed" in result:
        click.echo(f"embedded: {result['embed']['embedded']:,} docs "
                   f"({result['embed']['tokens']:,} tokens)")
        click.echo(f"hnsw created: {result['hnsw_created']}")


# ---------------------------------------------------------------------------
# Entity resolution
# ---------------------------------------------------------------------------
@main.group()
def resolve() -> None:
    """Entity resolution: funds -> people -> recipients."""


@resolve.command("funds")
@click.option("--predict", "do_predict", is_flag=True, help="Export, train, score, load links.")
@click.option("--apply", "do_apply", is_flag=True, help="Recompute the canonical map (gated on labels).")
@click.option("--threshold", type=float, default=0.20, show_default=True)
@click.option("--force", is_flag=True, help="Apply without the label gate (provisional).")
def resolve_funds(do_predict: bool, do_apply: bool, threshold: float, force: bool) -> None:
    """Link ADV private-fund records to Form D issuers (Splink)."""
    from .resolve import funds

    if not (do_predict or do_apply):
        raise click.UsageError("Pass --predict and/or --apply.")
    if do_predict:
        for k, v in funds.predict().items():
            click.echo(f"{k}: {v:,}")
    if do_apply:
        for k, v in funds.apply(threshold=threshold, force=force).items():
            click.echo(f"{k}: {v:,}")


@resolve.command("backfill-overlap")
def resolve_backfill_overlap() -> None:
    """Compute people_overlap on existing exact-name funds links (idempotent).

    A full `resolve funds --predict` does this too, but re-predicting reloads
    every pending row and would invalidate an in-flight labeling sample. This
    touches only the features column on auto/pending rows.
    """
    from .db import connect
    from .resolve import funds

    with connect() as conn, conn.cursor() as cur:
        counts = funds.backfill_people_overlap(cur)
        conn.commit()
    for k, v in counts.items():
        click.echo(f"{k}: {v:,}")


@resolve.command("people")
@click.option("--predict", "do_predict", is_flag=True, help="Export, train, score, load links.")
@click.option("--apply", "do_apply", is_flag=True, help="Recompute the canonical map (gated on labels).")
@click.option("--threshold", type=float, default=0.99, show_default=True)
@click.option("--force", is_flag=True,
              help="On --predict: run without the funds canonical map (recall-only "
                   "degradation). On --apply: skip the label gate (provisional).")
def resolve_people(do_predict: bool, do_apply: bool, threshold: float, force: bool) -> None:
    """Dedupe people across sources (org-evidence-gated auto-merge)."""
    from .resolve import people

    if not (do_predict or do_apply):
        raise click.UsageError("Pass --predict and/or --apply.")
    if do_predict:
        for k, v in people.predict(force=force).items():
            click.echo(f"{k}: {v:,}")
    if do_apply:
        for k, v in people.apply(threshold=threshold, force=force).items():
            click.echo(f"{k}: {v:,}")


@resolve.command("label")
@click.argument("job", type=click.Choice(["funds", "people"]))
@click.option("--n", type=int, default=40, show_default=True)
@click.option("--stratum", default=None,
              help="Sampling stratum (job-specific; defaults to the gate stratum).")
def resolve_label(job: str, n: int, stratum: str | None) -> None:
    """Interactively label a fixed-n sample of candidate pairs for a job."""
    from .resolve import labeling

    labeling.label(job, n, stratum)


@resolve.command("eval")
@click.argument("job", type=click.Choice(["funds", "people"]))
@click.option("--threshold", type=float, default=None,
              help="Classification threshold (defaults to the job's apply threshold).")
def resolve_eval(job: str, threshold: float | None) -> None:
    """Precision gate for a job from its human labels (Wilson lower bound)."""
    from .resolve import labeling

    labeling.eval_job(job, threshold)


@resolve.command("export-labels")
def resolve_export_labels() -> None:
    """Export internal.er_labels to data/seed/er_labels/<job>.csv (CC-BY)."""
    from .resolve import labeling

    for job, n in labeling.export_labels().items():
        click.echo(f"{job}: {n:,} labels exported")


@resolve.command("status")
def resolve_status() -> None:
    """Per-job link counts, label counts, gate progress, canonical totals."""
    from .resolve import labeling

    labeling.status_report()


@resolve.command("recipients")
@click.option("--no-apply", is_flag=True, help="Compute matches without touching funding_events.")
@click.option("--max-tier", type=int, default=None, metavar="N",
              help="Highest tier to compute. Without this flag tiers 1 to 3 are computed and "
                   "tiers 1 and 2 are applied, as this command has always done. An explicit "
                   "`--max-tier 3` also APPLIES the tier3 matches, which were stored but never "
                   "applied before; read the tier3 lines of `resolve aliases --report` first.")
def resolve_recipients(no_apply: bool, max_tier: int | None) -> None:
    """Resolve grant recipients to organizations by EIN / name+state tiers."""
    from .resolve import recipients

    counts = recipients.run(apply=not no_apply,
                            max_tier=3 if max_tier is None else max_tier,
                            apply_tier3=max_tier is not None and max_tier >= 3)
    for k, v in counts.items():
        click.echo(f"{k}: {v:,}")


@resolve.command("aliases")
@click.option("--build", "do_build", is_flag=True,
              help="Derive the alias rows from Schedule I filers. Writes the alias table only.")
@click.option("--report", "do_report", is_flag=True,
              help="Print the stored counts and the last build's notes. Read only, seconds.")
@click.option("--apply", "do_apply", is_flag=True,
              help="Link 990-PF grant rows of the strict class and record every link.")
@click.option("--unapply", "do_unapply", is_flag=True,
              help="Remove every link --apply made, only where the link is still ours.")
@click.option("--min-filers", type=int, default=3, show_default=True,
              help="Fewest independent filers an alias needs to be applied (never below 3).")
@click.option("--dry-run", is_flag=True,
              help="With --build, --apply or --unapply: count and print, write nothing.")
@click.option("--sample", "sample_n", type=int, default=None, metavar="N",
              help="Write N random would-be links of the strict class to --out as CSV, for an "
                   "independent audit before --apply. Read only.")
@click.option("--out", "out_path", type=click.Path(dir_okay=False), default=None, metavar="FILE",
              help="CSV file for --sample.")
@click.option("--seed", type=int, default=20261008, show_default=True,
              help="Seed for --sample. The same seed on the same data gives the same file.")
def resolve_aliases(do_build: bool, do_report: bool, do_apply: bool, do_unapply: bool,
                    min_filers: int, dry_run: bool, sample_n: int | None,
                    out_path: str | None, seed: int) -> None:
    """Link 990-PF grant recipients through names other filers wrote with an EIN.

    A 990-PF names a recipient but gives no EIN. Charities that file Schedule I
    do write the EIN. When 3 or more of them wrote the same name and state with
    one EIN, and the city on the 990-PF row matches, --apply links that row to
    the same organization. Order: --build, --report, --sample, --apply.
    """
    from pathlib import Path

    from .resolve import aliases

    if not (do_build or do_report or do_apply or do_unapply or sample_n is not None):
        raise click.UsageError(
            "Pass --build, --report, --sample N --out FILE, --apply or --unapply.")
    if do_apply and do_unapply:
        raise click.UsageError("--apply and --unapply cannot run together.")
    if (sample_n is None) != (out_path is None):
        raise click.UsageError("--sample N and --out FILE go together.")
    try:
        if do_build:
            click.echo("build (dry run, nothing stored)" if dry_run else "build")
            for k, v in aliases.build(dry_run=dry_run).items():
                click.echo(f"{k}: {v:,}")
        if sample_n is not None and out_path is not None:
            click.echo(f"sample -> {out_path} (seed {seed})")
            for k, v in aliases.sample(sample_n, Path(out_path), seed,
                                       min_filers=min_filers).items():
                click.echo(f"{k}: {v:,}")
        if do_apply:
            click.echo("apply (dry run, nothing written)" if dry_run else "apply")
            for k, v in aliases.apply(min_filers=min_filers, dry_run=dry_run).items():
                click.echo(f"{k}: {v:,}")
        if do_unapply:
            click.echo("unapply (dry run, nothing written)" if dry_run else "unapply")
            for k, v in aliases.unapply(dry_run=dry_run).items():
                click.echo(f"{k}: {v:,}")
    except ValueError as exc:
        raise click.UsageError(str(exc)) from exc
    if do_report:
        click.echo(aliases.report(min_filers=min_filers))


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
@main.group()
def export() -> None:
    """Public dataset export (compilation CC BY 4.0; sources licensed per dataset)."""


@export.command("public")
@click.option("--out", "out_dir", type=click.Path(), default=None,
              help="Export ROOT; each run publishes data/export/<vintage>/ under it "
                   "(default data/export).")
@click.option("--verify-only", is_flag=True,
              help="Run the boundary assertions and write nothing.")
def export_public(out_dir: str | None, verify_only: bool) -> None:
    """Export the public.* views as a hash-stable, versioned CSV dataset.

    The seven publishability assertions run FIRST; a single failure aborts
    with a nonzero exit and writes no files. Files land in a temporary
    directory, manifest.json is written last, and the directory is renamed
    into place (atomic publish). `LATEST` names the newest vintage.
    """
    from pathlib import Path

    from . import export as export_mod

    m = export_mod.run(Path(out_dir) if out_dir else None, verify_only=verify_only)
    if not verify_only:
        click.echo(f"\n{m['row_count_total']:,} rows across {len(m['files'])} files"
                   f" -> vintage {m['vintage']}")


@export.command("foundations")
@click.option("--out", "out_dir", type=click.Path(file_okay=False), required=True,
              help="Folder to publish into. Each run writes DIR/<vintage>/ and updates "
                   "DIR/LATEST.")
@click.option("--limit", type=int, default=None,
              help="Write only the first N foundations by EIN (a sample for checking). "
                   "A sample run keeps every query under 20 seconds.")
@click.option("--no-ledger", is_flag=True,
              help="Do not register the run in raw_files and the ledger. Use it with a "
                   "read-only database role.")
@click.option("--statement-timeout", default=None, metavar="TEXT",
              help="Statement timeout for the export queries [default: 20s with --limit, "
                   "60min without].")
@click.option("--tag", default=None, metavar="NAME",
              help="Name of the data release, for example data-2026-10-08. "
                   "Needed with --release-json.")
@click.option("--release-json", "release_json", type=click.Path(dir_okay=False), default=None,
              metavar="FILE",
              help="After a successful export, write the JSON the website reads "
                   "(apps/web/content/data-release.json): the tag, the vintage and, for "
                   "each CSV file, its download link, size, sha256 and row count.")
def export_foundations(out_dir: str, limit: int | None, no_ledger: bool,
                       statement_timeout: str | None, tag: str | None,
                       release_json: str | None) -> None:
    """The Open Foundation List: small CSV files of U.S. private foundations.

    Writes foundations.csv.gz (one row per foundation), foundation_years.csv.gz
    (one row per foundation and fiscal year), one foundation_grants_<year>.csv.gz
    for each fiscal year (one row per grant whose recipient is linked to an
    organization record; other grants are counted, not named), README.md,
    LICENSE.txt and manifest.json. Reads only the public.* views and checks
    that before it writes a byte. `export public` is not changed by this
    command.
    """
    from pathlib import Path

    import psycopg

    from . import export_foundations as ef

    try:
        m = ef.run(Path(out_dir), limit=limit, no_ledger=no_ledger,
                   statement_timeout=statement_timeout, tag=tag,
                   release_json=Path(release_json) if release_json else None,
                   echo=click.echo)
    except psycopg.errors.QueryCanceled as exc:
        click.echo(f"\nerror: {exc}\nA query reached the time limit and nothing was published. "
                   "On a busy database the first run can be slow because the data is not in "
                   "memory yet. Run the command again, or give --statement-timeout.", err=True)
        raise SystemExit(1)
    except (RuntimeError, ValueError, psycopg.Error) as exc:
        click.echo(f"\nerror: {exc}", err=True)
        raise SystemExit(1)
    click.echo("\n" + ", ".join(f"{f['name']} {f['rows']:,} rows" for f in m["files"])
               + f" -> vintage {m['vintage']}")


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------
@main.group("eval")
def eval_group() -> None:
    """Benchmark suite v2: B-series SQL, E-series semantic, ER precision."""


@eval_group.command("sql")
def eval_sql() -> None:
    """Run the B-series SQL benchmarks from benchmarks/queries.sql."""
    from . import evalsuite

    evalsuite.main("sql")


@eval_group.command("semantic")
def eval_semantic() -> None:
    """Run the E-series semantic/hybrid-search benchmarks (needs embeddings)."""
    from . import evalsuite

    evalsuite.main("semantic")


@eval_group.command("er")
def eval_er() -> None:
    """Run the entity-resolution precision floors."""
    from . import evalsuite

    evalsuite.main("er")


@eval_group.command("all")
def eval_all() -> None:
    """Run every benchmark series."""
    from . import evalsuite

    evalsuite.main("all")


@eval_group.command("parity")
@click.option("--n", type=int, default=50, show_default=True)
def eval_parity(n: int) -> None:
    """ProPublica API spot-validation of filing financials (REPORT-only, network)."""
    from . import evalsuite

    sys.exit(evalsuite.parity(n=n))


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------
@main.command()
def status() -> None:
    """Recent ledger runs + row counts + database size."""
    from .db import connect

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select dataset_name, status, started_at, rows_inserted, rows_updated, rows_skipped
            from internal.ingestion_ledger order by id desc limit 15
            """
        )
        rows = cur.fetchall()
        if not rows:
            click.echo("ledger: empty")
        for r in rows:
            click.echo(f"{r[2]:%Y-%m-%d %H:%M}  {r[0]:<24} {r[1]:<10} "
                       f"+{r[3]:,} ~{r[4]:,} !{r[5]:,}")
        cur.execute(
            """
            select
              (select count(*) from internal.organizations)   as orgs,
              (select count(*) from internal.org_identifiers) as identifiers,
              (select count(*) from internal.funding_programs) as programs,
              (select count(*) from internal.funding_events)  as events,
              (select count(*) from internal.people)          as people,
              (select count(*) from internal.filings)         as filings,
              pg_size_pretty(pg_database_size(current_database())) as db_size
            """
        )
        c = cur.fetchone()
        assert c is not None
        click.echo(
            f"orgs={c[0]:,} identifiers={c[1]:,} programs={c[2]:,} "
            f"events={c[3]:,} people={c[4]:,} filings={c[5]:,} db={c[6]}"
        )


# ---------------------------------------------------------------------------
# Derived facts (counts from rows already in the database)
# ---------------------------------------------------------------------------
@main.group()
def derive() -> None:
    """Counts computed from rows already in the database. No download, no model."""


@derive.command("turnover")
@click.option("--fy", "fys", type=int, multiple=True,
              help="Target fiscal year; repeat for several [default: 2023 2024 2025].")
@click.option("--slice", "slices", type=click.IntRange(0, 255), multiple=True, metavar="N",
              help="Run only slice N of 256 (foundations whose id starts with byte N); "
                   "repeat for several. Slice 117 is the 1.45-million-row one.")
@click.option("--dry-run", is_flag=True,
              help="Compute and print, write nothing (slices 0 and 1 unless --slice is given).")
@click.option("--report", "do_report", is_flag=True,
              help="Print dated counts from the stored rows and the posture history view.")
@click.option("--restart", is_flag=True,
              help="Full run only: ignore the cursor file and begin at slice 0.")
def derive_turnover(fys: tuple[int, ...], slices: tuple[int, ...], dry_run: bool,
                    do_report: bool, restart: bool) -> None:
    """Named grant recipients of a fiscal year that are on none of the same
    foundation's lists for the three years before (Form 990-PF only).

    A count from past returns: it does not say a foundation will consider a
    new request. A foundation gets a row only when it has named grant rows in
    the target year and in each of the three years before. Each slice deletes
    its old rows and inserts the new ones, so a re-run is safe.
    """
    from .derive import turnover

    try:
        if do_report:
            turnover.report(echo=click.echo)
            return
        counts = turnover.run(fys=fys or turnover.DEFAULT_FYS, slices=slices or None,
                              dry_run=dry_run, restart=restart, echo=click.echo)
    except RuntimeError as exc:
        click.echo(f"\nerror: {exc}", err=True)
        raise SystemExit(1)
    for k, v in counts.items():
        click.echo(f"{k}: {v:,}")


@derive.command("org-address")
@click.option("--dry-run", is_flag=True,
              help="Read and print what --apply (or --unapply) would change. Writes nothing. "
                   "For --apply it also works before migration 0030 is applied.")
@click.option("--apply", "do_apply", is_flag=True,
              help="Write street, city, state and zip from the newest parsed, non-superseded "
                   "return, only where the organization has no address at all.")
@click.option("--unapply", "do_unapply", is_flag=True,
              help="Set street, city, state and zip back to empty exactly where "
                   "address_basis is 'filing_header', and clear the two columns.")
@click.option("--report", "do_report", is_flag=True,
              help="Print dated counts: organizations with no state, how many have a usable "
                   "return address, and the rows an --apply has written. Read only.")
@click.option("--slice", "slices", type=click.IntRange(0, 255), multiple=True, metavar="N",
              help="Work on slice N of 256 only (organizations whose id starts with byte N); "
                   "repeat for several.")
def derive_org_address(dry_run: bool, do_apply: bool, do_unapply: bool, do_report: bool,
                       slices: tuple[int, ...]) -> None:
    """Address as stated on the latest return, for organizations that have none.

    An organization created from an e-filed return and not in the IRS master
    file has no city or state, so it cannot be found by state. Every return
    carries the filer's own address. --apply copies it from the newest parsed,
    non-superseded return when that address is in the United States, and marks
    the row (address_basis 'filing_header', address_object_id). A row that has
    any part of an address is never changed. A second --apply changes 0 rows.
    Order: --dry-run, --apply, --report.
    """
    from .derive import org_address

    if do_apply and do_unapply:
        raise click.UsageError("--apply and --unapply cannot run together.")
    if not (dry_run or do_apply or do_unapply or do_report):
        raise click.UsageError("Pass --dry-run, --apply, --unapply or --report.")
    try:
        if dry_run or do_apply or do_unapply:
            counts = org_address.run(action="unapply" if do_unapply else "apply",
                                     slices=slices or None, dry_run=dry_run,
                                     echo=click.echo)
            for k, v in counts.items():
                click.echo(f"{k}: {v:,}")
        if do_report:
            if dry_run or do_apply or do_unapply:
                click.echo("")
            org_address.report(echo=click.echo)
    except RuntimeError as exc:
        click.echo(f"\nerror: {exc}", err=True)
        raise SystemExit(1)



# ---------------------------------------------------------------------------
# signals — dated, sourced funder news (migration 0032; src/funderdb/signals/)
# ---------------------------------------------------------------------------
@main.group()
def signals() -> None:
    """Funder signals: press releases and announcements, classified and org-linked."""


@signals.command("load-sources")
@click.option("--csv", "csv_path", type=click.Path(exists=True, path_type=Path),
              default=Path("data/seed/signal_sources.csv"), show_default=True)
def signals_load_sources(csv_path: Path) -> None:
    """Load/refresh the watch list (data/seed/signal_sources.csv) into internal.signal_sources."""
    from .signals import pipeline

    for k, v in pipeline.load_sources(csv_path).items():
        click.echo(f"{k}: {v:,}")


@signals.command("add")
@click.argument("url")
@click.option("--ein", default=None, help="EIN of the funder the page is about (links the org).")
@click.option("--by", "submitted_by", default="cli", show_default=True,
              help="Who found it, e.g. human:zach.")
@click.option("--note", default=None, help="How it was found (\"LinkedIn post by the MD\").")
def signals_add(url: str, ein: str | None, submitted_by: str, note: str | None) -> None:
    """Record one announcement URL as a candidate signal (processed by `signals process`)."""
    from .signals import pipeline

    out = pipeline.add_url(url, ein=ein, submitted_by=submitted_by, note=note)
    for k, v in out.items():
        click.echo(f"{k}: {v}")
    if ein and not out.get("org_id"):
        click.echo("warning: EIN did not resolve in internal.org_identifiers; signal is unlinked",
                   err=True)


@signals.command("add-urls")
@click.option("--csv", "csv_path", type=click.Path(exists=True, path_type=Path),
              default=Path("data/seed/signal_urls.csv"), show_default=True)
def signals_add_urls(csv_path: Path) -> None:
    """Record every URL in a curated CSV (url, org_ein, submitted_by, discovery_note)."""
    from .signals import pipeline

    for k, v in pipeline.add_urls_from_csv(csv_path).items():
        click.echo(f"{k}: {v:,}")


@signals.command("poll")
@click.option("--source", "slug", default=None, help="Only this source slug.")
@click.option("--dry-run", is_flag=True, help="Fetch and list discovered links; write nothing.")
@click.option("--force", is_flag=True, help="Ignore fetch_interval_hours.")
@click.option("--max-items", type=int, default=50, show_default=True)
def signals_poll(slug: str | None, dry_run: bool, force: bool, max_items: int) -> None:
    """Fetch every due source (feed or index page) and record new links as candidates."""
    from .signals import pipeline

    for k, v in pipeline.poll(slug, dry_run=dry_run, force=force, max_items=max_items).items():
        click.echo(f"{k}: {v:,}")


@signals.command("process")
@click.option("--limit", type=int, default=20, show_default=True)
@click.option("--id", "signal_id", type=int, default=None, help="Only this signal id.")
@click.option("--dry-run", is_flag=True, help="Fetch + classify, print the decision, write nothing.")
@click.option("--auto-publish", is_flag=True,
              help="Publish high/medium-relevance rows at or above --min-confidence "
                   "(live model only; reviewed_by = model:<id>).")
@click.option("--min-confidence", type=float, default=0.85, show_default=True)
def signals_process(limit: int, signal_id: int | None, dry_run: bool, auto_publish: bool,
                    min_confidence: float) -> None:
    """Fetch, snapshot, classify and org-link candidates that have not been processed."""
    from .signals import pipeline

    out = pipeline.process(limit, dry_run=dry_run, auto_publish=auto_publish,
                           min_confidence=min_confidence, signal_id=signal_id)
    for k, v in out.items():
        click.echo(f"{k}: {v:,}")


@signals.command("publish")
@click.argument("ids", nargs=-1, type=int)
@click.option("--all-confident", is_flag=True,
              help="Publish every org-linked candidate with relevance high/medium at or above "
                   "--min-confidence (live model only).")
@click.option("--min-confidence", type=float, default=0.85, show_default=True)
@click.option("--by", "reviewed_by", default="human:cli", show_default=True)
def signals_publish(ids: tuple[int, ...], all_confident: bool, min_confidence: float,
                    reviewed_by: str) -> None:
    """Publish candidates by id, or every confident one. Published rows reach public.funder_signals."""
    from .signals import pipeline

    n = 0
    if ids:
        n += pipeline.set_status(list(ids), "published", reviewed_by=reviewed_by)
    if all_confident:
        n += pipeline.publish_confident(min_confidence, reviewed_by=reviewed_by)
    click.echo(f"published: {n:,}")


@signals.command("reject")
@click.argument("ids", nargs=-1, type=int, required=True)
@click.option("--by", "reviewed_by", default="human:cli", show_default=True)
@click.option("--note", default=None)
def signals_reject(ids: tuple[int, ...], reviewed_by: str, note: str | None) -> None:
    """Reject candidates by id (kept for audit; never shown anywhere)."""
    from .signals import pipeline

    click.echo(f"rejected: {pipeline.set_status(list(ids), 'rejected', reviewed_by=reviewed_by, note=note):,}")


@signals.command("status")
def signals_status() -> None:
    """Counts by status, source health, and the last runs."""
    import json as _json

    from .signals import pipeline

    click.echo(_json.dumps(pipeline.status(), indent=2))

if __name__ == "__main__":
    main()
