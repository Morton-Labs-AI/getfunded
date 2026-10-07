"""CC-BY dataset export — the first public artifact.

The repo has always declared that "public dataset exports read ONLY from the
public.* views" (migration 0003:9-10) but had no command to produce one. This
is it, and it is deliberately the strictest consumer of the publishability
boundary: the seven boundary assertions run BEFORE any file is written, and a
single failure aborts the export with a nonzero exit. A broken boundary cannot
produce an artifact.

Format is CSV + gzip, not Parquet. Parquet writers embed library versions and
compression metadata in the file, so byte-identity varies across pyarrow
releases and hash-stability — the property that makes an export citable —
would be unattainable. Server-side COPY with a total ORDER BY is deterministic
given the same rows.

Hash stability depends on all four of these, and each has bitten someone:
  * a TOTAL order by on a unique key (row order is otherwise arbitrary)
  * timezone/DateStyle pinned on the session (locale leaks into timestamps)
  * NULL '' pinned in the COPY options
  * gzip mtime=0 (the default stamps the current time into the header, so no
    two runs would ever match)

Publication layout (versioned, atomic):

    data/export/<vintage>/            one immutable directory per run
    data/export/LATEST                text file naming the newest <vintage>

Files are written into ``data/export/.tmp-<vintage>/``; ``manifest.json`` is
written LAST; then the directory is renamed into place in one step. A reader
that sees a ``<vintage>/`` directory therefore always sees a complete export,
and an interrupted run leaves only a ``.tmp-*`` directory that the next run
can delete.

Record counts are CSV RECORDS, not newline bytes: ``purpose_text`` and the
Part XV free-text columns contain quoted newlines, and the earlier byte count
over-reported them (audit P2). :func:`count_csv_records` is a streaming
state machine over the COPY output that is exact for Postgres CSV.

Licensing is labelled PER SOURCE DATASET, not as one blanket string. Every
exported view carries ``source_dataset``; the manifest maps each dataset to
its licence from ``internal.licensing_map`` and lists, per file, the datasets
its rows derive from. The compilation (normalisation, entity resolution,
derived columns, curated seeds) is CC BY 4.0; accepting an upstream CC-BY or
ODbL source never relicenses that source.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import ledger, staging
from .config import get_settings
from .db import connect

COMPILATION_LICENSE = {
    "code": "cc_by",
    "name": "Creative Commons Attribution 4.0 International",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Open Funder Database contributors",
    "scope": ("the compilation: normalisation, crosswalks, entity resolution, derived "
              "columns and the curated seed files. Source records keep their own "
              "licence — see `licensing.sources`."),
}

# view -> (filename stem, total ORDER BY). The ORDER BY must be unique or the
# export is not reproducible.
TABLES: list[tuple[str, str, str]] = [
    ("public.organizations", "organizations", "id"),
    ("public.org_identifiers", "org_identifiers", "id"),
    ("public.funding_programs", "funding_programs", "id"),
    ("public.filings", "filings", "object_id"),
    ("public.filing_financials", "filing_financials", "object_id"),
    ("public.filing_officers", "filing_officers", "id"),
    ("public.filing_contributors", "filing_contributors", "id"),
    ("public.filing_application_info", "filing_application_info", "object_id"),
    ("public.org_application_posture", "org_application_posture", "org_id"),
    ("public.contact_channels", "contact_channels", "id"),
]

# funding_events is 14.5M rows — a single file is ~550MB gz that rewrites
# entirely on every export. Hive-style fiscal-year shards stay under ~60MB,
# glob natively in duckdb/pandas, and each is independently hash-stable.
EVENTS_VIEW = "public.funding_events"

# people and relationships are EXCLUDED from v1, and not for licensing
# reasons. filing_officers is a verbatim reproduction of a public IRS return
# line. internal.people is our DERIVED, entity-unresolved layer — the README
# states every person row is still per-source because the people ER precision
# gate has not certified. Publishing 1.05M unresolved person records is the
# first thing a critic would open. Re-entry condition: people ER certified.
EXCLUDED = {
    "people": "people entity resolution has not certified (Wilson low > 0.90, n >= 100)",
    "relationships": "derived edges over unresolved person endpoints",
}

BOUNDARY_ASSERTIONS: list[tuple[str, str, str]] = [
    ("X1",
     "every exported contact id is exactly an intended public row",
     """select count(*) from public.contact_channels p
        join internal.contact_channels c on c.id = p.id
        where c.publishability <> 'public' or c.privacy_tier = 'red'"""),
    ("X2",
     "no public contact originates from a non-republishable source",
     """select count(*) from internal.contact_channels c
        join internal.raw_files rf on rf.id = c.raw_file_id
        join internal.licensing_map lm on lm.license_code = rf.license_code
        where c.publishability = 'public' and not lm.republishable"""),
    ("X3",
     "no public email belongs to a named individual",
     """select count(*) from internal.contact_channels
        where publishability = 'public' and channel_type = 'email'
          and not is_role_based"""),
    ("X4",
     "public.filing_application_info exposes no email or phone column",
     """select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'filing_application_info'
          and column_name in ('email', 'phone')"""),
    ("X5",
     "every exported relation is a view in the public schema",
     """select count(*) from (values {names}) v(n)
        where not exists (
          select 1 from information_schema.views
          where table_schema = 'public' and table_name = v.n)"""),
    ("X6",
     "no exported view reads the non-republishable org_web_facts table",
     """select count(*) from information_schema.view_table_usage
        where view_schema = 'public' and table_name = 'org_web_facts'"""),
    ("X7",
     "public contact view row count equals the internal public row count",
     """select abs(
          (select count(*) from internal.contact_channels
           where publishability = 'public' and privacy_tier <> 'red')
          - (select count(*) from public.contact_channels))"""),
]


def _assert_boundary(cur) -> list[dict]:
    names = ", ".join(f"('{t[1]}')" for t in TABLES)
    out = []
    for aid, statement, sql in BOUNDARY_ASSERTIONS:
        cur.execute(sql.format(names=names))
        measured = int(cur.fetchone()[0])
        out.append({"id": aid, "statement": statement,
                    "result": "PASS" if measured == 0 else "FAIL",
                    "measured": measured})
    return out


# ---------------------------------------------------------------------------
# CSV record counting
# ---------------------------------------------------------------------------
def count_csv_records(chunk: bytes, in_quotes: bool = False) -> tuple[int, bool]:
    """Count CSV record terminators in ``chunk`` that are OUTSIDE quoted fields.

    Postgres CSV output quotes with ``"`` and escapes an embedded quote as
    ``""``, so quote state simply toggles on every ``"`` byte (the escape
    toggles twice and nets out). ``\\n`` inside quotes is field content;
    outside quotes it ends a record. Returns ``(records_ended, in_quotes)`` so
    the caller can carry state across chunk boundaries that fall mid-field.

    Implemented with C-level ``split``/``count`` rather than a per-byte loop:
    a chunk with no quote character at all costs one ``count``.
    """
    if not chunk:
        return 0, in_quotes
    if b'"' not in chunk:
        return (0 if in_quotes else chunk.count(b"\n")), in_quotes
    n = 0
    state = in_quotes
    for part in chunk.split(b'"'):
        if not state:
            n += part.count(b"\n")
        state = not state
    # split yields len(quotes)+1 parts; the final toggle above is one too many.
    return n, not state


def _write_csv_gz(cur, query: str, dest: Path) -> dict:
    """COPY a query to a deterministic .csv.gz. Returns file metadata."""
    raw = hashlib.sha256()
    records = 0
    in_quotes = False
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as fh:
        # mtime=0: gzip stamps the current time into the header by default,
        # which alone would make every run's hash differ.
        # filename="": GzipFile otherwise derives a name from fileobj.name and
        # writes it into the header (FNAME flag), so the recorded sha256 would
        # depend on what the file is CALLED, not only on what it contains —
        # a rename would silently invalidate a published hash. Verified: with
        # a name embedded, two writes of identical content to different
        # filenames produced different digests.
        with gzip.GzipFile(fileobj=fh, mode="wb", compresslevel=9, mtime=0,
                           filename="") as z:
            with cur.copy(
                f"copy ({query}) to stdout with (format csv, header true, null '')"
            ) as copy:
                for chunk in copy:
                    b = bytes(chunk)
                    raw.update(b)
                    n, in_quotes = count_csv_records(b, in_quotes)
                    records += n
                    z.write(b)
    if in_quotes:
        raise RuntimeError(f"{dest.name}: COPY stream ended inside a quoted field")
    rows = max(0, records - 1)  # minus the header record
    # psycopg >= 3.1 exposes the server's "COPY n" tag as rowcount; when it is
    # present it must agree with the CSV count or something is badly wrong.
    server_rows = getattr(cur, "rowcount", -1)
    if isinstance(server_rows, int) and server_rows >= 0 and server_rows != rows:
        raise RuntimeError(
            f"{dest.name}: CSV record count {rows} != server COPY count {server_rows}")
    return {
        "name": dest.name,
        "bytes": dest.stat().st_size,
        "rows": rows,
        "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(),
        "sha256_uncompressed": raw.hexdigest(),
    }


def _git_commit() -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True,
            cwd=Path(__file__).resolve().parents[2], timeout=10,
        ).stdout.strip() or None
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Versioned, atomic publication
# ---------------------------------------------------------------------------
def vintage_label(generated: datetime) -> str:
    """``20260807T153000Z`` — sorts lexically as chronologically, no colons
    (Windows-safe), explicit UTC."""
    return generated.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def publish(tmp_dir: Path, final_dir: Path, manifest: dict) -> Path:
    """Write ``manifest.json`` LAST into ``tmp_dir``, then rename it into place
    and point ``LATEST`` at it. The rename is the publish: no reader can
    observe a ``<vintage>/`` directory without its manifest.
    """
    if final_dir.exists():
        raise RuntimeError(f"export vintage already exists: {final_dir}")
    (tmp_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    tmp_dir.rename(final_dir)
    latest = final_dir.parent / "LATEST"
    latest_tmp = final_dir.parent / ".LATEST.tmp"
    latest_tmp.write_text(final_dir.name + "\n")
    os.replace(latest_tmp, latest)
    return final_dir


def _clean_stale_tmp(root: Path, echo=print) -> None:
    import shutil

    for p in root.glob(".tmp-*"):
        if p.is_dir():
            echo(f"  removing interrupted export {p.name}")
            shutil.rmtree(p, ignore_errors=True)


# ---------------------------------------------------------------------------
# Licensing per source
# ---------------------------------------------------------------------------
def _licensing_map(cur) -> dict[str, dict]:
    cur.execute("""select license_code, license_name, republishable,
                          attribution_required, license_url, notes
                   from internal.licensing_map order by license_code""")
    return {
        r[0]: {"license_code": r[0], "license_name": r[1], "republishable": bool(r[2]),
               "attribution_required": bool(r[3]), "license_url": r[4], "notes": r[5]}
        for r in cur.fetchall()
    }


def _dataset_licenses(cur) -> dict[str, list[str]]:
    """dataset_name -> licence codes seen on its registered raw files."""
    cur.execute("""select dataset_name, array_agg(distinct license_code order by license_code)
                   from internal.raw_files group by dataset_name order by dataset_name""")
    return {r[0]: list(r[1]) for r in cur.fetchall()}


def _view_sources(cur, view: str) -> list[str]:
    cur.execute(f"select distinct source_dataset from {view} order by 1")
    return [r[0] for r in cur.fetchall() if r[0]]


def build_licensing(licensing_map: dict[str, dict], dataset_licenses: dict[str, list[str]],
                    file_sources: dict[str, list[str]]) -> dict:
    """The manifest's ``licensing`` block, from pure inputs (unit-testable).

    ``file_sources`` maps a file name to the datasets its rows derive from.
    """
    used = sorted({ds for sources in file_sources.values() for ds in sources})
    sources = {}
    for ds in used:
        codes = dataset_licenses.get(ds, [])
        sources[ds] = {
            "license_codes": codes,
            "licenses": [licensing_map[c] for c in codes if c in licensing_map],
        }
    non_republishable = sorted(
        ds for ds, info in sources.items()
        if any(not lic["republishable"] for lic in info["licenses"]))
    return {
        "compilation": COMPILATION_LICENSE,
        "sources": sources,
        "non_republishable_sources_present": non_republishable,
        "note": ("A row's licence is the licence of its source dataset (`source_dataset` "
                 "column, mapped here). The compilation licence covers only the "
                 "project's own contribution. Accepting an attribution licence (cc_by, "
                 "odbl) upstream does not relicense that source under the compilation "
                 "licence; attribution_required sources must be credited by name."),
    }


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------
def run(out_dir: Path | None = None, verify_only: bool = False) -> dict:
    settings = get_settings()
    root = out_dir or (settings.data_root / "export")
    generated_dt = datetime.now(timezone.utc).replace(microsecond=0)
    generated = generated_dt.isoformat()
    vintage = vintage_label(generated_dt)
    tmp_out = root / f".tmp-{vintage}"
    final_out = root / vintage

    # One connection PER STREAM, not one for the run. The 2026-08-12 re-run
    # died twice with "SSL SYSCALL error: Operation timed out" mid-COPY — the
    # network path drops long-lived connections somewhere past the ~35-minute
    # mark regardless of activity (TCP keepalives did not save it), and a
    # full export holds a single connection ~75 minutes. Scoping a connection
    # to one COPY keeps every connection under the drop window and makes a
    # retry resume-shaped: completed shards are byte-identical on a re-run.
    #
    # The trade: streams no longer share one snapshot. That is acceptable
    # because the export doctrine already forbids concurrent bulk writes
    # ("don't run two exports at once", suite-vs-export contention), and the
    # boundary assertions re-run against live state immediately before the
    # first byte. If concurrent-write-during-export ever becomes real, the
    # fix is pg_export_snapshot() from a coordinator, not a return to the
    # single 75-minute connection.
    def _pinned(conn):
        cur = conn.cursor()
        cur.execute("set local statement_timeout = '60min'")
        # Locale and timezone leak into text output; pin both.
        cur.execute("set local timezone = 'UTC'")
        cur.execute("set local datestyle = 'ISO, MDY'")
        return cur

    with connect() as conn:
        with _pinned(conn) as cur:
            assertions = _assert_boundary(cur)
        conn.rollback()
    failed = [a for a in assertions if a["result"] == "FAIL"]
    for a in assertions:
        print(f"  {a['result']} {a['id']}  {a['statement']}"
              + (f"  (measured {a['measured']}, must be 0)" if a["measured"] else ""))
    if failed:
        raise SystemExit(
            f"\nBOUNDARY VIOLATION — {len(failed)} assertion(s) failed. "
            "No files written.")
    if verify_only:
        print("\nverify-only: boundary clean, 0 files written.")
        return {"assertions": assertions, "files": []}

    root.mkdir(parents=True, exist_ok=True)
    _clean_stale_tmp(root)
    tmp_out.mkdir()
    print(f"  writing {tmp_out} (published as {final_out.name} on success)", flush=True)

    files: list[dict] = []
    file_sources: dict[str, list[str]] = {}
    for view, stem, order in TABLES:
        with connect() as conn:
            with _pinned(conn) as cur:
                meta = _write_csv_gz(
                    cur, f"select * from {view} order by {order}",
                    tmp_out / f"{stem}.csv.gz")
                sources = _view_sources(cur, view)
            conn.rollback()
        meta.update({"view": view, "order_by": order, "sources": sources})
        file_sources[meta["name"]] = sources
        files.append(meta)
        print(f"  {meta['rows']:>10,}  {meta['name']}", flush=True)

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""select distinct fiscal_year from {EVENTS_VIEW}
                            order by fiscal_year nulls last""")
            years = [r[0] for r in cur.fetchall()]
            events_sources = _view_sources(cur, EVENTS_VIEW)
        conn.rollback()
    for fy in years:
        where = ("fiscal_year is null" if fy is None
                 else f"fiscal_year = {int(fy)}")
        label = "null" if fy is None else str(int(fy))
        with connect() as conn:
            with _pinned(conn) as cur:
                meta = _write_csv_gz(
                    cur,
                    f"select * from {EVENTS_VIEW} where {where} order by id",
                    tmp_out / "funding_events" / f"fy={label}.csv.gz")
            conn.rollback()
        name = f"funding_events/fy={label}.csv.gz"
        meta.update({"view": EVENTS_VIEW, "order_by": "id", "name": name,
                     "sources": events_sources})
        file_sources[name] = events_sources
        files.append(meta)
        print(f"  {meta['rows']:>10,}  {name}", flush=True)

    with connect() as conn:
        with conn.cursor() as cur:
            licensing_map = _licensing_map(cur)
            dataset_licenses = _dataset_licenses(cur)
            schema_version = _schema_version(cur)
        conn.rollback()

    licensing = build_licensing(licensing_map, dataset_licenses, file_sources)
    manifest = {
        "dataset": "open-funder-db",
        "vintage": vintage,
        "generated_at": generated,
        "generator": {"tool": "funderdb export public",
                      "git_commit": _git_commit(),
                      "schema_migration": schema_version},
        "license": {**COMPILATION_LICENSE,
                    "applies_to": "compilation only — see `licensing` for per-source terms"},
        "licensing": licensing,
        "excluded": EXCLUDED,
        "boundary_assertions": assertions,
        "files": files,
        "row_count_total": sum(f["rows"] for f in files),
        "row_count_method": "csv records (quoted newlines are field content), header excluded",
    }
    (tmp_out / "LICENSE").write_text(_license_text(licensing))
    (tmp_out / "README.md").write_text(_readme(manifest))
    publish(tmp_out, final_out, manifest)
    print(f"  published {final_out}", flush=True)

    # Register the run like every other pipeline artifact, so exports show up
    # in `funderdb status` with a hash and a ledger entry.
    with connect() as conn:
        staged = staging.stage_local("export_public", final_out / "manifest.json")
        rfid = staging.register_raw_file(
            conn, staged, license_code="cc_by", content_type="application/json")
        conn.commit()
        run_id = ledger.start_run(conn, rfid, "export_public")
        ledger.complete_run(
            conn, run_id, inserted=manifest["row_count_total"],
            notes=f"public export {vintage}: {len(files)} files, "
                  f"{manifest['row_count_total']:,} rows, all boundary assertions PASS")
    return manifest


def _schema_version(cur) -> str | None:
    """Newest applied migration: our own ledger first (funderdb migrate), then
    the Supabase CLI table for databases built before the runner existed.
    None when neither exists — a fork that cannot name its schema version
    still gets an export, just an honestly unlabelled one."""
    cur.execute("select to_regclass('internal.schema_migrations')")
    if cur.fetchone()[0] is not None:
        cur.execute("select max(filename) from internal.schema_migrations")
        v = cur.fetchone()[0]
        if v:
            return str(v)
    cur.execute("select to_regclass('supabase_migrations.schema_migrations')")
    if cur.fetchone()[0] is None:
        return None
    cur.execute("select max(version) from supabase_migrations.schema_migrations")
    v = cur.fetchone()[0]
    return str(v) if v else None


def _license_text(licensing: dict) -> str:
    comp = licensing["compilation"]
    lines = [
        "Open Funder Database — public dataset export",
        "",
        "COMPILATION LICENCE",
        f"The compilation ({comp['scope']})",
        f"is licensed under {comp['name']}:",
        "",
        f"    {comp['url']}",
        "",
        "You are free to share and adapt it for any purpose, including commercially,",
        "provided you give appropriate credit:",
        "",
        f"    {comp['attribution']}",
        "",
        "SOURCE LICENCES (per dataset; see manifest.json -> licensing.sources)",
    ]
    for ds, info in licensing["sources"].items():
        for lic in info["licenses"]:
            flag = "" if lic["republishable"] else "  [NOT republishable — must not appear here]"
            attr = "attribution required" if lic["attribution_required"] else "no attribution required"
            lines.append(f"    {ds:<28} {lic['license_name']} ({lic['license_code']}; {attr})"
                         f"{flag}")
    lines += [
        "",
        "A record's licence is the licence of its source dataset (the `source_dataset`",
        "column). U.S. Government works (IRS Form 990 series, SEC EDGAR/Form ADV/Form D,",
        "SBIR/STTR) are in the public domain. Accepting an attribution-licensed source",
        "upstream does not relicense it under the compilation licence.",
        "",
    ]
    return "\n".join(lines)


def _readme(m: dict) -> str:
    contacts = next((f for f in m["files"] if f["name"] == "contact_channels.csv.gz"), None)
    posture = next((f for f in m["files"] if f["name"] == "org_application_posture.csv.gz"), None)
    return f"""# Open Funder Database — public export {m['vintage']}

Generated {m['generated_at']} · schema migration {m['generator']['schema_migration']}
· {m['row_count_total']:,} rows across {len(m['files'])} files · compilation CC BY 4.0,
sources licensed individually (see `LICENSE` and `manifest.json` → `licensing`).

Every file is produced by `COPY` from a `public.*` view with a total
`ORDER BY`, gzipped with `mtime=0`, so **re-running the export byte-for-byte
reproduces these files**. `manifest.json` records both the compressed and the
uncompressed sha256 of each file, the CSV record count (quoted newlines are
field content, not records), and the source datasets each file derives from.

## The provenance contract

Every fact traces: dataset name -> source URL -> sha256-hashed immutable file
-> license code -> ingestion-ledger run. Nothing here was scraped from behind
a login, and nothing came from a commercial data vendor. Base tables live in a
private schema; these views are the publishability boundary, and seven
assertions are checked before a single byte is written.

## Things you must know to read this data honestly

**Application posture is tri-state, and `unknown` is not `closed`.**
`org_application_posture.application_posture` is `open`, `preselected_only`, or
`unknown`, read from Part XV of each organization's *latest parsed* Form
990-PF{f" ({posture['rows']:,} rows)" if posture else ""}. `unknown` means the
return carries no Part XV block — it is an absence of a statement, not a
refusal. Every grantmaking public charity is `unknown` because Form 990 has no
Part XV at all.

**Contacts are published only when they are role inboxes.**
{f"`contact_channels` holds {contacts['rows']:,} rows." if contacts else ""}
An address is published only when it is a role desk the foundation printed on
its own return for applicants (`grants@`, `info@`). Addresses belonging to a
named individual are withheld **by policy, not by absence** — they exist in the
source filings and in our private schema, and we do not republish them. Phone
numbers filed as application contacts are published.

**NULL is not zero.** In the financial tables a NULL means the line is absent
from the return; a `0` means the filer reported zero. Do not coalesce them.

**Amended returns supersede.** Where a foundation amended a return, the
amendment's figures are the live ones and the original carries
`superseded_by_object_id`. Filter it null for per-year aggregates.

**The IRS is authoritative.** Where our figures differ from a secondary
aggregator, we match the source XML. Absence from these files is sometimes
itself a finding (a $0-asset charity files the 990-N postcard, which carries
no financial data at all).

## Not included

{chr(10).join(f"- **{k}** — {v}" for k, v in m['excluded'].items())}

## Contributing corrections

Corrections are welcome and are held to the same standard as the pipeline: a
claim needs a source document. Open an issue citing the filing (its IRS
OBJECT_ID) or the public record that supports the change.
"""


if __name__ == "__main__":  # pragma: no cover
    sys.exit(0 if run(verify_only="--verify-only" in sys.argv) else 1)
