from __future__ import annotations

import psycopg

from .config import get_settings


def connect() -> psycopg.Connection:
    """Open a direct Postgres connection (COPY needs session mode, not a transaction pooler)."""
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Put a Postgres connection string in .env "
            "(see .env.example and docs/SELF-INSTALL.md), then run `funderdb doctor`."
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
