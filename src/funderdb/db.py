from __future__ import annotations

import psycopg

from .config import get_settings


def connect() -> psycopg.Connection:
    """Open a direct Postgres connection (session pooler — COPY needs session mode)."""
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Copy the session-pooler connection string from the "
            "Supabase dashboard (project open-funder-db -> Connect -> Session pooler) into .env."
        )
    # TCP keepalives: interactive sessions (labeling) can sit idle long
    # enough for NAT/pooler timeouts to silently kill the socket — the
    # failure then surfaces on the NEXT write as "server closed the
    # connection unexpectedly".
    return psycopg.connect(
        settings.database_url, autocommit=False,
        keepalives=1, keepalives_idle=30,
        keepalives_interval=10, keepalives_count=3,
    )
