from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from zoneinfo import ZoneInfo

from stocvest.config.signal_parameters import SignalParameters
from stocvest.data.models import Bar, Snapshot, Timeframe


@pytest.fixture
def default_params() -> SignalParameters:
    return SignalParameters()


@pytest.fixture
def mock_parameter_store(default_params: SignalParameters):
    with patch(
        "stocvest.config.parameter_store.ParameterStore.get_parameters_sync",
        return_value=default_params,
    ):
        yield default_params


def make_bars(
    count: int,
    base_price: float = 100.0,
    trend: float = 0.001,
    volume: float = 100_000.0,
    start_minute_offset: int = 0,
    market_date: str = "2026-05-04",
) -> list[Bar]:
    bars: list[Bar] = []
    price = base_price
    et_zone = ZoneInfo("America/New_York")
    year, month, day = map(int, market_date.split("-"))
    base_dt = datetime(year, month, day, 9, 30, tzinfo=et_zone)

    for i in range(count):
        price = price * (1 + trend)
        bar_dt = base_dt + timedelta(minutes=start_minute_offset + i)
        bars.append(
            Bar(
                symbol="TEST",
                timestamp=bar_dt.astimezone(timezone.utc),
                timeframe=Timeframe.MIN_1,
                open=price * 0.9995,
                high=price * 1.002,
                low=price * 0.998,
                close=price,
                volume=volume,
                vwap=price * 1.0001,
            )
        )
    return bars


def make_snapshot(
    symbol: str = "TEST",
    price: float = 100.0,
    prev_close: float = 99.0,
    change_percent: float = 1.01,
    day_volume: float = 1_000_000.0,
    day_vwap: float = 99.5,
    prev_day_high: float = 101.0,
    prev_day_low: float = 98.0,
) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        last_trade_price=price,
        prev_close=prev_close,
        change_percent=change_percent,
        change=price - prev_close,
        day_close=price,
        day_volume=day_volume,
        day_vwap=day_vwap,
        day_high=prev_day_high * 1.01,
        day_low=prev_day_low * 0.99,
    )


def make_positive_articles(count: int = 3) -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "title": f"Company reports strong earnings beat #{i}",
            "description": "Revenue exceeded analyst estimates",
            "tickers": ["TEST"],
            "published_utc": (now - timedelta(minutes=30 * i)).isoformat(),
            "insights": [{"sentiment": "positive"}],
            "publisher": {"name": "Reuters"},
        }
        for i in range(count)
    ]


def make_negative_articles(count: int = 3) -> list[dict]:
    now = datetime.now(timezone.utc)
    return [
        {
            "title": f"Company misses revenue guidance #{i}",
            "description": "Results fell short of expectations",
            "tickers": ["TEST"],
            "published_utc": (now - timedelta(minutes=30 * i)).isoformat(),
            "insights": [{"sentiment": "negative"}],
            "publisher": {"name": "Reuters"},
        }
        for i in range(count)
    ]


def make_spy_snapshot(day_pct: float = 0.5) -> Snapshot:
    price = 520.0 * (1 + day_pct / 100)
    return Snapshot(
        symbol="SPY",
        last_trade_price=price,
        change_percent=day_pct,
        prev_close=520.0,
    )


def make_qqq_snapshot(day_pct: float = 0.7) -> Snapshot:
    price = 440.0 * (1 + day_pct / 100)
    return Snapshot(
        symbol="QQQ",
        last_trade_price=price,
        change_percent=day_pct,
        prev_close=440.0,
    )


def make_vix_snapshot(price: float = 18.0, day_pct: float = -2.0) -> Snapshot:
    prev = price / (1 + day_pct / 100) if day_pct != -100 else price
    return Snapshot(
        symbol="I:VIX",
        last_trade_price=price,
        change_percent=day_pct,
        prev_close=prev,
    )
