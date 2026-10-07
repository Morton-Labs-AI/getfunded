from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Direct Postgres connection (Supabase session pooler, port 5432).
    # Optional so that staging/parsing (`--dry-run`, `funderdb stage`) work
    # before a connection string exists.
    database_url: str | None = None

    data_root: Path = Path("./data")

    # sec.gov requires a declared User-Agent.
    sec_user_agent: str = "MortonLabs zach@mortonlabs.ai"

    # Voyage AI (semantic-search embeddings). Optional so ingest works without it.
    voyage_api_key: str | None = None

    @property
    def raw_dir(self) -> Path:
        return self.data_root / "raw"


@lru_cache
def get_settings() -> Settings:
    return Settings()
