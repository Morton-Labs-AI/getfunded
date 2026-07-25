"""Ingestion-run ledger (ported from the April 2026 attempt's ledger.py)."""

from __future__ import annotations

import psycopg


def start_run(conn: psycopg.Connection, raw_file_id: int, dataset_name: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into internal.ingestion_ledger (raw_file_id, dataset_name, status, created_by)
            values (%s, %s, 'running', 'agent:claude-code')
            returning id
            """,
            (raw_file_id, dataset_name),
        )
        row = cur.fetchone()
        assert row is not None
    conn.commit()
    return int(row[0])


def complete_run(
    conn: psycopg.Connection,
    run_id: int,
    *,
    inserted: int = 0,
    updated: int = 0,
    skipped: int = 0,
    notes: str | None = None,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update internal.ingestion_ledger
            set status = 'completed', completed_at = now(),
                rows_inserted = %s, rows_updated = %s, rows_skipped = %s, notes = %s
            where id = %s
            """,
            (inserted, updated, skipped, notes, run_id),
        )
    conn.commit()


def fail_run(conn: psycopg.Connection, run_id: int, notes: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            update internal.ingestion_ledger
            set status = 'failed', completed_at = now(), notes = %s
            where id = %s
            """,
            (notes[:2000], run_id),
        )
    conn.commit()
