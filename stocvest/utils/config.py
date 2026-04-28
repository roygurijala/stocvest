"""
Centralised configuration loader.

Reads from environment variables (populated by .env locally,
or by AWS Secrets Manager / Lambda env vars in production).
Never hardcodes credentials. Never logs sensitive values.
"""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings  # pydantic v2

load_dotenv()  # no-op in Lambda; harmless locally


class Settings(BaseSettings):
    # ── Polygon ──────────────────────────────────────────────────
    polygon_api_key: str = Field(..., alias="POLYGON_API_KEY")

    # ── AWS ──────────────────────────────────────────────────────
    aws_region: str = Field("us-east-1", alias="AWS_REGION")
    dynamodb_endpoint_url: str | None = Field(None, alias="DYNAMODB_ENDPOINT_URL")

    # ── Anthropic ─────────────────────────────────────────────────
    anthropic_api_key: str = Field("", alias="ANTHROPIC_API_KEY")

    # ── App ──────────────────────────────────────────────────────
    env: str = Field("development", alias="STOCVEST_ENV")
    redis_url: str = Field("redis://localhost:6379", alias="REDIS_URL")

    model_config = {"populate_by_name": True}

    @property
    def is_production(self) -> bool:
        return self.env == "production"

    @property
    def is_development(self) -> bool:
        return self.env == "development"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings instance. Call this everywhere instead of reading env directly."""
    return Settings()
