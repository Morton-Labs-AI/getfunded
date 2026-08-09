from __future__ import annotations

import click


@click.group()
def main() -> None:
    """Open Funder Database ingestion pipeline."""


@main.group()
def stage() -> None:
    """Download and hash-stage raw files (no database required)."""


@stage.command("bmf")
def stage_bmf() -> None:
    from .sources import irs_bmf

    for staged in irs_bmf.stage_files():
        click.echo(f"{staged.path.name}  {staged.byte_size:,} bytes  sha256={staged.sha256[:12]}")


@main.group()
def ingest() -> None:
    """Parse staged files and load them into the database."""


@ingest.command("bmf")
@click.option("--dry-run", is_flag=True, help="Parse and count locally; no database writes.")
@click.option("--limit", type=int, default=None, help="Dry-run: stop after N rows per file.")
@click.option("--all-orgs", is_flag=True,
              help="Full exempt-org spine: every BMF org, not just private foundations.")
def ingest_bmf(dry_run: bool, limit: int | None, all_orgs: bool) -> None:
    from .sources import irs_bmf

    if dry_run:
        counts = irs_bmf.dry_run(limit=limit)
        total = sum(counts.values())
        for fname, n in counts.items():
            click.echo(f"{fname}: {n:,} private-foundation rows")
        click.echo(f"TOTAL: {total:,}")
        return
    results = irs_bmf.ingest(all_orgs=all_orgs)
    for fname, r in results.items():
        click.echo(
            f"{fname}: inserted={r['inserted']:,} updated={r['updated']:,} "
            f"skipped={r['skipped']:,}"
        )


@ingest.command("adv")
def ingest_adv() -> None:
    from .sources import sec_adv

    r = sec_adv.ingest()
    click.echo(f"parsed={r['parsed']:,} inserted={r['inserted']:,} updated={r['updated']:,}")


@ingest.command("990pf")
@click.option("--year", "years", type=int, multiple=True, default=(2026, 2025))
def ingest_990pf(years: tuple[int, ...]) -> None:
    from .sources import irs_990pf

    totals = irs_990pf.ingest(years=years)
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


@ingest.command("filings")
@click.option("--year", "years", type=int, multiple=True,
              default=(2021, 2022, 2023, 2024, 2025, 2026))
def ingest_filings(years: tuple[int, ...]) -> None:
    """Filings spine from the annual index CSVs (no zips) + supersession sweep."""
    from .sources import irs_filings

    totals = irs_filings.ingest(years=years)
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("formd")
@click.option("--start", default="2024q1", help="First quarter to ingest (e.g. 2024q1).")
def ingest_formd(start: str) -> None:
    from .sources import sec_formd

    totals = sec_formd.ingest(start=start)
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("adv-schedules")
def ingest_adv_schedules() -> None:
    from .sources import sec_adv_schedules

    counts = sec_adv_schedules.ingest()
    for k, v in counts.items():
        click.echo(f"{k}: {v:,}")


@ingest.command("sbir")
def ingest_sbir() -> None:
    from .sources import sbir

    totals = sbir.ingest()
    for k, v in sorted(totals.items()):
        click.echo(f"{k}: {v:,}")


@ingest.command("seed")
def ingest_seed() -> None:
    from .sources import seed

    counts = seed.ingest()
    click.echo(
        f"agencies: +{counts['agencies_inserted']} / ~{counts['agencies_updated']}   "
        f"programs: +{counts['programs_inserted']} / ~{counts['programs_updated']}"
    )


@main.group()
def embed() -> None:
    """Semantic-search corpus: build docs + embed via Voyage."""


@embed.command("sync")
@click.option("--dry-run", is_flag=True, help="Build + count + cost estimate; no writes, no API.")
@click.option("--kind", "kinds", multiple=True,
              type=click.Choice(["foundation", "company", "adviser", "program"]))
@click.option("--rebuild", is_flag=True, help="Ignore hashes; re-embed everything.")
@click.option("--skip-index", is_flag=True,
              help="Embed but defer the HNSW build (tight disk; run again later to build it).")
def embed_sync(dry_run: bool, kinds: tuple[str, ...], rebuild: bool,
               skip_index: bool) -> None:
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


@main.group()
def resolve() -> None:
    """Entity resolution: funds -> people -> recipients."""


@resolve.command("funds")
@click.option("--predict", "do_predict", is_flag=True, help="Export, train, score, load links.")
@click.option("--apply", "do_apply", is_flag=True, help="Recompute the canonical map (gated on labels).")
@click.option("--threshold", type=float, default=0.20, show_default=True)
@click.option("--force", is_flag=True, help="Apply without the label gate (provisional).")
def resolve_funds(do_predict: bool, do_apply: bool, threshold: float, force: bool) -> None:
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
    from .resolve import labeling

    labeling.label(job, n, stratum)


@resolve.command("eval")
@click.argument("job", type=click.Choice(["funds", "people"]))
@click.option("--threshold", type=float, default=None,
              help="Classification threshold (defaults to the job's apply threshold).")
def resolve_eval(job: str, threshold: float | None) -> None:
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
@click.option("--max-tier", type=int, default=3, show_default=True)
def resolve_recipients(no_apply: bool, max_tier: int) -> None:
    from .resolve import recipients

    counts = recipients.run(apply=not no_apply, max_tier=max_tier)
    for k, v in counts.items():
        click.echo(f"{k}: {v:,}")


@main.group("eval")
def eval_group() -> None:
    """Benchmark suite v2: B-series SQL, E-series semantic, ER precision."""


@eval_group.command("sql")
def eval_sql() -> None:
    from . import evalsuite

    evalsuite.main("sql")


@eval_group.command("semantic")
def eval_semantic() -> None:
    from . import evalsuite

    evalsuite.main("semantic")


@eval_group.command("er")
def eval_er() -> None:
    from . import evalsuite

    evalsuite.main("er")


@eval_group.command("all")
def eval_all() -> None:
    from . import evalsuite

    evalsuite.main("all")


@eval_group.command("parity")
@click.option("--n", type=int, default=50, show_default=True)
def eval_parity(n: int) -> None:
    """ProPublica API spot-validation of filing financials (REPORT-only, network)."""
    import sys

    from . import evalsuite

    sys.exit(evalsuite.parity(n=n))


@main.command()
def status() -> None:
    """Ledger runs + row counts."""
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
              pg_size_pretty(pg_database_size(current_database())) as db_size
            """
        )
        c = cur.fetchone()
        assert c is not None
        click.echo(
            f"orgs={c[0]:,} identifiers={c[1]:,} programs={c[2]:,} "
            f"events={c[3]:,} people={c[4]:,} db={c[5]}"
        )


if __name__ == "__main__":
    main()
