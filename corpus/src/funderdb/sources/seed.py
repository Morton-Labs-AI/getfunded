"""Hand-curated federal agencies + funding programs seed.

Input: data/seed/federal_agencies.csv and data/seed/federal_programs.csv —
Morton-Labs-curated (license cc_by, our original compilation). Staged as raw
files like every other source; no row exists without a hashed artifact.

Idempotency: agencies upsert on (org_type='gov_agency', name_normalized);
programs upsert on source_record_key = 'seed:<slug>'.
"""

from __future__ import annotations

import csv
import json
from pathlib import Path

from .. import ledger, staging
from ..db import connect
from ..normalize import normalize_name

DATASET_AGENCIES = "seed_federal_agencies"
DATASET_PROGRAMS = "seed_federal_programs"
AGENCIES_CSV = Path("data/seed/federal_agencies.csv")
PROGRAMS_CSV = Path("data/seed/federal_programs.csv")


def _num(value: str) -> float | None:
    v = (value or "").strip().replace(",", "").replace("$", "")
    return float(v) if v else None


def _bool(value: str) -> bool:
    return (value or "").strip().lower() in ("true", "yes", "1", "y")


def ingest() -> dict[str, int]:
    counts = {"agencies_inserted": 0, "agencies_updated": 0,
              "programs_inserted": 0, "programs_updated": 0}

    with connect() as conn:
        # ---- agencies ----
        staged_a = staging.stage_local(DATASET_AGENCIES, AGENCIES_CSV)
        rfid_a = staging.register_raw_file(
            conn, staged_a, license_code="cc_by", content_type="text/csv",
            meta={"curated_by": "Morton Labs"},
        )
        conn.commit()
        run_a = ledger.start_run(conn, rfid_a, DATASET_AGENCIES)
        slug_to_org: dict[str, str] = {}
        try:
            with AGENCIES_CSV.open(encoding="utf-8") as fh, conn.cursor() as cur:
                for row in csv.DictReader(fh):
                    slug = row["slug"].strip()
                    name = row["name"].strip()
                    norm = normalize_name(name)
                    locator = f"row:slug={slug}"
                    cur.execute(
                        """
                        select id from internal.organizations
                        where org_type = 'gov_agency' and name_normalized = %s
                        """,
                        (norm,),
                    )
                    hit = cur.fetchone()
                    if hit:
                        cur.execute(
                            """
                            update internal.organizations
                            set name = %s, website = %s, city = %s, state = %s,
                                thesis_text = %s, focus_areas = %s,
                                raw_file_id = %s, source_record_locator = %s,
                                raw_source = %s, last_verified_at = now()
                            where id = %s returning id
                            """,
                            (name, row.get("website") or None, row.get("city") or None,
                             row.get("state") or None, row.get("description") or None,
                             [s.strip() for s in (row.get("focus_areas") or "").split(";") if s.strip()],
                             rfid_a, locator, json.dumps(row), hit[0]),
                        )
                        counts["agencies_updated"] += 1
                        slug_to_org[slug] = str(hit[0])
                    else:
                        cur.execute(
                            """
                            insert into internal.organizations
                              (name, name_normalized, org_type, website, city, state,
                               thesis_text, focus_areas,
                               raw_file_id, source_record_locator, raw_source, last_verified_at)
                            values (%s, %s, 'gov_agency', %s, %s, %s, %s, %s, %s, %s, %s, now())
                            returning id
                            """,
                            (name, norm, row.get("website") or None, row.get("city") or None,
                             row.get("state") or None, row.get("description") or None,
                             [s.strip() for s in (row.get("focus_areas") or "").split(";") if s.strip()],
                             rfid_a, locator, json.dumps(row)),
                        )
                        fetched = cur.fetchone()
                        assert fetched is not None
                        counts["agencies_inserted"] += 1
                        slug_to_org[slug] = str(fetched[0])
            conn.commit()
            ledger.complete_run(conn, run_a,
                                inserted=counts["agencies_inserted"],
                                updated=counts["agencies_updated"])
        except Exception as exc:
            conn.rollback()
            ledger.fail_run(conn, run_a, f"{type(exc).__name__}: {exc}")
            raise

        # ---- programs ----
        staged_p = staging.stage_local(DATASET_PROGRAMS, PROGRAMS_CSV)
        rfid_p = staging.register_raw_file(
            conn, staged_p, license_code="cc_by", content_type="text/csv",
            meta={"curated_by": "Morton Labs"},
        )
        conn.commit()
        run_p = ledger.start_run(conn, rfid_p, DATASET_PROGRAMS)
        try:
            with PROGRAMS_CSV.open(encoding="utf-8") as fh, conn.cursor() as cur:
                for row in csv.DictReader(fh):
                    slug = row["slug"].strip()
                    org_id = slug_to_org.get(row["agency_slug"].strip())
                    if org_id is None:
                        raise ValueError(f"program {slug!r}: unknown agency_slug "
                                         f"{row['agency_slug']!r}")
                    cur.execute(
                        """
                        insert into internal.funding_programs
                          (administering_org_id, name, program_type, program_code,
                           description, eligibility, award_floor, award_ceiling,
                           non_dilutive, funds_lab_not_company, status, url,
                           source_record_key, raw_file_id, source_record_locator, raw_source)
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                %s, %s, %s, %s)
                        on conflict (source_record_key) do update set
                          administering_org_id = excluded.administering_org_id,
                          name = excluded.name,
                          program_type = excluded.program_type,
                          program_code = excluded.program_code,
                          description = excluded.description,
                          eligibility = excluded.eligibility,
                          award_floor = excluded.award_floor,
                          award_ceiling = excluded.award_ceiling,
                          non_dilutive = excluded.non_dilutive,
                          funds_lab_not_company = excluded.funds_lab_not_company,
                          status = excluded.status,
                          url = excluded.url,
                          raw_file_id = excluded.raw_file_id,
                          raw_source = excluded.raw_source
                        returning (xmax = 0) as inserted
                        """,
                        (org_id, row["name"].strip(), row["program_type"].strip(),
                         row.get("program_code") or None,
                         row.get("description") or None, row.get("eligibility") or None,
                         _num(row.get("award_floor", "")), _num(row.get("award_ceiling", "")),
                         _bool(row.get("non_dilutive", "true")),
                         _bool(row.get("funds_lab_not_company", "")),
                         (row.get("status") or "unknown").strip(),
                         row.get("url") or None,
                         f"seed:{slug}", rfid_p, f"row:slug={slug}", json.dumps(row)),
                    )
                    fetched = cur.fetchone()
                    assert fetched is not None
                    counts["programs_inserted" if fetched[0] else "programs_updated"] += 1
            conn.commit()
            ledger.complete_run(conn, run_p,
                                inserted=counts["programs_inserted"],
                                updated=counts["programs_updated"])
        except Exception as exc:
            conn.rollback()
            ledger.fail_run(conn, run_p, f"{type(exc).__name__}: {exc}")
            raise

    return counts
