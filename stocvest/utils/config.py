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

def __getattr__(name: str) -> str:
    """Lazy aliases for Secrets-backed keys (same sources as Settings / external-api-keys merge)."""
    if name == "BENZINGA_NEWS_KEY":
        return _settings_key("benzinga_news_api_key")
    if name == "BENZINGA_ANALYST_KEY":
        return _settings_key("benzinga_analyst_key")
    if name == "BENZINGA_WIM_KEY":
        return _settings_key("benzinga_wim_key")
    if name == "BENZINGA_PRESS_KEY":
        return _settings_key("benzinga_press_key")
    if name == "PERPLEXITY_API_KEY":
        return _settings_key("perplexity_api_key")
    if name == "REDIS_URL":
        return str(get_settings().redis_url).strip()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def _settings_key(field: str) -> str:
    return str(getattr(get_settings(), field) or "").strip()


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
    # Secrets Manager key/value JSON may use snake_case; pydantic-settings reads UPSTASH_* aliases.
    for low, up in (
        ("upstash_redis_rest_url", "UPSTASH_REDIS_REST_URL"),
        ("upstash_redis_rest_token", "UPSTASH_REDIS_REST_TOKEN"),
    ):
        v = (os.environ.get(low) or "").strip()
        if v and not (os.environ.get(up) or "").strip():
            os.environ[up] = v
    # Informal aliases — REST cache writes require *both* URL and TOKEN.
    if not (os.environ.get("UPSTASH_REDIS_REST_URL") or "").strip():
        for alt in ("UPSTASH_URL", "upstash_url"):
            v = (os.environ.get(alt) or "").strip()
            if v:
                os.environ["UPSTASH_REDIS_REST_URL"] = v
                break
    if not (os.environ.get("UPSTASH_REDIS_REST_TOKEN") or "").strip():
        for alt in ("UPSTASH_TOKEN", "upstash_token"):
            v = (os.environ.get(alt) or "").strip()
            if v:
                os.environ["UPSTASH_REDIS_REST_TOKEN"] = v
                break


class Settings(BaseSettings):
    # ── Polygon ──────────────────────────────────────────────────
    polygon_api_key: str = Field(..., alias="POLYGON_API_KEY")
    benzinga_api_key: str = Field("", alias="BENZINGA_API_KEY")
    benzinga_news_api_key: str = Field("", alias="BENZINGA_NEWS_API_KEY")
    benzinga_analyst_key: str = Field("", alias="BENZINGA_ANALYST_KEY")
    benzinga_wim_key: str = Field("", alias="BENZINGA_WIM_KEY")
    benzinga_press_key: str = Field("", alias="BENZINGA_PRESS_KEY")
    perplexity_api_key: str = Field("", alias="PERPLEXITY_API_KEY")
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
    #: Prefix for ``GET /v1/admin/error-logs`` (Insights over API Lambda groups). Empty → ``/aws/lambda/stocvest-{env}-api-``.
    cloudwatch_admin_error_log_group_prefix: str = Field("", alias="CLOUDWATCH_ADMIN_ERROR_LOG_PREFIX")

    # ── Anthropic ─────────────────────────────────────────────────
    anthropic_api_key: str = Field("", alias="ANTHROPIC_API_KEY")

    # ── FRED (macro calendar + Treasury series) ──────────────────
    fred_api_key: str = Field("", alias="FRED_API_KEY")

    # ── FMP (optional fundamentals context — revenue / earnings calendar) ──
    fmp_api_key: str = Field("", alias="FMP_API_KEY")

    # ── Finnhub (optional earnings calendar — dashboard + gap catalyst) ──
    finnhub_api_key: str = Field("", alias="FINNHUB_API_KEY")

    # ── App ──────────────────────────────────────────────────────
    env: str = Field("development", alias="STOCVEST_ENV")
    redis_url: str = Field("redis://localhost:6379", alias="REDIS_URL")
    stocvest_disable_redis: bool = Field(False, alias="STOCVEST_DISABLE_REDIS")
    upstash_redis_rest_url: str = Field("", alias="UPSTASH_REDIS_REST_URL")
    upstash_redis_rest_token: str = Field("", alias="UPSTASH_REDIS_REST_TOKEN")
    polygon_rate_limit_per_second: int = Field(30, alias="STOCVEST_POLYGON_RATE_PER_SEC")
    claude_rate_limit_per_minute: int = Field(20, alias="STOCVEST_CLAUDE_RATE_PER_MIN")
    scanner_cache_bucket_seconds: int = Field(60, alias="STOCVEST_SCANNER_CACHE_BUCKET_SEC")
    scanner_cache_bucket_seconds_intraday: int = Field(300, alias="STOCVEST_SCANNER_CACHE_BUCKET_INTRADAY_SEC")
    scanner_gap_rank_move_weight: float = Field(0.5, alias="STOCVEST_SCANNER_GAP_RANK_MOVE_WEIGHT")
    scanner_gap_rank_rvol_weight: float = Field(0.3, alias="STOCVEST_SCANNER_GAP_RANK_RVOL_WEIGHT")
    scanner_gap_rank_dollar_vol_weight: float = Field(0.2, alias="STOCVEST_SCANNER_GAP_RANK_DOLLAR_VOL_WEIGHT")
    scanner_gap_rank_move_norm_pct: float = Field(15.0, alias="STOCVEST_SCANNER_GAP_RANK_MOVE_NORM_PCT")
    scanner_gap_rank_rvol_norm: float = Field(2.0, alias="STOCVEST_SCANNER_GAP_RANK_RVOL_NORM")
    scanner_gap_rank_dollar_vol_norm: float = Field(250_000_000.0, alias="STOCVEST_SCANNER_GAP_RANK_DOLLAR_VOL_NORM")
    opportunity_desk_survivor_limit: int = Field(150, alias="STOCVEST_OPPORTUNITY_DESK_SURVIVOR_LIMIT")
    opportunity_desk_adaptive_survivor_limit: bool = Field(
        True, alias="STOCVEST_OPPORTUNITY_DESK_ADAPTIVE_SURVIVOR_LIMIT"
    )
    opportunity_desk_elevated_survivor_limit: int = Field(
        220, alias="STOCVEST_OPPORTUNITY_DESK_ELEVATED_SURVIVOR_LIMIT"
    )
    opportunity_desk_elevated_breadth_trigger: int = Field(
        180, alias="STOCVEST_OPPORTUNITY_DESK_ELEVATED_BREADTH_TRIGGER"
    )

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
    #: Per-(user, symbol, mode) maturation rows; see docs/WATCHLIST_MATURATION_ARCH.md
    dynamodb_watchlist_maturation_table: str = Field("", alias="DYNAMODB_WATCHLIST_MATURATION_TABLE")
    dynamodb_watchlist_maturation_transition_table: str = Field(
        "", alias="DYNAMODB_WATCHLIST_MATURATION_TRANSITION_TABLE"
    )
    dynamodb_system_signal_transition_table: str = Field(
        "", alias="DYNAMODB_SYSTEM_SIGNAL_TRANSITION_TABLE"
    )

    # ── Journal + PDT persistence ────────────────────────────────
    trade_journal_table: str = Field("", alias="STOCVEST_TRADE_JOURNAL_TABLE")
    trade_plans_table: str = Field("", alias="STOCVEST_TRADE_PLANS_TABLE")
    pdt_state_table: str = Field("", alias="STOCVEST_PDT_STATE_TABLE")
    dynamodb_day_trading_setups: str = Field("", alias="DYNAMODB_DAY_TRADING_SETUPS")
    dynamodb_alerts: str = Field("", alias="DYNAMODB_ALERTS")
    dynamodb_signal_history_table: str = Field("", alias="DYNAMODB_SIGNAL_HISTORY_TABLE")
    dynamodb_audit_events_table: str = Field("", alias="DYNAMODB_AUDIT_EVENTS_TABLE")
    dynamodb_parameter_history_table: str = Field("", alias="DYNAMODB_PARAMETER_HISTORY_TABLE")
    # D10 Phase 1 — proposal-only weight-tuning pipeline. Holds candidate
    # SignalParameters rotations produced by the Phase-2 optimizer Lambda and
    # promoted/rejected through the Phase-3 admin endpoint. Decoupled from
    # ParameterHistory so the audit log of *live* parameter changes stays
    # uncluttered by rejected candidates.
    dynamodb_parameter_proposal_table: str = Field("", alias="DYNAMODB_PARAMETER_PROPOSAL_TABLE")
    dynamodb_sector_cache_table: str = Field("", alias="DYNAMODB_SECTOR_CACHE_TABLE")
    dynamodb_gap_intel_cache_table: str = Field("", alias="DYNAMODB_GAP_INTEL_CACHE_TABLE")
    dynamodb_scanner_evaluation_trace_table: str = Field(
        "", alias="DYNAMODB_SCANNER_EVALUATION_TRACE_TABLE"
    )

    # ── Signal tuning / analysis (optional) ───────────────────────
    stocvest_internal_analysis_key: str = Field("", alias="STOCVEST_INTERNAL_ANALYSIS_KEY")
    stocvest_analysis_admin_subs: str = Field("", alias="STOCVEST_ANALYSIS_ADMIN_SUBS")

    # ── Email (Postmark) for user alerts ──────────────────────────
    stocvest_email_sender: str = Field("signals@stocvest.ai", alias="STOCVEST_EMAIL_SENDER")
    postmark_server_token: str = Field("", alias="POSTMARK_SERVER_TOKEN")
    postmark_message_stream: str = Field("outbound", alias="POSTMARK_MESSAGE_STREAM")
    stocvest_public_app_url: str = Field("https://stocvest.ai", alias="STOCVEST_PUBLIC_APP_URL")

    # ── Trial + phone verification (defaults OFF — safe to ship on main) ──
    trial_enforcement_enabled: bool = Field(False, alias="TRIAL_ENFORCEMENT_ENABLED")
    phone_verification_required: bool = Field(False, alias="PHONE_VERIFICATION_REQUIRED")
    trial_duration_days: int = Field(14, alias="TRIAL_DURATION_DAYS")
    trial_sms_enabled: bool = Field(False, alias="TRIAL_SMS_ENABLED")
    trial_phone_hmac_pepper: str = Field("", alias="TRIAL_PHONE_HMAC_PEPPER")
    trial_otp_ttl_seconds: int = Field(600, alias="TRIAL_OTP_TTL_SECONDS")
    trial_otp_request_cooldown_seconds: int = Field(60, alias="TRIAL_OTP_REQUEST_COOLDOWN_SECONDS")
    trial_otp_max_requests_per_hour: int = Field(3, alias="TRIAL_OTP_MAX_REQUESTS_PER_HOUR")
    trial_otp_max_verify_attempts: int = Field(5, alias="TRIAL_OTP_MAX_VERIFY_ATTEMPTS")
    trial_reminders_enabled: bool = Field(False, alias="TRIAL_REMINDERS_ENABLED")

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
    # B71 Phase D — read-through Claude sentiment cache for the composite news layer.
    # OFF by default: ships dark until cache hit-rate is validated. When enabled, the
    # news consumer writes a content-keyed sentiment entry and the composite fills
    # otherwise-abstaining (no-insights) headlines from it. Always fail-open.
    stocvest_news_sentiment_cache_enabled: bool = Field(
        False,
        alias="STOCVEST_NEWS_SENTIMENT_CACHE_ENABLED",
    )
    stocvest_news_sentiment_cache_key_prefix: str = Field(
        "stocvest:news_sent:",
        alias="STOCVEST_NEWS_SENTIMENT_CACHE_KEY_PREFIX",
    )
    stocvest_news_sentiment_cache_ttl_seconds: int = Field(
        # 6 days: must exceed the swing news lookback (120h / 5 days) so day-4/5
        # swing headlines are still cache-resident, plus a write→read margin.
        518400,
        alias="STOCVEST_NEWS_SENTIMENT_CACHE_TTL_SECONDS",
    )
    # B71 Phase D self-prime: when the composite hits an abstaining cache MISS, enqueue
    # that article to the triage queue for async Claude scoring so it becomes a hit on a
    # later pass. Closes the Benzinga-REST-vs-WebSocket coverage gap without a synchronous
    # Claude call. OFF by default; also requires the cache flag + a triage queue URL.
    stocvest_news_sentiment_prime_enabled: bool = Field(
        False,
        alias="STOCVEST_NEWS_SENTIMENT_PRIME_ENABLED",
    )
    # Per-article re-enqueue cooldown: suppress duplicate enqueues of the same headline
    # while it is awaiting scoring (default 6h).
    stocvest_news_sentiment_prime_pending_ttl_seconds: int = Field(
        21600,
        alias="STOCVEST_NEWS_SENTIMENT_PRIME_PENDING_TTL_SECONDS",
    )
    # SQS send_message_batch cap is 10; bound how many misses we enqueue per scoring pass.
    stocvest_news_sentiment_prime_max_per_pass: int = Field(
        10,
        alias="STOCVEST_NEWS_SENTIMENT_PRIME_MAX_PER_PASS",
    )
    # News relevance × impact × age weighting for the composite News layer. When ON,
    # each article's contribution is scaled by its relevance (credible, on-topic) and
    # impact (market-moving catalyst), and the final score is shrunk toward neutral (50)
    # when total effective evidence is thin — so a lone, low-impact, stale headline can no
    # longer print an extreme score. Relevance/impact come from Claude (read-through cache)
    # when available, else a validated heuristic fallback. OFF by default (ships dark): when
    # OFF the News layer score is byte-identical to the legacy flat-sentiment average.
    stocvest_news_impact_weighting_enabled: bool = Field(
        False,
        alias="STOCVEST_NEWS_IMPACT_WEIGHTING_ENABLED",
    )
    # Day ledger monitor — take profit at the reference target level (reference_structure_level)
    # when the snapshot last price reaches it, checked before the VWAP-violation rule. The live
    # day monitor otherwise has no profit target: winners only exit on a VWAP break against the
    # trade or the time flatten, leaving favorable excursion on the table (replay: avg MFE
    # +1.86% > avg MAE -1.55%; adding the target moved day expectancy from -0.79% to -0.39%/trade).
    # OFF by default (ships dark): when OFF the monitor's exit behavior is byte-identical to legacy.
    stocvest_day_profit_target_exit_enabled: bool = Field(
        False,
        alias="STOCVEST_DAY_PROFIT_TARGET_EXIT_ENABLED",
    )
    # B71 Phase C — scheduled offline news event-study report (read-only → S3). OFF by
    # default; the scheduled Lambda no-ops until enabled + a reports bucket is set.
    stocvest_news_event_study_report_enabled: bool = Field(
        False,
        alias="STOCVEST_NEWS_EVENT_STUDY_REPORT_ENABLED",
    )
    stocvest_reports_s3_bucket: str = Field("", alias="STOCVEST_REPORTS_S3_BUCKET")
    stocvest_news_event_study_s3_prefix: str = Field(
        "news-event-study/",
        alias="STOCVEST_NEWS_EVENT_STUDY_S3_PREFIX",
    )
    stocvest_news_event_study_lookback_days: int = Field(
        120,
        alias="STOCVEST_NEWS_EVENT_STUDY_LOOKBACK_DAYS",
    )
    stocvest_news_event_study_min_samples: int = Field(
        8,
        alias="STOCVEST_NEWS_EVENT_STUDY_MIN_SAMPLES",
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


def _merge_external_api_keys_into_environ() -> None:
    """Load vendor keys from ``stocvest/external-api-keys`` into os.environ before Settings()."""
    if not os.environ.get("AWS_LAMBDA_FUNCTION_NAME"):
        return
    secret_name = (os.environ.get("STOCVEST_EXTERNAL_API_KEYS_SECRET") or "stocvest/external-api-keys").strip()
    if not secret_name:
        return
    region = (
        os.environ.get("AWS_REGION")
        or os.environ.get("AWS_DEFAULT_REGION")
        or "us-east-1"
    )
    try:
        client = boto3.client("secretsmanager", region_name=region)
        resp = client.get_secret_value(SecretId=secret_name)
        payload = json.loads(str(resp.get("SecretString") or "{}"))
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    for key, val in payload.items():
        if val is None:
            continue
        env_key = str(key).strip()
        if not env_key:
            continue
        s = str(val).strip()
        if not s:
            continue
        if not (os.environ.get(env_key) or "").strip():
            os.environ[env_key] = s


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached Settings instance. Call this everywhere instead of reading env directly."""
    _apply_lambda_runtime_secret_to_environ()
    _merge_external_api_keys_into_environ()
    settings = Settings()
    # Do not return early until optional vendor keys that may live *only* in
    # ``stocvest/external-api-keys`` (e.g. Upstash) are also present. Otherwise
    # Lambda env that inlines all Benzinga + Perplexity keys would skip the SM
    # merge entirely and ``upstash_configured()`` would stay false forever.
    if (
        settings.benzinga_api_key
        and settings.benzinga_news_api_key
        and settings.benzinga_analyst_key
        and settings.benzinga_wim_key
        and settings.perplexity_api_key
        and str(settings.upstash_redis_rest_url or "").strip()
        and str(settings.upstash_redis_rest_token or "").strip()
    ):
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
        if not isinstance(payload, dict):
            return settings

        def _load_secret_key(*aliases: str) -> str:
            for alias in aliases:
                val = payload.get(alias)
                if val is not None:
                    s = str(val).strip()
                    if s:
                        return s
            return ""

        if not settings.benzinga_api_key:
            settings.benzinga_api_key = _load_secret_key("BENZINGA_API_KEY", "benzinga_api_key")
        if not settings.benzinga_news_api_key:
            settings.benzinga_news_api_key = _load_secret_key("BENZINGA_NEWS_API_KEY", "benzinga_news_api_key")
        if not settings.benzinga_analyst_key:
            settings.benzinga_analyst_key = _load_secret_key("BENZINGA_ANALYST_KEY", "benzinga_analyst_key")
        if not settings.benzinga_wim_key:
            settings.benzinga_wim_key = _load_secret_key("BENZINGA_WIM_KEY", "benzinga_wim_key")
        if not settings.benzinga_press_key:
            settings.benzinga_press_key = _load_secret_key("BENZINGA_PRESS_KEY", "benzinga_press_key")
        if not settings.perplexity_api_key:
            settings.perplexity_api_key = _load_secret_key("PERPLEXITY_API_KEY", "perplexity_api_key")
        if not settings.upstash_redis_rest_url:
            settings.upstash_redis_rest_url = _load_secret_key(
                "UPSTASH_REDIS_REST_URL",
                "upstash_redis_rest_url",
            )
        if not settings.upstash_redis_rest_token:
            settings.upstash_redis_rest_token = _load_secret_key(
                "UPSTASH_REDIS_REST_TOKEN",
                "upstash_redis_rest_token",
            )
        if not settings.fmp_api_key:
            settings.fmp_api_key = _load_secret_key("FMP_API_KEY", "fmp_api_key")
        if not settings.finnhub_api_key:
            settings.finnhub_api_key = _load_secret_key("FINNHUB_API_KEY", "finnhub_api_key")
        if not settings.fred_api_key:
            settings.fred_api_key = _load_secret_key("FRED_API_KEY", "fred_api_key")
        if not settings.postmark_server_token:
            settings.postmark_server_token = _load_secret_key(
                "POSTMARK_SERVER_TOKEN",
                "postmark_server_token",
            )
    except Exception:
        # Best-effort fallback for local dev / non-AWS contexts.
        pass
    return settings
