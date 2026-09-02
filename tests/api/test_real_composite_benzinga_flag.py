"""Day composite Benzinga flag + Perplexity gating (ADR-001 DBZ-7)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.benzinga_client import BenzingaFeedHealth, BenzingaMultiResult
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier
from stocvest.utils.config import get_settings
from tests.api.test_class_share_symbol_normalization import _mute_shared


def _intraday(symbol: str, n: int, close: float) -> Bar:
    d0 = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)
    return Bar(
        symbol=symbol,
        timestamp=d0 + timedelta(minutes=n),
        timeframe=Timeframe.MIN_1,
        open=close * 0.999,
        high=close * 1.001,
        low=close * 0.998,
        close=close,
        volume=1e5,
    )


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
def _mute_day_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    module = "stocvest.api.services.real_composite_engine"
    _mute_shared(monkeypatch, module)
    monkeypatch.setattr(f"{module}.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr(f"{module}.get_cached_sector_returns", lambda _etf: [])


def _fake_poly_factory(*, news_rows: list[dict] | None = None):
    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            if timeframe == Timeframe.DAY_1:
                n = int(kwargs.get("limit") or 210)
                return [_daily(symbol, i, 100.0 + i) for i in range(min(n, 220))]
            n = int(kwargs.get("limit") or 60)
            return [_intraday(symbol, i, 100.0 + i * 0.01) for i in range(n)]

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
                prev_day_volume=50_000_000,
            )

        async def get_market_news(self, **kwargs):
            return list(news_rows or [])

        async def get_economic_calendar_for_day(self, *a, **k):
            return []

    return FakePoly


def _empty_benzinga_bundle() -> BenzingaMultiResult:
    return BenzingaMultiResult(
        analyst_feed_configured=False,
        feed_health=BenzingaFeedHealth(
            news="ok",
            wim="ok",
            ratings="ok",
            guidance="ok",
            earnings="ok",
            bundle="ok",
        ),
    )


@pytest.mark.asyncio
async def test_day_composite_polygon_primary_news_source_default(
    _mute_day_side_effects: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ADR-001 Phase 7: day desk uses Polygon news only when Benzinga flag is off (default)."""

    benzinga_calls: list[str] = []

    class SpyBenzinga:
        def __init__(self, *a, **k):
            pass

        async def get_multi(self, symbol: str, **kwargs: object) -> BenzingaMultiResult:
            benzinga_calls.append(symbol)
            raise AssertionError("BenzingaClient.get_multi must not run when day flag is off")

    monkeypatch.setenv("STOCVEST_DAY_COMPOSITE_BENZINGA_ENABLED", "0")
    get_settings.cache_clear()
    monkeypatch.setattr("stocvest.api.services.real_composite_engine.BenzingaClient", SpyBenzinga)
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.PolygonClient",
        _fake_poly_factory(
            news_rows=[
                {
                    "title": "Polygon headline",
                    "tickers": ["AAPL"],
                    "published_utc": datetime.now(timezone.utc).isoformat(),
                    "insights": [{"sentiment": "positive"}],
                    "publisher": {"name": "Reuters"},
                }
            ]
        ),
    )

    from stocvest.api.services.real_composite_engine import build_real_composite_response
    from stocvest.api.services.swing_news_source import SWING_NEWS_SOURCE_POLYGON_PRIMARY

    out = await build_real_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    assert benzinga_calls == []
    assert out.get("news_source") == SWING_NEWS_SOURCE_POLYGON_PRIMARY
    assert "benzinga_feed_health" not in out
    assert out.get("mode") == "day"


@pytest.mark.asyncio
async def test_day_composite_benzinga_flag_on_invokes_get_multi(
    _mute_day_side_effects: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    benzinga_calls: list[str] = []

    class StubBenzinga:
        def __init__(self, *a, **k):
            pass

        async def get_multi(self, symbol: str, **kwargs: object) -> BenzingaMultiResult:
            benzinga_calls.append(symbol)
            return _empty_benzinga_bundle()

    monkeypatch.setenv("STOCVEST_DAY_COMPOSITE_BENZINGA_ENABLED", "1")
    get_settings.cache_clear()
    monkeypatch.setattr("stocvest.api.services.real_composite_engine.BenzingaClient", StubBenzinga)
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.ensure_analyst_feed",
        AsyncMock(side_effect=lambda _bz, sym, data: data),
    )
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.PolygonClient",
        _fake_poly_factory(),
    )

    from stocvest.api.services.real_composite_engine import build_real_composite_response

    out = await build_real_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    assert benzinga_calls == ["AAPL"]
    assert out.get("benzinga_feed_health") is not None
    assert "news_source" not in out or out.get("news_source") != "polygon_primary"
    assert out.get("mode") == "day"


@pytest.mark.asyncio
async def test_day_bulk_default_skips_perplexity(
    _mute_day_side_effects: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.PolygonClient",
        _fake_poly_factory(),
    )
    with patch(
        "stocvest.api.services.real_composite_engine.maybe_apply_perplexity_layers",
        new_callable=AsyncMock,
        side_effect=lambda **kw: (kw["news"], kw["macro"], None, None),
    ) as mock_px, patch(
        "stocvest.api.services.real_composite_engine.resolve_analyst_target_levels",
        new_callable=AsyncMock,
        return_value=([], "none"),
    ) as mock_analyst:
        from stocvest.api.services.real_composite_engine import build_real_composite_response

        await build_real_composite_response(
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
async def test_day_deep_dive_enables_perplexity(
    _mute_day_side_effects: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "stocvest.api.services.real_composite_engine.PolygonClient",
        _fake_poly_factory(),
    )
    with patch(
        "stocvest.api.services.real_composite_engine.maybe_apply_perplexity_layers",
        new_callable=AsyncMock,
        side_effect=lambda **kw: (kw["news"], kw["macro"], None, None),
    ) as mock_px, patch(
        "stocvest.api.services.real_composite_engine.resolve_analyst_target_levels",
        new_callable=AsyncMock,
        return_value=([], "none"),
    ) as mock_analyst:
        from stocvest.api.services.real_composite_engine import build_real_composite_response

        await build_real_composite_response(
            symbol="AAPL",
            user_id="user-1",
            user_email=None,
            params=default_signal_parameters(),
            perplexity_mode="deep_dive",
        )
    assert mock_px.await_args.kwargs.get("enabled") is True
    assert mock_px.await_args.kwargs.get("on_demand") is True
    assert mock_analyst.await_args.kwargs.get("allow_perplexity") is True
