from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Default User-Agent for non-SEC downloads (IRS, SBIR, Voyage). Operators can
# override it with HTTP_USER_AGENT; SEC downloads use SEC_USER_AGENT instead
# because sec.gov requires a declared contact (see .env.example).
DEFAULT_HTTP_USER_AGENT = "funderdb/0.1 (Open Funder Database ingestion; +set HTTP_USER_AGENT)"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Direct Postgres connection string. Optional so that staging/parsing
    # (`--dry-run`, `funderdb stage`) work before a connection string exists.
    database_url: str | None = None

    # Where staged raw files, exports and run manifests land.
    data_root: Path = Path("./data")

    # Directory holding the numbered *.sql migrations (`funderdb migrate`).
    migrations_dir: Path = Path(__file__).resolve().parents[2] / "migrations"

    # sec.gov requires a declared User-Agent with a contact e-mail. There is
    # deliberately NO default: every operator must identify themselves.
    sec_user_agent: str | None = None

    # User-Agent for every other HTTP download (IRS, SBIR, ...).
    http_user_agent: str = DEFAULT_HTTP_USER_AGENT

    # Voyage AI (semantic-search embeddings). Optional so ingest works without it.
    voyage_api_key: str | None = None

    @property
    def raw_dir(self) -> Path:
        return self.data_root / "raw"

    def require_sec_user_agent(self) -> str:
        """The SEC User-Agent, or a clear error telling the operator what to set."""
        ua = (self.sec_user_agent or "").strip()
        if not ua or "@" not in ua:
            raise RuntimeError(
                "SEC_USER_AGENT is not set (or carries no contact e-mail). sec.gov requires "
                "every automated client to declare an organisation and a contact address, "
                'e.g. SEC_USER_AGENT="Example Nonprofit data@example.org". Add it to .env.'
            )
        return ua


@lru_cache
def get_settings() -> Settings:
    return Settings()
