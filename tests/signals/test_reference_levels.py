"""Reference levels must track last trade — never a mismatched Polygon `day` aggregate."""

from __future__ import annotations

import httpx
import pytest
import respx

from stocvest.data.polygon_client import PolygonClient

FAKE_KEY = "test_api_key_reference_levels"


@pytest.mark.asyncio
@respx.mock
async def test_polygon_snapshot_called_with_correct_symbol() -> None:
    sym = "AAPL"
    route = respx.get(
        f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{sym}"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "status": "OK",
                "ticker": {
                    "ticker": sym,
                    "day": {"o": 185, "h": 188, "l": 183, "c": 187, "v": 1, "vw": 186},
                    "prevDay": {"c": 183},
                    "lastTrade": {"p": 187, "s": 100},
                    "lastQuote": {"P": 187, "p": 187.01},
                },
            },
        )
    )
    async with PolygonClient(FAKE_KEY) as client:
        snap = await client.get_snapshot(sym)
    assert route.called
    assert snap.symbol == sym
    assert snap.last_trade_price == pytest.approx(187)


def test_vwap_uses_real_price_not_fallback() -> None:
    """When `day` is on a bogus scale vs last trade, VWAP must be dropped (not ~718 vs ~200)."""
    ticker = {
        "ticker": "AAPL",
        "day": {"o": 718, "h": 724, "l": 720, "c": 722, "v": 1, "vw": 718},
        "prevDay": {"c": 200},
        "lastTrade": {"p": 200.5, "s": 100},
        "lastQuote": {"P": 200, "p": 200.5},
    }
    snap = PolygonClient._parse_snapshot("AAPL", ticker)
    assert snap.last_trade_price == pytest.approx(200.5)
    assert snap.day_vwap is None
    assert snap.day_high is None
    assert snap.day_low is None


def test_reference_levels_within_10pct_of_current_price() -> None:
    """Coherent Polygon snapshot: session OHLC/VWAP stay near last print."""
    ticker = {
        "ticker": "AAPL",
        "day": {"o": 198, "h": 202, "l": 196, "c": 201, "v": 1, "vw": 199},
        "prevDay": {"c": 197},
        "lastTrade": {"p": 200, "s": 1},
        "lastQuote": {"P": 199.9, "p": 200.1},
    }
    snap = PolygonClient._parse_snapshot("AAPL", ticker)
    last = snap.last_trade_price
    assert last == pytest.approx(200)
    support = snap.day_low if snap.day_low is not None else last * 0.985
    resistance = snap.day_high if snap.day_high is not None else last * 1.015
    assert abs(support - last) / last <= 0.10
    assert abs(resistance - last) / last <= 0.10
    assert snap.day_vwap is not None
    assert abs(float(snap.day_vwap) - last) / last <= 0.10
