"""Position composite engine + handler wiring (POS-D4)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.fundamentals_provider import FundamentalsProviderFixtures, FundamentalsProviderMock
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier
from tests.signals.position_fundamentals.conftest import quality_snapshot


def _daily(symbol: str, i: int, close: float) -> Bar:
    d0 = datetime(2022, 1, 3, tzinfo=timezone.utc)
    return Bar(
        symbol=symbol,
        timestamp=d0 + timedelta(days=i),
        timeframe=Timeframe.DAY_1,
        open=close * 0.998,
        high=close * 1.01,
        low=close * 0.99,
        close=close,
        volume=5e6,
    )


def _bullish_daily_series(symbol: str, n: int) -> list[Bar]:
    p = 100.0
    out: list[Bar] = []
    for i in range(n):
        p *= 1.003
        out.append(_daily(symbol, i, p))
    return out


def _fundamentals_mock() -> FundamentalsProviderMock:
    snap = quality_snapshot("AAPL")
    fixtures = FundamentalsProviderFixtures(
        income_statements={"AAPL": snap.income_statements},
        balance_sheets={"AAPL": snap.balance_sheets},
        cash_flows={"AAPL": snap.cash_flows},
        ratios={"AAPL": snap.ratios},
        key_metrics={"AAPL": snap.key_metrics},
        sector_peers={"AAPL": snap.sector_peers},
    )
    return FundamentalsProviderMock(fixtures)


@pytest.fixture
def _mute_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("stocvest.api.services.position_composite_engine.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr("stocvest.api.services.position_composite_engine.get_cached_sector_returns", lambda _etf: None)
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.get_user_profile_store",
        lambda: MagicMock(get_profile=MagicMock(return_value=None)),
    )


@pytest.mark.asyncio
async def test_position_composite_mode_and_fundamentals(_mute_side_effects: None, monkeypatch: pytest.MonkeyPatch) -> None:
    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            n = int(kwargs.get("limit") or 400)
            if timeframe == Timeframe.DAY_1:
                return _bullish_daily_series(symbol, min(n, 400))
            return []

        async def get_snapshot(self, symbol):
            sym = symbol or "AAPL"
            return Snapshot(
                symbol=sym,
                last_trade_price=180.0,
                prev_close=178.0,
                change_percent=0.8,
                day_close=180.0,
                day_volume=50_000_000,
            )

        async def get_market_news(self, **kwargs):
            now = datetime.now(timezone.utc)
            return [
                {
                    "title": "AAPL long-term outlook",
                    "tickers": ["AAPL"],
                    "published_utc": now.isoformat(),
                    "insights": [{"sentiment": "positive"}],
                }
            ]

        async def get_economic_calendar_range(self, *a, **k):
            return []

    monkeypatch.setattr("stocvest.api.services.position_composite_engine.PolygonClient", FakePoly)
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(return_value=Snapshot(symbol="I:VIX", last_trade_price=17.0, prev_close=17.2)),
    )
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.resolve_upcoming_earnings_horizon",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.resolve_analyst_target_levels",
        AsyncMock(return_value=([195.0], "benzinga")),
    )

    from stocvest.api.services.position_composite_engine import build_position_composite_response

    out = await build_position_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
        fundamentals_provider=_fundamentals_mock(),
    )

    assert out.get("mode") == "position"
    assert out.get("signal_valid_days") == 90
    assert "signal_expires" in out
    assert out.get("signal_basis") == "weekly_bars_structural"
    # A1/A2: honest basis label reflects the technical state; structure-broken flag present.
    assert isinstance(out.get("signal_basis_label"), str) and out["signal_basis_label"].strip()
    assert isinstance(out.get("signal_structure_broken"), bool)
    # Holder read is ship-dark: absent unless the flag is flipped on.
    assert "position_holder_read" not in out

    # Flag ON → owner-oriented holder read attached (reuses the same mocks/fixture).
    from stocvest.utils.config import get_settings

    monkeypatch.setenv("STOCVEST_POSITION_HOLDER_READ_ENABLED", "true")
    get_settings.cache_clear()
    try:
        out_holder = await build_position_composite_response(
            symbol="AAPL",
            user_id=None,
            user_email=None,
            params=default_signal_parameters(),
            fundamentals_provider=_fundamentals_mock(),
        )
        holder = out_holder.get("position_holder_read")
        assert isinstance(holder, dict)
        assert holder.get("stance") in ("defensive", "caution", "constructive")
        assert isinstance(holder.get("actions"), list) and holder["actions"]
    finally:
        monkeypatch.delenv("STOCVEST_POSITION_HOLDER_READ_ENABLED", raising=False)
        get_settings.cache_clear()
    pf = out.get("position_fundamentals") or {}
    assert isinstance(pf.get("pillars"), list)
    assert len(pf["pillars"]) == 5
    layer_ids = [row["layer"] for row in out["layers"]]
    assert layer_ids[0] == "fundamentals"
    assert "technical" in layer_ids
    assert out.get("status") != "insufficient_data"
    tech = next(x for x in out["layers"] if x["layer"] == "technical")
    assert tech.get("indicator_snapshot", {}).get("mode") == "position"
    assert out.get("reference_stop_level") is not None
    assert out.get("reference_target_1") is not None
    assert out.get("atr_weekly") is not None
    assert out.get("decision_state") in ("actionable", "monitor", "blocked")
    assert out.get("min_rr_desk") == 1.5
    # Wide-stop trending fixture may fail sub-1:1 structure R/R — honest incomplete/monitor.
    assert out.get("status") in ("active", "incomplete")
    if out.get("status") == "incomplete":
        assert out.get("geometry_tradeable") is False


@pytest.mark.asyncio
async def test_position_composite_insufficient_data_envelope(_mute_side_effects: None, monkeypatch: pytest.MonkeyPatch) -> None:
    class SparsePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            return _bullish_daily_series(symbol, 5)

        async def get_snapshot(self, symbol):
            return Snapshot(symbol=symbol or "XYZ", last_trade_price=10.0)

        async def get_market_news(self, **kwargs):
            return []

        async def get_economic_calendar_range(self, *a, **k):
            return []

    monkeypatch.setattr("stocvest.api.services.position_composite_engine.PolygonClient", SparsePoly)
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(return_value=(None, None, None, SectorResolutionState.PENDING_REFRESH, None)),
    )
    monkeypatch.setattr(
        "stocvest.api.services.position_composite_engine.resolve_upcoming_earnings_horizon",
        AsyncMock(return_value=None),
    )

    empty_mock = FundamentalsProviderMock(FundamentalsProviderFixtures())

    from stocvest.api.services.position_composite_engine import build_position_composite_response

    out = await build_position_composite_response(
        symbol="XYZ",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
        fundamentals_provider=empty_mock,
    )

    assert out.get("status") == "insufficient_data"
    assert out.get("mode") == "position"
    assert out.get("decision_state") == "blocked"
    assert int(out.get("available_layers") or 0) < int(out.get("required_layers") or 99)


@pytest.mark.unit
def test_position_maturation_sync_skipped() -> None:
    from stocvest.api.handlers.signals import _try_sync_watchlist_maturation_from_evidence

    assert (
        _try_sync_watchlist_maturation_from_evidence(
            user_id="user-1",
            symbol="AAPL",
            mode="position",
            body={"mode": "position", "layers": []},
        )
        is None
    )


def test_position_handler_requires_symbol() -> None:
    from stocvest.api.handlers.signals import position_real_composite_handler

    resp = position_real_composite_handler({"body": "{}"}, None)
    assert resp["statusCode"] == 400
