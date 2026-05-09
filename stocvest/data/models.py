"""
Market data models — canonical types used throughout STOCVEST.

All Polygon API responses are normalised into these models before
any downstream code touches them.  This means the rest of the app
never imports anything Polygon-specific; swapping providers only
requires updating polygon_client.py.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


# ──────────────────────────────────────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────────────────────────────────────

class Timeframe(str, Enum):
    MIN_1  = "1min"
    MIN_5  = "5min"
    MIN_15 = "15min"
    MIN_30 = "30min"
    HOUR_1 = "1hour"
    HOUR_4 = "4hour"
    DAY_1  = "1day"
    WEEK_1 = "1week"

class AssetType(str, Enum):
    STOCK  = "stock"
    ETF    = "etf"
    OPTION = "option"
    FUTURE = "future"
    CRYPTO = "crypto"
    FOREX  = "forex"

class Newssentiment(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


# ──────────────────────────────────────────────────────────────────────────────
# OHLCV Bar
# ──────────────────────────────────────────────────────────────────────────────

class Bar(BaseModel):
    """A single OHLCV candlestick bar."""

    symbol:     str
    timestamp:  datetime       # start of the bar, UTC
    timeframe:  Timeframe
    open:       float
    high:       float
    low:        float
    close:      float
    volume:     float
    vwap:       Optional[float] = None   # Polygon provides VWAP per bar
    transactions: Optional[int] = None  # number of trades in the bar


# ──────────────────────────────────────────────────────────────────────────────
# Real-time Quote (NBBO)
# ──────────────────────────────────────────────────────────────────────────────

class Quote(BaseModel):
    """NBBO bid/ask quote."""

    symbol:         str
    timestamp:      datetime
    bid_price:      float
    bid_size:       int
    ask_price:      float
    ask_size:       int
    bid_exchange:   Optional[str] = None
    ask_exchange:   Optional[str] = None


# ──────────────────────────────────────────────────────────────────────────────
# Trade (last sale)
# ──────────────────────────────────────────────────────────────────────────────

class Trade(BaseModel):
    """A single executed trade / last sale."""

    symbol:     str
    timestamp:  datetime
    price:      float
    size:       int
    exchange:   Optional[str] = None
    conditions: list[int] = Field(default_factory=list)


# ──────────────────────────────────────────────────────────────────────────────
# Snapshot (point-in-time summary for a ticker)
# ──────────────────────────────────────────────────────────────────────────────

class Snapshot(BaseModel):
    """Point-in-time market snapshot from Polygon /v2/snapshot."""

    symbol:             str
    last_trade_price:   Optional[float] = None
    last_trade_size:    Optional[int]   = None
    last_quote_bid:     Optional[float] = None
    last_quote_ask:     Optional[float] = None
    day_open:           Optional[float] = None
    day_high:           Optional[float] = None
    day_low:            Optional[float] = None
    day_close:          Optional[float] = None
    day_volume:         Optional[float] = None
    day_vwap:           Optional[float] = None
    prev_close:         Optional[float] = None
    change:             Optional[float] = None   # price change vs prev close
    change_percent:     Optional[float] = None   # % change vs prev close
    pre_market_price:   Optional[float] = None
    pre_market_change_percent: Optional[float] = None
    after_hours_price:  Optional[float] = None
    after_hours_change_percent: Optional[float] = None
    market_status:      Optional[str]   = None   # "open" | "extended-hours" | "closed"
    # Enrichment from Polygon ticker object when present (liquidity / UI)
    company_name:       Optional[str]   = None
    prev_day_volume:    Optional[float] = None   # prior full session volume — proxy for typical ADV


# ──────────────────────────────────────────────────────────────────────────────
# News Article
# ──────────────────────────────────────────────────────────────────────────────

class NewsArticle(BaseModel):
    """A news article from Polygon /v2/reference/news."""

    article_id:  str
    published_at: datetime
    title:       str
    description: Optional[str] = None
    image_url:   Optional[str] = None
    url:         str
    source:      Optional[str] = None
    tickers:     list[str] = Field(default_factory=list)
    keywords:    list[str] = Field(default_factory=list)
    # Optional enrichment (ingestion / triage / multi-source)
    company_name: Optional[str] = None
    categories: list[str] = Field(default_factory=list)
    # sentiment is filled in by our Claude-based scorer (Phase 2), not Polygon
    sentiment:   Optional[Newssentiment] = None
    sentiment_score: Optional[float] = None  # -1.0 to +1.0


# ──────────────────────────────────────────────────────────────────────────────
# Options
# ──────────────────────────────────────────────────────────────────────────────

class OptionContract(BaseModel):
    """A single options contract with Greeks."""

    symbol:          str          # OCC option symbol e.g. AAPL250117C00150000
    underlying:      str          # e.g. AAPL
    expiration:      datetime
    strike:          float
    option_type:     str          # "call" | "put"
    last_price:      Optional[float] = None
    bid:             Optional[float] = None
    ask:             Optional[float] = None
    volume:          Optional[int]   = None
    open_interest:   Optional[int]   = None
    implied_volatility: Optional[float] = None
    delta:           Optional[float] = None
    gamma:           Optional[float] = None
    theta:           Optional[float] = None
    vega:            Optional[float] = None
    rho:             Optional[float] = None


# ──────────────────────────────────────────────────────────────────────────────
# Market Status
# ──────────────────────────────────────────────────────────────────────────────

class MarketStatus(BaseModel):
    """Overall market open/closed status."""

    market:         str           # "stocks" | "crypto" | "fx"
    server_time:    datetime
    exchanges:      dict[str, str] = Field(default_factory=dict)
    currencies:     dict[str, str] = Field(default_factory=dict)


class EarningsEvent(BaseModel):
    """Upcoming or recently reported earnings event."""

    symbol: str
    company_name: str
    report_date: date
    report_time: str  # "before_market" | "after_market" | "during_market" | "unknown"
    estimated_eps: Optional[float] = None
    actual_eps: Optional[float] = None
    surprise_percent: Optional[float] = None
    market_cap: Optional[float] = None


class EconomicCalendarEvent(BaseModel):
    """Macro economic release (Benzinga partner or similar)."""

    time_et: str
    event_name: str
    impact: str  # high | medium | low
    event_date: date | None = None


class TradingMode(str, Enum):
    """Paper vs live execution preference (stored per user)."""

    PAPER = "paper"
    LIVE = "live"


class UserProfile(BaseModel):
    user_id: str
    """Optional email mirrored from Cognito / Users row — used for scheduled job alerts when present."""
    email: str | None = None
    trading_mode: TradingMode = TradingMode.PAPER
    onboarding_completed: bool = False
    onboarding_completed_at: str | None = None
    legal_acknowledged: bool = False
    legal_acknowledged_at: str | None = None
    legal_acknowledged_version: str | None = None
    """Billing sets this (e.g. Stripe webhook). Not user-editable via PATCH /v1/users/me."""
    subscription_plan: str = "free"
    # Admin-only override for invited beta users to unlock full app access.
    beta_full_access: bool = False
    beta_access_until: str | None = None
    beta_access_granted_at: str | None = None

    @field_validator("subscription_plan", mode="before")
    @classmethod
    def _normalize_subscription_plan(cls, v: object) -> str:
        allowed = frozenset({"free", "swing_pro", "swing_day_pro"})
        s = str(v or "free").strip()
        return s if s in allowed else "free"

    @property
    def is_paid(self) -> bool:
        return self.subscription_plan != "free"

    @property
    def beta_access_active(self) -> bool:
        if not self.beta_full_access:
            return False
        raw = (self.beta_access_until or "").strip()
        if not raw:
            return True
        try:
            cutoff = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return False
        if cutoff.tzinfo is None:
            cutoff = cutoff.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < cutoff

    @property
    def has_full_access(self) -> bool:
        return self.is_paid or self.beta_access_active

    @property
    def has_ai_explanations(self) -> bool:
        """Paid feature with beta override: Claude-generated signal explanations."""
        return self.has_full_access


class AlertType(str, Enum):
    SIGNAL_FIRED = "signal_fired"
    PDT_WARNING = "pdt_warning"
    PDT_BLOCKED = "pdt_blocked"
    CONFLUENCE_ALERT = "confluence_alert"
    GAP_DETECTED = "gap_detected"
    SIGNAL_EXPIRED = "signal_expired"


class AlertChannel(str, Enum):
    EMAIL = "email"


class AlertStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class AlertPreferences(BaseModel):
    user_id: str
    email_enabled: bool = True
    on_signal_fired: bool = True
    on_confluence_alert: bool = True
    on_pdt_warning: bool = True
    on_pdt_blocked: bool = True
    on_gap_detected: bool = False
    watchlist_only: bool = True
    quiet_hours_enabled: bool = False
    quiet_hours_start: str = "22:00"
    quiet_hours_end: str = "07:00"


class AlertRecord(BaseModel):
    alert_id: str
    user_id: str
    alert_type: AlertType
    channel: AlertChannel
    symbol: str | None = None
    title: str
    body: str
    status: AlertStatus
    created_at: str
    sent_at: str | None = None
    error: str | None = None


class OrderAttemptLog(BaseModel):
    """Audit metadata for an order attempt (no dollar amounts or account numbers)."""

    user_id: str
    timestamp: datetime
    symbol: str
    side: str
    quantity: float
    order_type: str
    execution_mode: str  # "paper" | "live"


class AuditEvent(BaseModel):
    """Immutable audit row for replaying user/API actions."""

    event_id: str
    occurred_at: datetime
    module: str
    route: str
    method: str
    path: str
    request_id: str | None = None
    session_id: str | None = None
    user_id: str | None = None
    status_code: int = 0
    outcome: str = "unknown"
    entitlement_snapshot: dict[str, object] = Field(default_factory=dict)
    pricing_snapshot: dict[str, object] = Field(default_factory=dict)
    request_summary: dict[str, object] = Field(default_factory=dict)
    response_summary: dict[str, object] = Field(default_factory=dict)
    market_snapshot: dict[str, object] = Field(default_factory=dict)


class SignalRecord(BaseModel):
    """Persisted signal row for outcome tracking (D1 pipeline)."""

    signal_id: str
    symbol: str
    direction: str  # bullish | bearish | neutral
    signal_strength: int = Field(ge=0, le=100)
    pattern: str = "swing_composite"
    layer_scores: dict[str, float] = Field(default_factory=dict)
    price_at_signal: float
    generated_at: datetime
    resolved_1h: bool = False
    resolved_1d: bool = False
    price_1h_after: float | None = None
    price_1d_after: float | None = None
    outcome_1h: str | None = None  # correct | incorrect | neutral
    outcome_1d: str | None = None
    user_id: str | None = None  # None = public / platform signal
    ai_summary: str | None = None  # optional; public landing payload truncates to 120 chars
    # Tuning / analysis (JSON strings; optional)
    technical_snapshot_json: str | None = None
    news_snapshot_json: str | None = None
    macro_snapshot_json: str | None = None
    sector_snapshot_json: str | None = None
    internals_snapshot_json: str | None = None
    layer_scores_json: str | None = None
    #: Parameter bundle version; used as **logic_version_id** on the API for validation audit.
    parameter_version: str | None = None
    status: str = "active"  # active | incomplete
    mode: Literal["day", "swing"] = "day"
    #: True only when strict validation gates passed at entry (user ledger rows).
    ledger_qualified: bool = False
    # ── Signal validation ledger (optional; populated when closed / enriched) ──
    closed_at: datetime | None = None
    ledger_entry_date_et: str | None = None  # YYYY-MM-DD NY session for swing daily-close entry
    ledger_exit_date_et: str | None = None
    entry_rationale: str | None = None
    exit_reason: str | None = None  # rule-based code or short label
    decision_state_entry: str | None = None  # e.g. actionable
    decision_state_exit: str | None = None
    market_regime_exit: str | None = None
    gate_status_json: str | None = None  # JSON string: gate snapshot at entry
    setup_type: str | None = None  # day: ORB | vwap | momentum | …
    exit_rule: str | None = None  # day/swing: which rule closed the row
    max_adverse_excursion_pct: float | None = None
    max_favorable_excursion_pct: float | None = None
    hold_duration_minutes: int | None = None
    # ── Validation ledger entry snapshot (immutable after close; set at record time) ──
    stop_level: float | None = None
    reference_structure_level: float | None = None
    regime_label_at_entry: str | None = None
    sector_label_at_entry: str | None = None
    vwap_state_at_entry: str | None = None
    regime_window_key: str | None = None
    #: True while the position is open under rule-based monitoring; False when a rule exit fires.
    ledger_position_open: bool | None = None
    #: Maps directional outcome to audit vocabulary: favorable | unfavorable | neutral.
    validation_outcome: str | None = None

    @field_validator("direction")
    @classmethod
    def _norm_direction(cls, v: str) -> str:
        d = str(v).strip().lower()
        if d not in {"bullish", "bearish", "neutral"}:
            raise ValueError("direction must be bullish, bearish, or neutral")
        return d

    @field_validator("status")
    @classmethod
    def _norm_status(cls, v: str) -> str:
        s = str(v or "").strip().lower()
        if s not in {"active", "incomplete"}:
            raise ValueError("status must be active or incomplete")
        return s

    @field_validator("mode")
    @classmethod
    def _norm_mode(cls, v: str) -> str:
        m = str(v or "day").strip().lower()
        if m not in {"day", "swing"}:
            raise ValueError("mode must be day or swing")
        return m

    @staticmethod
    def from_dynamo_item(item: dict) -> "SignalRecord":
        """Hydrate from DynamoDB document (numeric types may be Decimal)."""

        def _f(key: str) -> float | None:
            raw = item.get(key)
            if raw is None:
                return None
            return float(raw)

        def _bool(key: str) -> bool:
            return bool(item.get(key))

        gen_raw = item.get("generated_at")
        if not gen_raw:
            raise ValueError("missing generated_at")
        gen = datetime.fromisoformat(str(gen_raw).replace("Z", "+00:00"))
        if gen.tzinfo is None:
            gen = gen.replace(tzinfo=timezone.utc)

        layer_raw = item.get("layer_scores") or {}
        layer_scores = {str(k): float(v) for k, v in layer_raw.items()} if isinstance(layer_raw, dict) else {}

        def _s(key: str) -> str | None:
            raw = item.get(key)
            if raw is None:
                return None
            s = str(raw).strip()
            return s or None

        def _dt_opt(key: str) -> datetime | None:
            raw = item.get(key)
            if not raw:
                return None
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt

        def _i_opt(key: str) -> int | None:
            raw = item.get(key)
            if raw is None:
                return None
            return int(raw)

        return SignalRecord(
            signal_id=str(item["signal_id"]),
            symbol=str(item["symbol"]).upper(),
            direction=str(item["direction"]).lower(),
            signal_strength=int(item["signal_strength"]),
            pattern=str(item.get("pattern") or "swing_composite"),
            layer_scores=layer_scores,
            price_at_signal=float(item["price_at_signal"]),
            generated_at=gen,
            resolved_1h=_bool("resolved_1h"),
            resolved_1d=_bool("resolved_1d"),
            price_1h_after=_f("price_1h_after"),
            price_1d_after=_f("price_1d_after"),
            outcome_1h=str(item["outcome_1h"]) if item.get("outcome_1h") is not None else None,
            outcome_1d=str(item["outcome_1d"]) if item.get("outcome_1d") is not None else None,
            user_id=str(item["user_id"]) if item.get("user_id") else None,
            ai_summary=str(item["ai_summary"]).strip() if isinstance(item.get("ai_summary"), str) else None,
            technical_snapshot_json=_s("technical_snapshot_json"),
            news_snapshot_json=_s("news_snapshot_json"),
            macro_snapshot_json=_s("macro_snapshot_json"),
            sector_snapshot_json=_s("sector_snapshot_json"),
            internals_snapshot_json=_s("internals_snapshot_json"),
            layer_scores_json=_s("layer_scores_json"),
            parameter_version=_s("parameter_version"),
            status=str(item.get("status") or "active"),
            mode=_coerce_signal_mode(item.get("mode")),
            ledger_qualified=bool(item.get("ledger_qualified")),
            closed_at=_dt_opt("closed_at"),
            ledger_entry_date_et=_s("ledger_entry_date_et"),
            ledger_exit_date_et=_s("ledger_exit_date_et"),
            entry_rationale=_s("entry_rationale"),
            exit_reason=_s("exit_reason"),
            decision_state_entry=_s("decision_state_entry"),
            decision_state_exit=_s("decision_state_exit"),
            market_regime_exit=_s("market_regime_exit"),
            gate_status_json=_s("gate_status_json"),
            setup_type=_s("setup_type"),
            exit_rule=_s("exit_rule"),
            max_adverse_excursion_pct=_f("max_adverse_excursion_pct"),
            max_favorable_excursion_pct=_f("max_favorable_excursion_pct"),
            hold_duration_minutes=_i_opt("hold_duration_minutes"),
            stop_level=_f("stop_level"),
            reference_structure_level=_f("reference_structure_level"),
            regime_label_at_entry=_s("regime_label_at_entry"),
            sector_label_at_entry=_s("sector_label_at_entry"),
            vwap_state_at_entry=_s("vwap_state_at_entry"),
            regime_window_key=_s("regime_window_key"),
            ledger_position_open=_bool("ledger_position_open") if item.get("ledger_position_open") is not None else None,
            validation_outcome=_norm_vo(_s("validation_outcome")),
        )


def _norm_vo(raw: str | None) -> str | None:
    if not raw:
        return None
    s = str(raw).strip().lower()
    if s not in {"favorable", "unfavorable", "neutral"}:
        return None
    return s


def _coerce_signal_mode(raw: object) -> Literal["day", "swing"]:
    m = str(raw or "day").strip().lower()
    if m == "swing":
        return "swing"
    return "day"
