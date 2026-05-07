"""Swing composite must not auto-log to model portfolio; portfolio scanner uses real composite only."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest

from stocvest.config.signal_parameters import default_signal_parameters


@pytest.mark.asyncio
async def test_swing_composite_does_not_auto_log(monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.services import swing_composite_engine as sce

    log_mock = MagicMock()
    monkeypatch.setattr("stocvest.api.services.portfolio_auto_log.schedule_model_portfolio_log_from_composite", log_mock)

    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            from stocvest.data.models import Bar, Timeframe

            d0 = datetime(2024, 1, 2, tzinfo=timezone.utc)
            out = []
            for i in range(210):
                c = 100.0 + i * 0.02
                out.append(
                    Bar(
                        symbol=str(symbol),
                        timestamp=d0 + timedelta(days=i),
                        timeframe=timeframe,
                        open=c * 0.998,
                        high=c * 1.01,
                        low=c * 0.99,
                        close=c,
                        volume=5e6,
                    )
                )
            return out

        async def get_snapshot(self, symbol):
            from stocvest.data.models import Snapshot

            return Snapshot(symbol=str(symbol or "XOM"), last_trade_price=60.0, prev_close=58.0)

        async def get_market_news(self, **kwargs):
            now = datetime.now(timezone.utc)
            return [
                {
                    "title": "Strong outlook",
                    "tickers": ["XOM"],
                    "published_utc": now.isoformat(),
                    "insights": [{"sentiment": "positive"}],
                    "publisher": {"name": "Reuters"},
                }
            ]

        async def get_economic_calendar_range(self, *a, **k):
            return []

    monkeypatch.setattr(sce, "PolygonClient", FakePoly)
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(
            return_value=__import__("stocvest.data.models", fromlist=["Snapshot"]).Snapshot(
                symbol="I:VIX", last_trade_price=14.0, prev_close=14.5
            )
        ),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(return_value=("XLE", "Energy")),
    )
    rec = MagicMock()
    rec.record_signal = MagicMock()
    monkeypatch.setattr(sce, "get_signal_recorder", lambda: rec)

    await sce.build_swing_composite_response(
        symbol="XOM",
        user_id="u1",
        user_email="t@example.com",
        params=default_signal_parameters(),
        enable_portfolio_log=True,
    )
    log_mock.assert_not_called()


def test_portfolio_scanner_uses_real_not_swing() -> None:
    from stocvest.api.services import portfolio_reversal as pr

    src = inspect.getsource(pr.run_portfolio_scanner_for_symbol)
    assert "build_real_composite_response" in src
    assert "build_swing_composite_response" not in src
    assert "enable_portfolio_log=True" in src


def test_swing_signal_recorded_with_swing_mode_roundtrip() -> None:
    from stocvest.api.services.signal_recorder import InMemorySignalRecorder
    from stocvest.data.models import SignalRecord

    mem = InMemorySignalRecorder()
    now = datetime.now(timezone.utc)
    mem.record_signal(
        SignalRecord(
            signal_id="sw1",
            symbol="MMM",
            direction="bullish",
            signal_strength=70,
            pattern="swing_composite",
            layer_scores={"technical": 0.5},
            price_at_signal=100.0,
            generated_at=now,
            user_id=None,
            mode="swing",
        )
    )
    rows = mem.get_public_recent(limit=5)
    assert rows[0].get("mode") == "swing"
