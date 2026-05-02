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
from typing import Optional

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


# ──────────────────────────────────────────────────────────────────────────────
# News Article
# ──────────────────────────────────────────────────────────────────────────────

class NewsArticle(BaseModel):
    """A news article from Polygon /v2/reference/news."""

    article_id:  str
    published_at: datetime
    title:       str
    description: Optional[str] = None
    url:         str
    source:      Optional[str] = None
    tickers:     list[str] = Field(default_factory=list)
    keywords:    list[str] = Field(default_factory=list)
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


class TradingMode(str, Enum):
    """Paper vs live execution preference (stored per user)."""

    PAPER = "paper"
    LIVE = "live"


class UserProfile(BaseModel):
    user_id: str
    trading_mode: TradingMode = TradingMode.PAPER


class OrderAttemptLog(BaseModel):
    """Audit metadata for an order attempt (no dollar amounts or account numbers)."""

    user_id: str
    timestamp: datetime
    symbol: str
    side: str
    quantity: float
    order_type: str
    execution_mode: str  # "paper" | "live"


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

    @field_validator("direction")
    @classmethod
    def _norm_direction(cls, v: str) -> str:
        d = str(v).strip().lower()
        if d not in {"bullish", "bearish", "neutral"}:
            raise ValueError("direction must be bullish, bearish, or neutral")
        return d

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
        )
