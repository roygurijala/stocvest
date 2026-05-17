"""Swing composite engine: data windows and analyzer wiring (mocked Polygon)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stocvest.config.signal_parameters import SwingTechnicalParameters, default_signal_parameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier
from stocvest.signals.technical_analyzer import TechnicalAnalyzer


def _daily(symbol: str, i: int, close: float, vol: float = 5e6) -> Bar:
    d0 = datetime(2024, 1, 2, tzinfo=timezone.utc)
    o = close * 0.998
    return Bar(
        symbol=symbol,
        timestamp=d0 + timedelta(days=i),
        timeframe=Timeframe.DAY_1,
        open=o,
        high=close * 1.01,
        low=close * 0.99,
        close=close,
        volume=vol,
    )


def _bullish_daily_series(symbol: str, n: int) -> list[Bar]:
    p = 100.0
    out: list[Bar] = []
    for i in range(n):
        p *= 1.008
        out.append(_daily(symbol, i, p))
    return out


@pytest.fixture
def _mute_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    rec = MagicMock()
    rec.record_signal = MagicMock()
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_signal_recorder", lambda: rec)
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_cached_sector_returns", lambda _etf: None)


@pytest.mark.asyncio
async def test_swing_fetches_daily_bars_not_1min(_mute_side_effects: None, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, object]] = []

    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            calls.append((symbol, timeframe))
            n = int(kwargs.get("limit") or 210)
            if timeframe == Timeframe.DAY_1:
                return _bullish_daily_series(symbol, min(n, 220))
            return [_daily(symbol, i, 100.0 + i * 0.01) for i in range(10)]

        async def get_snapshot(self, symbol):
            sym = symbol or "AAPL"
            return Snapshot(
                symbol=sym,
                last_trade_price=180.0,
                prev_close=178.0,
                change_percent=0.8,
                change=2.0,
                day_close=180.0,
                day_volume=50_000_000,
                day_vwap=179.0,
                day_high=181.0,
                day_low=177.0,
            )

        async def get_market_news(self, **kwargs):
            now = datetime.now(timezone.utc)
            return [
                {
                    "title": "Test earnings beat",
                    "tickers": ["AAPL"],
                    "published_utc": now.isoformat(),
                    "insights": [{"sentiment": "positive"}],
                    "publisher": {"name": "Reuters"},
                }
            ]

        async def get_economic_calendar_range(self, *a, **k):
            return []

    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.PolygonClient", FakePoly)
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(
            return_value=Snapshot(
                symbol="I:VIX",
                last_trade_price=17.0,
                change_percent=-1.0,
                prev_close=17.2,
            )
        ),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )

    from stocvest.api.services.swing_composite_engine import build_swing_composite_response

    out = await build_swing_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    assert out.get("mode") == "swing"
    assert out.get("signal_basis") == "daily_bars_rth"
    lbl = str(out.get("signal_basis_label") or "")
    assert lbl and "daily" in lbl.lower()
    tech_layer = next(x for x in out["layers"] if x["layer"] == "technical")
    for c in tech_layer.get("chips", []):
        assert "VWAP" not in c or "Daily" in c
        assert "(session)" not in c
        assert "ORB" not in c
        assert "Opening Range" not in c
    assert any(tf == Timeframe.DAY_1 for sym, tf in calls if sym == "AAPL")
    assert not any(tf == Timeframe.MIN_1 for _, tf in calls)


@pytest.mark.asyncio
async def test_swing_news_uses_extended_lookback(_mute_side_effects: None, monkeypatch: pytest.MonkeyPatch) -> None:
    news_calls: list[dict] = []

    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            n = min(int(kwargs.get("limit") or 210), 220)
            return _bullish_daily_series(symbol, n)

        async def get_snapshot(self, symbol):
            sym = symbol or "AAPL"
            return Snapshot(
                symbol=sym,
                last_trade_price=180.0,
                prev_close=178.0,
                change_percent=0.8,
                change=2.0,
                day_close=180.0,
                day_volume=50_000_000,
                day_vwap=179.0,
                day_high=181.0,
                day_low=177.0,
            )

        async def get_market_news(self, **kwargs):
            news_calls.append(kwargs)
            now = datetime.now(timezone.utc)
            return [
                {
                    "title": "Test",
                    "tickers": ["AAPL"],
                    "published_utc": now.isoformat(),
                    "insights": [{"sentiment": "positive"}],
                    "publisher": {"name": "Reuters"},
                }
            ]

        async def get_economic_calendar_range(self, *a, **k):
            return []

    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.PolygonClient", FakePoly)
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(
            return_value=Snapshot(
                symbol="I:VIX",
                last_trade_price=17.0,
                change_percent=-1.0,
                prev_close=17.2,
            )
        ),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )

    from stocvest.api.services.swing_composite_engine import build_swing_composite_response

    await build_swing_composite_response(
        symbol="AAPL", user_id=None, user_email=None, params=default_signal_parameters()
    )
    assert news_calls, "expected news fetch"
    gte = news_calls[0].get("published_utc_gte")
    assert gte is not None
    delta_sec = (datetime.now(timezone.utc) - gte).total_seconds()
    assert delta_sec >= 119 * 3600, "swing composite should fetch ~5d/120h of news"
    assert delta_sec <= 125 * 3600


@pytest.mark.asyncio
async def test_swing_uses_swing_technical_not_day(_mute_side_effects: None, monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            return _bullish_daily_series(symbol, 220)

        async def get_snapshot(self, symbol):
            sym = symbol or "AAPL"
            return Snapshot(
                symbol=sym,
                last_trade_price=180.0,
                prev_close=178.0,
                change_percent=0.8,
                change=2.0,
                day_close=180.0,
                day_volume=50_000_000,
                day_vwap=179.0,
                day_high=181.0,
                day_low=177.0,
            )

        async def get_market_news(self, **kwargs):
            now = datetime.now(timezone.utc)
            return [
                {
                    "title": "Test",
                    "tickers": ["AAPL"],
                    "published_utc": now.isoformat(),
                    "insights": [{"sentiment": "positive"}],
                    "publisher": {"name": "Reuters"},
                }
            ]

        async def get_economic_calendar_range(self, *a, **k):
            return []

    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.PolygonClient", FakePoly)
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(
            return_value=Snapshot(
                symbol="I:VIX",
                last_trade_price=17.0,
                change_percent=-1.0,
                prev_close=17.2,
            )
        ),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )

    mock_analyze = MagicMock(side_effect=AssertionError("TechnicalAnalyzer should not run for swing composite"))
    monkeypatch.setattr(TechnicalAnalyzer, "analyze", mock_analyze)

    real_swing = __import__(
        "stocvest.signals.swing_technical_analyzer",
        fromlist=["SwingTechnicalAnalyzer"],
    ).SwingTechnicalAnalyzer
    called = {"n": 0}

    def _track_analyze(*args, **kwargs):
        called["n"] += 1
        return real_swing().analyze(*args, **kwargs)

    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SwingTechnicalAnalyzer",
        lambda: MagicMock(analyze=_track_analyze),
    )

    from stocvest.api.services.swing_composite_engine import build_swing_composite_response

    out = await build_swing_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    assert out.get("status") != "insufficient_data"
    assert called["n"] == 1


def test_swing_chips_differ_from_day_chips() -> None:
    from stocvest.config.signal_parameters import TechnicalParameters
    from stocvest.signals.swing_technical_analyzer import SwingTechnicalAnalyzer

    daily = _bullish_daily_series("AAPL", 220)
    swing = SwingTechnicalAnalyzer().analyze(
        "AAPL",
        daily,
        Snapshot(
            symbol="AAPL",
            last_trade_price=daily[-1].close,
            prev_close=daily[-2].close,
            change_percent=1.0,
            change=1.0,
        ),
        SwingTechnicalParameters(),
    )
    from tests.signals.conftest import make_bars

    intraday = make_bars(120, trend=0.0008)
    day_tech = TechnicalAnalyzer().analyze(
        "AAPL",
        intraday,
        Snapshot(
            symbol="AAPL",
            last_trade_price=intraday[-1].close,
            prev_close=intraday[0].open,
            change_percent=0.5,
            change=0.5,
            day_volume=10e6,
            day_vwap=intraday[-1].close,
        ),
        TechnicalParameters(),
    )
    swing_txt = " ".join(swing.chips)
    day_txt = " ".join(day_tech.chips or [])
    assert "VWAP" in day_txt.upper() or "ORB" in day_txt.upper()
    assert "SMA50" in swing_txt or "SMA200" in swing_txt


@pytest.mark.asyncio
async def test_swing_response_includes_earnings_horizon_fields(
    _mute_side_effects: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import date

    from stocvest.data.earnings_calendar import EarningsHorizon

    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            return _bullish_daily_series(symbol, 220)

        async def get_snapshot(self, symbol):
            sym = symbol or "AAPL"
            return Snapshot(
                symbol=sym,
                last_trade_price=180.0,
                prev_close=178.0,
                change_percent=0.8,
                change=2.0,
                day_close=180.0,
                day_volume=50_000_000,
            )

        async def get_market_news(self, **kwargs):
            return []

        async def get_economic_calendar_range(self, *a, **k):
            return []

    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.PolygonClient", FakePoly)
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(
            return_value=Snapshot(
                symbol="I:VIX",
                last_trade_price=17.0,
                change_percent=-1.0,
                prev_close=17.2,
            )
        ),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )
    horizon = EarningsHorizon(
        report_date=date(2026, 5, 20),
        days_away=3,
        risk="elevated",
        report_time="after_market",
        chip="⚠️ Earnings in 3 days",
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.resolve_upcoming_earnings_horizon",
        AsyncMock(return_value=horizon),
    )

    from stocvest.api.services.swing_composite_engine import build_swing_composite_response

    out = await build_swing_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    assert out.get("upcoming_earnings_date") == "2026-05-20"
    assert out.get("earnings_days_away") == 3
    assert out.get("earnings_risk") == "elevated"
    assert out.get("earnings_report_time") == "after_market"
    assert out.get("earnings_chip") == "⚠️ Earnings in 3 days"
    assert out.get("mode") == "swing"
