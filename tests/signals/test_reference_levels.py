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


def test_vwap_dropped_when_session_scale_exceeds_5x_vs_last() -> None:
    """When `day` is wildly off vs last trade (>5×), session OHLC/VWAP must be dropped."""
    ticker = {
        "ticker": "AAPL",
        "day": {"o": 1100, "h": 1120, "l": 1080, "c": 1110, "v": 1, "vw": 1100},
        "prevDay": {"c": 200},
        "lastTrade": {"p": 200.5, "s": 100},
        "lastQuote": {"P": 200, "p": 200.5},
    }
    snap = PolygonClient._parse_snapshot("AAPL", ticker)
    assert snap.last_trade_price == pytest.approx(200.5)
    assert snap.day_vwap is None
    assert snap.day_high is None
    assert snap.day_low is None


def test_session_bar_kept_when_last_trade_missing() -> None:
    """No last print: cannot validate scale — keep session bar for reference levels."""
    ticker = {
        "ticker": "AAPL",
        "day": {"o": 198, "h": 202, "l": 196, "c": 201, "v": 1, "vw": 199},
        "prevDay": {"c": 197},
        "lastTrade": {},
        "lastQuote": {"P": 199.9, "p": 200.1},
    }
    snap = PolygonClient._parse_snapshot("AAPL", ticker)
    assert snap.last_trade_price is None
    assert snap.day_vwap == pytest.approx(199)
    assert snap.day_low == pytest.approx(196)
    assert snap.day_high == pytest.approx(202)


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