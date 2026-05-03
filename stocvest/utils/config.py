"""
Centralised configuration loader.

Reads from environment variables (populated by .env locally,
or by AWS Secrets Manager / Lambda env vars in production).
Never hardcodes credentials. Never logs sensitive values.
"""

from __future__ import annotations

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
    stocvest_disable_redis: bool = Field(False, alias="STOCVEST_DISABLE_REDIS")
    polygon_rate_limit_per_second: int = Field(30, alias="STOCVEST_POLYGON_RATE_PER_SEC")
    claude_rate_limit_per_minute: int = Field(20, alias="STOCVEST_CLAUDE_RATE_PER_MIN")
    scanner_cache_bucket_seconds: int = Field(60, alias="STOCVEST_SCANNER_CACHE_BUCKET_SEC")
    scanner_cache_bucket_seconds_intraday: int = Field(300, alias="STOCVEST_SCANNER_CACHE_BUCKET_INTRADAY_SEC")

    # ── Broker sandbox integration / OAuth ───────────────────────
    sandbox_integration_enabled: bool = Field(
        False, alias="STOCVEST_ENABLE_SANDBOX_INTEGRATION"
    )
    ibkr_gateway_binding: str = Field("", alias="STOCVEST_IBKR_GATEWAY")
    etrade_gateway_binding: str = Field("", alias="STOCVEST_ETRADE_GATEWAY")
    etrade_consumer_key: str = Field("", alias="ETRADE_CONSUMER_KEY")
    etrade_consumer_secret: str = Field("", alias="ETRADE_CONSUMER_SECRET")

    # ── API auth (Cognito) ───────────────────────────────────────
    cognito_user_pool_id: str = Field("", alias="COGNITO_USER_POOL_ID")
    cognito_region: str = Field("", alias="COGNITO_REGION")
    cognito_app_client_id: str = Field("", alias="COGNITO_APP_CLIENT_ID")

    # ── WebSocket connection registry ────────────────────────────
    websocket_connections_table: str = Field("", alias="STOCVEST_WS_CONNECTIONS_TABLE")
    websocket_connection_ttl_seconds: int = Field(
        86400, alias="STOCVEST_WS_CONNECTION_TTL_SECONDS"
    )

    # ── DynamoDB table names (Lambda env) ───────────────────────
    dynamodb_users_table: str = Field("", alias="DYNAMODB_USERS_TABLE")
    dynamodb_watchlists_table: str = Field("", alias="DYNAMODB_WATCHLISTS_TABLE")

    # ── Journal + PDT persistence ────────────────────────────────
    trade_journal_table: str = Field("", alias="STOCVEST_TRADE_JOURNAL_TABLE")
    pdt_state_table: str = Field("", alias="STOCVEST_PDT_STATE_TABLE")
    dynamodb_day_trading_setups: str = Field("", alias="DYNAMODB_DAY_TRADING_SETUPS")
    dynamodb_alerts: str = Field("", alias="DYNAMODB_ALERTS")
    dynamodb_signal_history_table: str = Field("", alias="DYNAMODB_SIGNAL_HISTORY_TABLE")

    # ── Email (SES) for user alerts ───────────────────────────────
    stocvest_email_sender: str = Field("signals@stocvest.app", alias="STOCVEST_EMAIL_SENDER")
    stocvest_public_app_url: str = Field("https://stocvest.app", alias="STOCVEST_PUBLIC_APP_URL")

    # ── Scanner schedule + WebSocket broadcast ────────────────────
    scanner_symbols: str = Field("AAPL,MSFT,NVDA", alias="STOCVEST_SCANNER_SYMBOLS")
    websocket_management_api_url: str = Field("", alias="STOCVEST_WS_MANAGEMENT_API_URL")

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
