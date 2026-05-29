"""Regression: class-share dash symbols (BRK-B, RDS-A, ...) must hit Polygon
in dot form (BRK.B, RDS.A) or both engines silently lose technicals + sector.

Live probe on 2026-05-13 against the deployed Polygon REST surface::

    GET /v2/aggs/ticker/BRK-B/range/1/day/...     →  results=[]      ("no bars")
    GET /v2/aggs/ticker/BRK.B/range/1/day/...     →  results=[…]     (10 bars)
    GET /v2/snapshot/.../BRK-B                    →  404 NotFound
    GET /v2/snapshot/.../BRK.B                    →  200 OK

That asymmetry, combined with ``asyncio.gather(..., return_exceptions=True)``
in the engines, meant a user typing ``BRK-B`` got:

* daily bars  = 0
* technical   = unavailable  (needs ≥60 bars)
* sector      = unavailable  (cascades from a 404 snapshot)
* composite   → ``incomplete`` / ``neutral``

These tests pin the fix added in ``stocvest/data/symbol_normalize.py``:
both ``build_swing_composite_response`` and ``build_real_composite_response``
must canonicalise the symbol *before* any Polygon call. The user-supplied
symbol form is irrelevant from this point on — every wire request must use
the dot form.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

from stocvest.config.signal_parameters import default_signal_parameters
from stocvest.data.models import Bar, Snapshot, Timeframe
from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _bullish_daily(symbol: str, n: int = 220) -> list[Bar]:
    d0 = datetime(2024, 1, 2, tzinfo=timezone.utc)
    out: list[Bar] = []
    p = 100.0
    for i in range(n):
        p *= 1.008
        out.append(
            Bar(
                symbol=symbol,
                timestamp=d0 + timedelta(days=i),
                timeframe=Timeframe.DAY_1,
                open=p * 0.998,
                high=p * 1.01,
                low=p * 0.99,
                close=p,
                volume=5e6,
            )
        )
    return out


def _intraday_minutes(symbol: str, n: int = 60) -> list[Bar]:
    d0 = datetime(2024, 1, 2, 14, 30, tzinfo=timezone.utc)
    out: list[Bar] = []
    p = 100.0
    for i in range(n):
        p *= 1.0005
        out.append(
            Bar(
                symbol=symbol,
                timestamp=d0 + timedelta(minutes=i),
                timeframe=Timeframe.MIN_1,
                open=p * 0.999,
                high=p * 1.001,
                low=p * 0.998,
                close=p,
                volume=1e5,
            )
        )
    return out


def _snap(symbol: str) -> Snapshot:
    return Snapshot(
        symbol=symbol,
        last_trade_price=180.0,
        prev_close=178.0,
        change_percent=0.8,
        change=2.0,
        day_close=180.0,
        day_volume=50_000_000,
        prev_day_volume=50_000_000,
        day_vwap=179.0,
        day_high=181.0,
        day_low=177.0,
    )


class _RecordingPoly:
    """Fake PolygonClient that records the symbol form passed to every method
    so the test can assert dash → dot canonicalisation at the wire boundary.

    Returns just enough plausible data for both engines to finish without
    hitting an ``insufficient_data`` short-circuit. Day-trade engine needs
    1-min bars; swing needs daily.
    """

    def __init__(self) -> None:
        self.bar_symbols: list[str] = []
        self.snapshot_symbols: list[str] = []
        self.news_ticker_calls: list[list[str]] = []

    def __call__(self, *a, **k):  # imitates PolygonClient(api_key=...)
        return self

    async def __aenter__(self) -> "_RecordingPoly":
        return self

    async def __aexit__(self, *a) -> None:
        return None

    async def get_bars(self, symbol: str, timeframe: Timeframe, **kwargs):
        self.bar_symbols.append(symbol)
        if timeframe == Timeframe.DAY_1:
            return _bullish_daily(symbol, 220)
        return _intraday_minutes(symbol, int(kwargs.get("limit") or 60))

    async def get_snapshot(self, symbol: str) -> Snapshot:
        self.snapshot_symbols.append(symbol)
        return _snap(symbol or "AAPL")

    async def get_market_news(self, **kwargs):
        self.news_ticker_calls.append(list(kwargs.get("tickers") or []))
        now = datetime.now(timezone.utc)
        return [
            {
                "title": "Berkshire Hathaway buyback news",
                "tickers": kwargs.get("tickers") or [],
                "published_utc": now.isoformat(),
                "insights": [{"sentiment": "positive"}],
                "publisher": {"name": "Reuters"},
            }
        ]

    async def get_economic_calendar_range(self, *a, **k):
        return []

    async def get_economic_calendar_for_day(self, *a, **k):
        return []

    async def get_ticker_details(self, symbol: str) -> dict:
        sym = (symbol or "AAPL").strip().upper()
        return {
            "ticker": sym,
            "active": True,
            "market_cap": 3_000_000_000_000,
            "type": "CS",
            "locale": "us",
            "country_code": "US",
            "primary_exchange": "XNAS",
            "list_date": "1980-12-12",
            "name": f"{sym} Inc.",
        }

    async def _get(self, path: str, params: dict | None = None) -> dict:
        if path == "/v3/reference/splits":
            return {"results": []}
        return {"results": []}


# ---------------------------------------------------------------------------
# Shared side-effect mutes (Benzinga, signal recorder, sector cache, VIX, sector mapper)
# ---------------------------------------------------------------------------


def _mute_shared(monkeypatch: pytest.MonkeyPatch, module: str) -> None:
    rec = MagicMock()
    rec.record_signal = MagicMock()
    rec.record_real_signal = MagicMock()
    rec.record_swing_signal = MagicMock()
    monkeypatch.setattr(f"{module}.get_signal_recorder", lambda: rec)
    monkeypatch.setattr(
        f"{module}.get_vix_snapshot_with_fallback",
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
        f"{module}.SectorMapper.get_sector_etf",
        AsyncMock(
            return_value=(
                "XLF",
                "Financials",
                "financials",
                SectorResolutionState.RESOLVED,
                SicMappingTier.EXACT,
            )
        ),
    )


# ---------------------------------------------------------------------------
# Swing engine — BRK-B at entry must become BRK.B at every Polygon call
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_swing_engine_canonicalises_class_share_dash_at_entry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = "stocvest.api.services.swing_composite_engine"
    monkeypatch.setattr(f"{module}.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr(f"{module}.get_cached_sector_returns", lambda _etf: None)
    _mute_shared(monkeypatch, module)

    poly = _RecordingPoly()
    monkeypatch.setattr(f"{module}.PolygonClient", poly)

    from stocvest.api.services.swing_composite_engine import build_swing_composite_response

    out = await build_swing_composite_response(
        symbol="BRK-B",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )

    # 1. The symbol field on the response reflects the canonical (Polygon) form.
    assert out.get("symbol") == "BRK.B", (
        "Engine must canonicalise symbol at entry so downstream UI and"
        " comparisons use the same form Polygon uses."
    )

    # 2. The wire calls Polygon — bars + snapshot — never see the dash form.
    assert poly.bar_symbols, "engine must fetch bars"
    assert poly.snapshot_symbols, "engine must fetch snapshots"
    assert "BRK-B" not in poly.bar_symbols, (
        f"bars endpoint received the dash form (would 0-bar): {poly.bar_symbols!r}"
    )
    assert "BRK-B" not in poly.snapshot_symbols, (
        f"snapshot endpoint received the dash form (would 404): {poly.snapshot_symbols!r}"
    )
    # The target symbol specifically must reach Polygon as BRK.B at least once.
    assert "BRK.B" in poly.bar_symbols
    assert "BRK.B" in poly.snapshot_symbols

    # 3. News fetch passes the canonical form to Polygon too.
    flat_news_tickers = [t for batch in poly.news_ticker_calls for t in batch]
    assert "BRK-B" not in flat_news_tickers
    assert "BRK.B" in flat_news_tickers

    # 4. The composite is not collapsed to insufficient_data — fix actually
    #    restored the previously-broken read.
    assert out.get("status") != "insufficient_data"


# ---------------------------------------------------------------------------
# Day-trade engine — same regression, same fix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_real_engine_canonicalises_class_share_dash_at_entry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = "stocvest.api.services.real_composite_engine"
    _mute_shared(monkeypatch, module)

    poly = _RecordingPoly()
    monkeypatch.setattr(f"{module}.PolygonClient", poly)

    from stocvest.api.services.real_composite_engine import build_real_composite_response

    out = await build_real_composite_response(
        symbol="BRK-B",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )

    assert out.get("symbol") == "BRK.B", (
        "Day-trade engine must canonicalise at entry — otherwise the wire"
        " request silently 404s and the layer cascade goes unavailable."
    )

    assert poly.bar_symbols, "day-trade engine must fetch bars"
    assert poly.snapshot_symbols, "day-trade engine must fetch snapshots"
    assert "BRK-B" not in poly.bar_symbols
    assert "BRK-B" not in poly.snapshot_symbols
    assert "BRK.B" in poly.bar_symbols
    assert "BRK.B" in poly.snapshot_symbols

    flat_news_tickers = [t for batch in poly.news_ticker_calls for t in batch]
    assert "BRK-B" not in flat_news_tickers


# ---------------------------------------------------------------------------
# Hygiene: non-class-share symbols are unaffected (smoke check, no regression)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_swing_engine_leaves_normal_symbols_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    module = "stocvest.api.services.swing_composite_engine"
    monkeypatch.setattr(f"{module}.get_all_cached_sector_data", lambda: {})
    monkeypatch.setattr(f"{module}.get_cached_sector_returns", lambda _etf: None)
    _mute_shared(monkeypatch, module)

    poly = _RecordingPoly()
    monkeypatch.setattr(f"{module}.PolygonClient", poly)

    from stocvest.api.services.swing_composite_engine import build_swing_composite_response

    out = await build_swing_composite_response(
        symbol="AAPL",
        user_id=None,
        user_email=None,
        params=default_signal_parameters(),
    )
    assert out.get("symbol") == "AAPL"
    assert "AAPL" in poly.bar_symbols
    assert "AAPL" in poly.snapshot_symbols
