"""
Centralised configuration loader.

Reads from environment variables (populated by .env locally,
or by Lambda env + AWS Secrets Manager in production).

In AWS Lambda, `STOCVEST_LAMBDA_RUNTIME_SECRET` names a JSON secret whose keys are
merged into the process environment before Settings is built (Polygon, Anthropic,
internal analysis key). Benzinga may still load from `stocvest/external-api-keys`
when `BENZINGA_API_KEY` is unset.

Never hardcodes credentials. Never logs sensitive values.
"""

from __future__ import annotations

from functools import lru_cache
import json
import os

import boto3
from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings  # pydantic v2

load_dotenv()  # no-op in Lambda; harmless locally

# Anthropic Messages API model ids (central switch for cost/latency).
# Fast: classification, extraction, sentiment, short summaries.
AI_MODEL_FAST = "claude-haiku-4-5-20251001"
# Standard: multi-source synthesis, geopolitical scan, longer reasoning.
AI_MODEL_STANDARD = "claude-sonnet-4-6"


def _apply_lambda_runtime_secret_to_environ() -> None:
    """Merge stocvest/lambda-runtime JSON into os.environ (Lambda only)."""
    if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return
    secret_id = (os.environ.get("STOCVEST_LAMBDA_RUNTIME_SECRET") or "").strip()
    if not secret_id:
        return
    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    )
    client = boto3.client("secretsmanager", region_name=region)
    resp = client.get_secret_value(SecretId=secret_id)
    raw = resp.get("SecretString")
    if not raw:
        return
    payload = json.loads(str(raw))
    if not isinstance(payload, dict):
        return
    for key, val in payload.items():
        if val is None:
            continue
        s = str(val).strip()
        if not s:
            continue
        os.environ[str(key)] = s


class Settings(BaseSettings):
    # ── Polygon ──────────────────────────────────────────────────
    polygon_api_key: str = Field(..., alias="POLYGON_API_KEY")
    benzinga_api_key: str = Field("", alias="BENZINGA_API_KEY")
    benzinga_news_ws_url: str = Field(
        "wss://api.benzinga.com/api/v1/news/stream",
        alias="BENZINGA_NEWS_WS_URL",
    )
    stocvest_external_api_keys_secret: str = Field(
        "stocvest/external-api-keys",
        alias="STOCVEST_EXTERNAL_API_KEYS_SECRET",
    )

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
    dynamodb_audit_events_table: str = Field("", alias="DYNAMODB_AUDIT_EVENTS_TABLE")
    dynamodb_parameter_history_table: str = Field("", alias="DYNAMODB_PARAMETER_HISTORY_TABLE")
    dynamodb_sector_cache_table: str = Field("", alias="DYNAMODB_SECTOR_CACHE_TABLE")
    dynamodb_model_portfolio_table: str = Field("", alias="DYNAMODB_MODEL_PORTFOLIO_TABLE")

    # ── Signal tuning / analysis (optional) ───────────────────────
    stocvest_internal_analysis_key: str = Field("", alias="STOCVEST_INTERNAL_ANALYSIS_KEY")
    stocvest_analysis_admin_subs: str = Field("", alias="STOCVEST_ANALYSIS_ADMIN_SUBS")

    # ── Email (SES) for user alerts ───────────────────────────────
    stocvest_email_sender: str = Field("signals@stocvest.app", alias="STOCVEST_EMAIL_SENDER")
    stocvest_public_app_url: str = Field("https://stocvest.app", alias="STOCVEST_PUBLIC_APP_URL")

    # ── Scanner schedule + WebSocket broadcast ────────────────────
    scanner_symbols: str = Field("AAPL,MSFT,NVDA", alias="STOCVEST_SCANNER_SYMBOLS")
    websocket_management_api_url: str = Field("", alias="STOCVEST_WS_MANAGEMENT_API_URL")

    # ── News worker + triage pipeline (ECS worker → SQS → Lambda) ─
    stocvest_news_triage_queue_url: str = Field("", alias="STOCVEST_NEWS_TRIAGE_QUEUE_URL")
    stocvest_active_signal_tickers_key: str = Field(
        "stocvest:active_signal_tickers",
        alias="STOCVEST_ACTIVE_SIGNAL_TICKERS_KEY",
    )
    stocvest_news_scored_redis_list_key: str = Field(
        "stocvest:news_scored",
        alias="STOCVEST_NEWS_SCORED_REDIS_LIST_KEY",
    )
    stocvest_news_worker_cloudwatch_namespace: str = Field(
        "Stocvest/NewsWorker",
        alias="STOCVEST_NEWS_WORKER_CLOUDWATCH_NAMESPACE",
    )
    stocvest_news_worker_heartbeat_key: str = Field(
        "stocvest:news_worker:heartbeat",
        alias="STOCVEST_NEWS_WORKER_HEARTBEAT_KEY",
    )

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
    _apply_lambda_runtime_secret_to_environ()
    settings = Settings()
    if settings.benzinga_api_key:
        return settings
    if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return settings
    secret_name = settings.stocvest_external_api_keys_secret.strip()
    if not secret_name:
        return settings
    try:
        client = boto3.client("secretsmanager", region_name=settings.aws_region)
        resp = client.get_secret_value(SecretId=secret_name)
        payload = json.loads(str(resp.get("SecretString") or "{}"))
        if not settings.benzinga_api_key:
            settings.benzinga_api_key = str(
                payload.get("BENZINGA_API_KEY")
                or payload.get("benzinga_api_key")
                or ""
            ).strip()
    except Exception:
        # Best-effort fallback for local dev / non-AWS contexts.
        pass
    return settings
