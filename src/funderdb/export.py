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
"""

from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from . import ledger, staging
from .config import get_settings
from .db import connect

LICENSE = {
    "code": "cc_by",
    "name": "Creative Commons Attribution 4.0 International",
    "url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Open Funder Database (Morton Labs)",
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


def _write_csv_gz(cur, query: str, dest: Path) -> dict:
    """COPY a query to a deterministic .csv.gz. Returns file metadata."""
    raw = hashlib.sha256()
    gz = hashlib.sha256()
    rows = 0
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
                    rows += b.count(b"\n")
                    z.write(b)
    return {
        "name": dest.name,
        "bytes": dest.stat().st_size,
        "rows": max(0, rows - 1),  # minus the header line
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


def run(out_dir: Path | None = None, verify_only: bool = False) -> dict:
    settings = get_settings()
    out = out_dir or (settings.data_root / "export" / "public")
    generated = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("set local statement_timeout = '60min'")
            # Locale and timezone leak into text output; pin both.
            cur.execute("set local timezone = 'UTC'")
            cur.execute("set local datestyle = 'ISO, MDY'")

            assertions = _assert_boundary(cur)
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

            files: list[dict] = []
            for view, stem, order in TABLES:
                meta = _write_csv_gz(
                    cur, f"select * from {view} order by {order}",
                    out / f"{stem}.csv.gz")
                meta.update({"view": view, "order_by": order})
                files.append(meta)
                print(f"  {meta['rows']:>10,}  {meta['name']}")

            cur.execute(f"""select distinct fiscal_year from {EVENTS_VIEW}
                            order by fiscal_year nulls last""")
            years = [r[0] for r in cur.fetchall()]
            for fy in years:
                where = ("fiscal_year is null" if fy is None
                         else f"fiscal_year = {int(fy)}")
                label = "null" if fy is None else str(int(fy))
                meta = _write_csv_gz(
                    cur,
                    f"select * from {EVENTS_VIEW} where {where} order by id",
                    out / "funding_events" / f"fy={label}.csv.gz")
                meta.update({"view": EVENTS_VIEW, "order_by": "id",
                             "name": f"funding_events/fy={label}.csv.gz"})
                files.append(meta)
                print(f"  {meta['rows']:>10,}  funding_events/fy={label}.csv.gz")

            cur.execute("""select license_code, license_name, republishable,
                                  attribution_required, license_url
                           from internal.licensing_map
                           where republishable order by license_code""")
            upstream = [
                {"license_code": r[0], "license_name": r[1], "republishable": r[2],
                 "attribution_required": r[3], "license_url": r[4]}
                for r in cur.fetchall()
            ]
            # supabase_migrations.schema_migrations is created by the Supabase
            # CLI, not by any migration in this repo — so a fork on vanilla
            # Postgres has no such table and could not produce its own export.
            # Degrade to an unknown version rather than crashing: a fork that
            # cannot re-export cannot verify our hashes against its own build.
            cur.execute("select to_regclass('supabase_migrations.schema_migrations')")
            if cur.fetchone()[0] is None:
                schema_version = None
            else:
                cur.execute(
                    "select max(version) from supabase_migrations.schema_migrations")
                schema_version = cur.fetchone()[0]
        conn.rollback()

    manifest = {
        "dataset": "open-funder-db",
        "generated_at": generated,
        "generator": {"tool": "funderdb export public",
                      "git_commit": _git_commit(),
                      "schema_migration": schema_version},
        "license": LICENSE,
        "upstream_licenses": upstream,
        "excluded": EXCLUDED,
        "boundary_assertions": assertions,
        "files": files,
        "row_count_total": sum(f["rows"] for f in files),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (out / "LICENSE").write_text(_license_text())
    (out / "README.md").write_text(_readme(manifest))

    # Register the run like every other pipeline artifact, so exports show up
    # in `funderdb status` with a hash and a ledger entry.
    with connect() as conn:
        staged = staging.stage_local("export_public", out / "manifest.json")
        rfid = staging.register_raw_file(
            conn, staged, license_code="cc_by", content_type="application/json")
        conn.commit()
        run_id = ledger.start_run(conn, rfid, "export_public")
        ledger.complete_run(
            conn, run_id, inserted=manifest["row_count_total"],
            notes=f"public export: {len(files)} files, "
                  f"{manifest['row_count_total']:,} rows, all boundary assertions PASS")
    return manifest


def _license_text() -> str:
    return (
        "Open Funder Database — public dataset export\n"
        f"Copyright (c) Morton Labs\n\n"
        "This dataset is licensed under the Creative Commons Attribution 4.0\n"
        "International License (CC BY 4.0).\n\n"
        f"    {LICENSE['url']}\n\n"
        "You are free to share and adapt the material for any purpose, including\n"
        "commercially, provided you give appropriate credit:\n\n"
        f"    {LICENSE['attribution']}\n\n"
        "The underlying source records are U.S. Government works (IRS Form 990\n"
        "series, SEC EDGAR/Form ADV/Form D, SBIR/STTR) and are in the public\n"
        "domain. The compilation, normalization, entity resolution and derived\n"
        "columns are the licensed contribution.\n"
    )


def _readme(m: dict) -> str:
    contacts = next((f for f in m["files"] if f["name"] == "contact_channels.csv.gz"), None)
    posture = next((f for f in m["files"] if f["name"] == "org_application_posture.csv.gz"), None)
    return f"""# Open Funder Database — public export

Generated {m['generated_at']} · schema migration {m['generator']['schema_migration']}
· {m['row_count_total']:,} rows across {len(m['files'])} files · CC BY 4.0.

Every file is produced by `COPY` from a `public.*` view with a total
`ORDER BY`, gzipped with `mtime=0`, so **re-running the export byte-for-byte
reproduces these files**. `manifest.json` records both the compressed and the
uncompressed sha256 of each file.

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
