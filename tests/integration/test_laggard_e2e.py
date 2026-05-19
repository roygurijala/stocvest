"""Laggard Intelligence Engine — integration tests (Chunk 11)."""

from __future__ import annotations

import itertools
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.data.sector_peer_registry import get_all_peer_groups, get_all_registry_symbols
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.signals.dynamic_cluster_detector import detect_all_dynamic_clusters
from stocvest.signals.laggard_assembler import compute_laggard_signal
from stocvest.data import price_cache as pc
from stocvest.data.sector_peer_registry import PeerGroupType
from stocvest.signals.laggard_detector import (
    LaggardContext,
    LaggardResult,
    LaggardType,
    PeerMove,
)
from stocvest.signals.laggard_narrative import _validate_narrative, build_narrative
from stocvest.workers import pre_ipo_monitor as pim
from stocvest.workers.market_open_setup import warm_price_cache_job


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
def _mute_swing_side_effects(monkeypatch: pytest.MonkeyPatch) -> None:
    rec = MagicMock()
    rec.record_signal = MagicMock()
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_signal_recorder", lambda: rec)
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr("stocvest.api.services.swing_composite_engine.get_cached_sector_returns", lambda _etf: None)


@pytest.mark.asyncio
async def test_full_swing_signal_includes_laggard_field(
    _mute_swing_side_effects: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Swing composite always exposes `laggard_signal` (may be null when cache is cold)."""

    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            n = int(kwargs.get("limit") or 210)
            if timeframe == Timeframe.DAY_1:
                return _bullish_daily_series(symbol, min(n, 220))
            return []

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

    from stocvest.signals.sector_mapper import SectorResolutionState
    from stocvest.signals.sector_sic_fallback import SicMappingTier

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
    assert "laggard_signal" in out
    lag = out["laggard_signal"]
    assert lag is None or isinstance(lag, dict)


@pytest.mark.asyncio
async def test_laggard_null_for_day_mode() -> None:
    """Day-mode assembler path returns None — never surfaces swing laggard context."""
    out = await compute_laggard_signal(
        symbol="AVGO",
        news_verdict="neutral",
        has_earnings_risk=False,
        tech_score=60.0,
        symbol_move_1d=0.2,
        symbol_vol_today=1e7,
        mode="day",
    )
    assert out is None


def test_registry_covers_watchlist_symbols_without_error() -> None:
    """Every default-watchlist symbol is either in the registry or safely handled by the pipeline."""
    store = get_watchlist_store()
    wl = store.create_watchlist("lag-e2e", "E2E", ["PLTR", "AVGO", "ZZZZZ"], is_default=True)
    symbols = [s.upper() for s in wl.symbols]
    registry = set(get_all_registry_symbols())
    for sym in symbols:
        groups = get_all_peer_groups(sym)
        in_registry = sym in registry
        assert in_registry or groups == [] or isinstance(groups, list)
        # Pipeline must not raise for any watchlist ticker.
        import asyncio

        result = asyncio.run(
            compute_laggard_signal(
                symbol=sym,
                news_verdict="neutral",
                has_earnings_risk=False,
                tech_score=55.0,
                symbol_move_1d=0.1,
                symbol_vol_today=1e6,
                mode="swing",
            )
        )
        assert result is None or isinstance(result, dict)


class _FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.data.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        _ = ttl
        self.data[key] = value

    def pipeline(self) -> _FakeRedis:
        return self

    def execute(self) -> list[None]:
        return []


@pytest.mark.asyncio
async def test_price_cache_warm_completes(monkeypatch: pytest.MonkeyPatch) -> None:
    """Price cache warm job completes with mocked Polygon bars."""

    class FakePoly:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get_bars(self, symbol, timeframe, **kwargs):
            _ = (timeframe, kwargs)
            return _bullish_daily_series(symbol, 25)

    monkeypatch.setattr("stocvest.workers.market_open_setup.PolygonClient", FakePoly)
    monkeypatch.setattr(
        "stocvest.workers.market_open_setup.get_settings",
        lambda: MagicMock(polygon_api_key="test-key"),
    )
    monkeypatch.setattr(pc, "get_sync_redis", lambda: _FakeRedis())

    result = await warm_price_cache_job(concurrency=5)
    assert result["job"] == "warm_price_cache"
    assert int(result["symbols"]) > 50
    assert int(result["cached"]) > 50


@pytest.mark.asyncio
async def test_pre_ipo_monitor_no_perplexity_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pre-IPO monitor writes Redis on success and returns 200 on Perplexity failure."""

    async def fake_fetch() -> tuple[list[str], str]:
        return ["OpenAI"], "Funding headline"

    monkeypatch.setattr(pim, "fetch_pre_ipo_from_perplexity", fake_fetch)
    mock_r = MagicMock()
    with patch("stocvest.workers.pre_ipo_monitor.get_sync_redis", return_value=mock_r):
        resp = await pim.run_pre_ipo_monitor()
    assert "OpenAI" in resp["activated_entities"]
    mock_r.setex.assert_called_once()
    key = mock_r.setex.call_args[0][0]
    assert key.startswith("stocvest:pre_ipo_active:")
    payload = json.loads(mock_r.setex.call_args[0][2])
    assert "OpenAI" in payload

    with patch("stocvest.workers.pre_ipo_monitor.get_sync_redis", return_value=MagicMock()):
        with patch.object(pim, "run_pre_ipo_monitor", side_effect=RuntimeError("perplexity down")):
            handler_resp = pim.handler({}, None)
    assert handler_resp["statusCode"] == 200
    assert handler_resp["activated_entities"] == []


def test_dynamic_clusters_empty_when_quiet_market() -> None:
    """Quiet universe (all moves < 0.3%) yields no clusters without raising."""

    class _QuietCache:
        def get_1d_change(self, symbol: str) -> float | None:
            _ = symbol
            return 0.15

        def get_5d_change(self, symbol: str) -> float | None:
            _ = symbol
            return 0.2

        def get_volume_ratio(self, symbol: str) -> float:
            _ = symbol
            return 1.0

        def list_cached_symbols(self) -> list[str]:
            return [f"S{i}" for i in range(12)]

    clusters = detect_all_dynamic_clusters(_QuietCache(), min_dominance_score=2.0, min_cluster_size=3)
    assert clusters == []


def test_narrative_passes_validation_for_all_types() -> None:
    """Every driver × laggard-type combo passes narrative validation (no forbidden words)."""
    drivers = ("sector", "index", "theme", "macro", "pre_ipo_proxy", "dynamic_cluster")
    types = (LaggardType.CATCH_UP, LaggardType.PRE_BREAKOUT, LaggardType.DISTRIBUTION)
    for driver, ltype in itertools.product(drivers, types):
        sector_name = (
            "Dynamic cluster: RKLB driving 4 stocks"
            if driver == "dynamic_cluster"
            else "Semiconductors"
        )
        ctx = LaggardContext(
            symbol="TEST",
            symbol_move_1d=0.2,
            symbol_move_5d=-1.0,
            symbol_vol_ratio=1.0,
            technical_structure="intact",
            news_clean=True,
            has_earnings_risk=False,
            etf_move_1d=1.2,
            etf_move_5d=1.0,
            peer_moves=(PeerMove(symbol="NVDA", pct_change_1d=3.5, pct_change_5d=5.0, volume_ratio=1.1),),
            sector_name=sector_name,
            sector_etf="SOXX" if driver == "sector" else None,
            group_type=PeerGroupType.SECTOR,
            requires_etf_confirmation=driver == "sector",
            lag_threshold=1.5,
            min_peers_for_signal=3,
            trigger_entity="OpenAI" if driver == "pre_ipo_proxy" else None,
            registry_key="dynamic_rklb" if driver == "dynamic_cluster" else "semiconductors",
        )
        result = LaggardResult(
            laggard_type=ltype,
            confidence="high",
            laggard_score=75.0,
            avg_peer_move_1d=3.2,
            avg_peer_move_5d=4.5,
            lag_vs_peers_1d=3.0,
            lag_vs_peers_5d=5.5,
            lag_vs_etf_1d=2.8,
            peers_moving=(
                PeerMove(symbol="NVDA", pct_change_1d=4.1, pct_change_5d=5.0, volume_ratio=1.2),
            ),
            volume_pattern="accumulating",
            driver_type=driver,
            group_name=sector_name,
            trigger_entity="OpenAI" if driver == "pre_ipo_proxy" else None,
        )
        narrative = build_narrative(ctx, result)
        _validate_narrative(narrative)
        forbidden = ("will", "buy", "sell", "profit", "opportunity")
        blob = f" {narrative.explanation.lower()} {narrative.what_to_watch.lower()} "
        for word in forbidden:
            assert f" {word} " not in blob, f"forbidden '{word}' for {driver}/{ltype}"
