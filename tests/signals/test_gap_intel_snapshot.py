"""Unit tests for gap_intel_snapshot deterministic engine."""

from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import pytest

from stocvest.data.models import Snapshot
from stocvest.signals.gap_intel_snapshot import (
    PhaseState,
    build_gap_intel_snapshot,
    compute_high_liquidity,
)


def _snap(
    *,
    symbol: str = "TEST",
    prev_close: float | None = 100.0,
    day_open: float | None = 101.0,
    last: float | None = 101.5,
    prev_vol: float = 6_000_000,
    bid: float = 100.9,
    ask: float = 101.1,
) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        prev_close=prev_close,
        day_open=day_open,
        last_trade_price=last,
        prev_day_volume=prev_vol,
        last_quote_bid=bid,
        last_quote_ask=ask,
    )


@pytest.mark.unit
def test_weekend_market_closed() -> None:
    # 2026-05-09 is Saturday
    now = datetime(2026, 5, 9, 12, 0, tzinfo=ZoneInfo("America/New_York"))
    now_utc = now.astimezone(timezone.utc)
    out = build_gap_intel_snapshot(
        symbol="AAPL",
        snapshot=_snap(),
        bars_1m=[],
        market_status=None,
        trading_mode="day",
        now_utc=now_utc,
        prev_session_bar=None,
    )
    assert out["phase"]["state"] == PhaseState.MARKET_CLOSED.value
    assert out["scenario_builder"]["state"] == "DISABLED"


@pytest.mark.unit
def test_session_open_day_scenario_limited() -> None:
    now = datetime(2026, 5, 14, 9, 45, tzinfo=ZoneInfo("America/New_York"))  # Wed
    now_utc = now.astimezone(timezone.utc)
    out = build_gap_intel_snapshot(
        symbol="AAPL",
        snapshot=_snap(),
        bars_1m=[],
        market_status=None,
        trading_mode="day",
        now_utc=now_utc,
        prev_session_bar=None,
    )
    assert out["phase"]["state"] == PhaseState.SESSION_OPEN.value
    assert out["scenario_builder"]["state"] == "LIMITED"
    assert "day_open_phase_volatility" in out["scenario_builder"]["reasons"]


@pytest.mark.unit
def test_premarket_swing_limited_day_disabled() -> None:
    now = datetime(2026, 5, 14, 8, 0, tzinfo=ZoneInfo("America/New_York"))
    now_utc = now.astimezone(timezone.utc)
    day = build_gap_intel_snapshot(
        symbol="AAPL",
        snapshot=_snap(),
        bars_1m=[],
        market_status=None,
        trading_mode="day",
        now_utc=now_utc,
        prev_session_bar=None,
    )
    swing = build_gap_intel_snapshot(
        symbol="AAPL",
        snapshot=_snap(),
        bars_1m=[],
        market_status=None,
        trading_mode="swing",
        now_utc=now_utc,
        prev_session_bar=None,
    )
    assert day["scenario_builder"]["state"] == "DISABLED"
    assert swing["scenario_builder"]["state"] == "LIMITED"


@pytest.mark.unit
def test_high_liquidity_gate() -> None:
    s = _snap(prev_vol=6_000_000, prev_close=100.0, bid=100.09, ask=100.11)
    ok, _detail = compute_high_liquidity(s)
    assert ok is True

    s2 = _snap(prev_vol=1_000_000)
    ok2, _ = compute_high_liquidity(s2)
    assert ok2 is False


@pytest.mark.unit
def test_fill_not_derivable_disables_builder() -> None:
    now = datetime(2026, 5, 14, 11, 0, tzinfo=ZoneInfo("America/New_York"))
    now_utc = now.astimezone(timezone.utc)
    snap = Snapshot(symbol="X", prev_close=None, day_open=10.0, last_trade_price=10.2, prev_day_volume=6e6)
    out = build_gap_intel_snapshot(
        symbol="X",
        snapshot=snap,
        bars_1m=[],
        market_status=None,
        trading_mode="swing",
        now_utc=now_utc,
        prev_session_bar=None,
    )
    assert out["levels"]["fill_source"] == "NOT_DERIVABLE"
    assert out["scenario_builder"]["state"] == "DISABLED"
