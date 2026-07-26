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
def ingest_bmf(dry_run: bool, limit: int | None) -> None:
    from .sources import irs_bmf

    if dry_run:
        counts = irs_bmf.dry_run(limit=limit)
        total = sum(counts.values())
        for fname, n in counts.items():
            click.echo(f"{fname}: {n:,} private-foundation rows")
        click.echo(f"TOTAL: {total:,}")
        return
    results = irs_bmf.ingest()
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
def embed_sync(dry_run: bool, kinds: tuple[str, ...], rebuild: bool) -> None:
    from . import embed as embed_mod

    result = embed_mod.sync(list(kinds) or None, dry_run=dry_run, rebuild=rebuild)
    for kind, c in result["build"].items():
        click.echo(f"{kind}: {c['docs']:,} docs · {c['tokens']:,} tokens · ~${c['est_cost_usd']}")
        if "sample" in c:
            click.echo(f"  sample: {c['sample'][:300]}…")
    if "embed" in result:
        click.echo(f"embedded: {result['embed']['embedded']:,} docs "
                   f"({result['embed']['tokens']:,} tokens)")
        click.echo(f"hnsw created: {result['hnsw_created']}")


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
