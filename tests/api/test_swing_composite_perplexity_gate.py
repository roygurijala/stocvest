"""Swing composite Perplexity gating (ADR-001 DBZ-5)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier


def _daily(symbol: str, i: int, close: float) -> Bar:
    d0 = datetime(2024, 1, 2, tzinfo=timezone.utc)
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


@pytest.fixture
def _mute_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    rec = MagicMock()
    rec.record_signal = MagicMock()
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_signal_recorder", lambda: rec)
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_cached_sector_returns", lambda _etf: None)


def _fake_poly_factory(*, news_rows: list[dict] | None = None):
    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            n = int(kwargs.get("limit") or 210)
            return [_daily(symbol, i, 100.0 + i) for i in range(min(n, 220))]

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
            return list(news_rows or [])

        async def get_economic_calendar_range(self, *a, **k):
            return []

    return FakePoly


@pytest.mark.asyncio
async def test_swing_bulk_default_skips_perplexity(_mute_side_effects: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.PolygonClient",
        _fake_poly_factory(),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(return_value=Snapshot(symbol="I:VIX", last_trade_price=17.0, prev_close=17.2)),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )
    with patch(
        "stocvest.api.services.swing_composite_engine.maybe_apply_perplexity_layers",
        new_callable=AsyncMock,
        side_effect=lambda **kw: (kw["news"], kw["macro"], None, None),
    ) as mock_px, patch(
        "stocvest.api.services.swing_composite_engine.resolve_analyst_target_levels",
        new_callable=AsyncMock,
        return_value=([], "none"),
    ) as mock_analyst:
        from stocvest.api.services.swing_composite_engine import build_swing_composite_response

        await build_swing_composite_response(
            symbol="AAPL",
            user_id=None,
            user_email=None,
            params=default_signal_parameters(),
        )
    mock_px.assert_awaited_once()
    assert mock_px.await_args.kwargs.get("enabled") is False
    mock_analyst.assert_awaited_once()
    assert mock_analyst.await_args.kwargs.get("allow_perplexity") is False


@pytest.mark.asyncio
async def test_swing_deep_dive_enables_perplexity(_mute_side_effects: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.PolygonClient",
        _fake_poly_factory(),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(return_value=Snapshot(symbol="I:VIX", last_trade_price=17.0, prev_close=17.2)),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )
    with patch(
        "stocvest.api.services.swing_composite_engine.maybe_apply_perplexity_layers",
        new_callable=AsyncMock,
        side_effect=lambda **kw: (kw["news"], kw["macro"], None, None),
    ) as mock_px, patch(
        "stocvest.api.services.swing_composite_engine.resolve_analyst_target_levels",
        new_callable=AsyncMock,
        return_value=([], "none"),
    ) as mock_analyst:
        from stocvest.api.services.swing_composite_engine import build_swing_composite_response

        await build_swing_composite_response(
            symbol="AAPL",
            user_id="user-1",
            user_email=None,
            params=default_signal_parameters(),
            perplexity_mode="deep_dive",
        )
    assert mock_px.await_args.kwargs.get("enabled") is True
    assert mock_px.await_args.kwargs.get("on_demand") is True
    assert mock_analyst.await_args.kwargs.get("allow_perplexity") is True


@pytest.mark.asyncio
async def test_swing_deep_dive_fetches_news_for_us_empty_polygon(
    _mute_side_effects: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Deep dive must bypass legacy Benzinga thin heuristic for US zero-headline names."""
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.PolygonClient",
        _fake_poly_factory(),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.get_vix_snapshot_with_fallback",
        AsyncMock(return_value=Snapshot(symbol="I:VIX", last_trade_price=17.0, prev_close=17.2)),
    )
    monkeypatch.setattr(
        "stocvest.api.services.swing_composite_engine.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=("XLK", "Technology", "technology", SectorResolutionState.RESOLVED, SicMappingTier.EXACT)
        ),
    )
    with patch(
        "stocvest.api.services.symbol_perplexity_enrichment.fetch_news_enrichment",
        new_callable=AsyncMock,
        return_value=None,
    ) as mock_fetch_news:
        from stocvest.api.services.swing_composite_engine import build_swing_composite_response

        await build_swing_composite_response(
            symbol="AAPL",
            user_id="user-1",
            user_email=None,
            params=default_signal_parameters(),
            perplexity_mode="deep_dive",
        )
    mock_fetch_news.assert_awaited_once()
