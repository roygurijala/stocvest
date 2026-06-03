"""Tests for stocvest.api.services.assistant_symbol_context.

All tests use mocks — no real Polygon or Benzinga calls are made.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from datetime import datetime, timezone

from stocvest.api.services.assistant_symbol_context import (
    AssistantSymbolContext,
    build_symbol_chart,
    fetch_assistant_symbol_context,
    news_relevance_rank,
)
from stocvest.data.benzinga_client import BenzingaRating
from stocvest.data.models import Bar, Snapshot, Timeframe


def test_news_relevance_rank_symbol_first_ticker_is_top() -> None:
    assert news_relevance_rank("AVGO", ["AVGO"], "Broadcom Announces Results") == 0


def test_news_relevance_rank_symbol_in_title_is_top() -> None:
    assert news_relevance_rank("AVGO", ["AAPL", "AVGO"], "AVGO surges on earnings") == 0


def test_news_relevance_rank_buried_in_many_tickers_is_low() -> None:
    rank = news_relevance_rank("AVGO", ["AI", "NVDA", "PLTR", "SMCI", "MSFT", "AVGO"], "C3 AI earnings")
    assert rank >= 3


def test_news_relevance_rank_absent_symbol_is_lowest() -> None:
    assert news_relevance_rank("AVGO", ["AAPL", "MSFT"], "Apple news") == 4


def _bar(close: float, minute: int) -> Bar:
    return Bar(
        symbol="NVDA",
        timestamp=datetime(2026, 6, 3, 13, minute, tzinfo=timezone.utc),
        timeframe=Timeframe.MIN_5,
        open=close,
        high=close,
        low=close,
        close=close,
        volume=1000.0,
    )


def _daily_bar(close: float, day: int, *, high: float | None = None, low: float | None = None) -> Bar:
    return Bar(
        symbol="NVDA",
        timestamp=datetime(2026, 3, day if day <= 28 else 28, tzinfo=timezone.utc),
        timeframe=Timeframe.DAY_1,
        open=close,
        high=high if high is not None else close + 2,
        low=low if low is not None else close - 2,
        close=close,
        volume=1_000_000.0,
    )


def _rating(price_target: float) -> BenzingaRating:
    return BenzingaRating(
        symbol="NVDA",
        action="Maintains",
        rating="Buy",
        price_target=price_target,
        analyst_firm="TestFirm",
        published_at=datetime.now(timezone.utc),
    )


# ─────────────────────────────────────────────────────────────────────────────
# AssistantSymbolContext.has_data
# ─────────────────────────────────────────────────────────────────────────────


def test_has_data_false_when_no_snapshot_and_no_news() -> None:
    ctx = AssistantSymbolContext(symbol="MRVL")
    assert ctx.has_data is False


def test_has_data_true_when_snapshot_present() -> None:
    snap = MagicMock(spec=Snapshot)
    ctx = AssistantSymbolContext(symbol="MRVL", snapshot=snap)
    assert ctx.has_data is True


def test_has_data_true_when_news_present() -> None:
    ctx = AssistantSymbolContext(symbol="MRVL", news=[MagicMock()])
    assert ctx.has_data is True


# ─────────────────────────────────────────────────────────────────────────────
# fetch_assistant_symbol_context — guard rails
# ─────────────────────────────────────────────────────────────────────────────


def test_empty_symbol_returns_none() -> None:
    result = asyncio.run(fetch_assistant_symbol_context(""))
    assert result is None


def test_whitespace_symbol_returns_none() -> None:
    result = asyncio.run(fetch_assistant_symbol_context("   "))
    assert result is None


# ─────────────────────────────────────────────────────────────────────────────
# fetch_assistant_symbol_context — partial data on sub-call failure
# ─────────────────────────────────────────────────────────────────────────────


def test_snapshot_failure_does_not_raise() -> None:
    """When Polygon snapshot raises, the context is returned with snapshot=None."""
    with (
        patch(
            "stocvest.api.services.assistant_symbol_context.PolygonClient",
        ) as MockPoly,
        patch(
            "stocvest.api.services.assistant_symbol_context.BenzingaClient",
        ) as MockBz,
    ):
        # Polygon snapshot raises; news and bars succeed with empty lists.
        mock_poly = AsyncMock()
        mock_poly.get_snapshot.side_effect = RuntimeError("Polygon down")
        mock_poly.get_news = AsyncMock(return_value=[])
        mock_poly.get_bars = AsyncMock(return_value=[])
        mock_poly.__aenter__ = AsyncMock(return_value=mock_poly)
        mock_poly.__aexit__ = AsyncMock(return_value=None)
        MockPoly.return_value = mock_poly

        mock_bz = AsyncMock()
        mock_bz.get_why_is_it_moving = AsyncMock(return_value=None)
        mock_bz.get_analyst_ratings = AsyncMock(return_value=[])
        mock_bz.get_earnings_results = AsyncMock(return_value=[])
        mock_bz.get_corporate_guidance = AsyncMock(return_value=[])
        MockBz.return_value = mock_bz

        result = asyncio.run(fetch_assistant_symbol_context("MRVL"))

    assert result is not None
    assert result.symbol == "MRVL"
    assert result.snapshot is None


def test_benzinga_failure_does_not_raise() -> None:
    """When Benzinga raises entirely, snapshot still arrives."""
    snap = MagicMock(spec=Snapshot)
    with (
        patch(
            "stocvest.api.services.assistant_symbol_context.PolygonClient",
        ) as MockPoly,
        patch(
            "stocvest.api.services.assistant_symbol_context.BenzingaClient",
        ) as MockBz,
    ):
        mock_poly = AsyncMock()
        mock_poly.get_snapshot = AsyncMock(return_value=snap)
        mock_poly.get_news = AsyncMock(return_value=[])
        mock_poly.get_bars = AsyncMock(return_value=[])
        mock_poly.__aenter__ = AsyncMock(return_value=mock_poly)
        mock_poly.__aexit__ = AsyncMock(return_value=None)
        MockPoly.return_value = mock_poly

        # Benzinga raises on every call
        mock_bz = AsyncMock()
        mock_bz.get_why_is_it_moving = AsyncMock(side_effect=Exception("Benzinga down"))
        mock_bz.get_analyst_ratings = AsyncMock(side_effect=Exception("Benzinga down"))
        mock_bz.get_earnings_results = AsyncMock(side_effect=Exception("Benzinga down"))
        mock_bz.get_corporate_guidance = AsyncMock(side_effect=Exception("Benzinga down"))
        MockBz.return_value = mock_bz

        result = asyncio.run(fetch_assistant_symbol_context("MRVL"))

    assert result is not None
    assert result.snapshot is snap
    assert result.analyst_ratings == []
    assert result.earnings == []


def test_symbol_normalized_to_polygon_form() -> None:
    """BRK-B should be normalized to BRK.B before any fetch."""
    called_with: list[str] = []

    with (
        patch(
            "stocvest.api.services.assistant_symbol_context.PolygonClient",
        ) as MockPoly,
        patch(
            "stocvest.api.services.assistant_symbol_context.BenzingaClient",
        ) as MockBz,
    ):
        mock_poly = AsyncMock()

        async def capture_snapshot(sym: str) -> None:
            called_with.append(sym)
            return None

        mock_poly.get_snapshot = capture_snapshot
        mock_poly.get_news = AsyncMock(return_value=[])
        mock_poly.get_bars = AsyncMock(return_value=[])
        mock_poly.__aenter__ = AsyncMock(return_value=mock_poly)
        mock_poly.__aexit__ = AsyncMock(return_value=None)
        MockPoly.return_value = mock_poly

        mock_bz = AsyncMock()
        mock_bz.get_why_is_it_moving = AsyncMock(return_value=None)
        mock_bz.get_analyst_ratings = AsyncMock(return_value=[])
        mock_bz.get_earnings_results = AsyncMock(return_value=[])
        mock_bz.get_corporate_guidance = AsyncMock(return_value=[])
        MockBz.return_value = mock_bz

        result = asyncio.run(fetch_assistant_symbol_context("BRK-B"))

    assert result is not None
    assert result.symbol == "BRK.B"
    assert "BRK.B" in called_with
    assert "BRK-B" not in called_with


def test_polygon_client_constructed_with_api_key() -> None:
    """Regression: PolygonClient must be built WITH api_key.

    Constructing it bare raised a TypeError that silently left the assistant
    with no live data (the "I don't have live market data for X" fallback).
    """
    with (
        patch(
            "stocvest.api.services.assistant_symbol_context.PolygonClient",
        ) as MockPoly,
        patch(
            "stocvest.api.services.assistant_symbol_context.BenzingaClient",
        ) as MockBz,
        patch(
            "stocvest.api.services.assistant_symbol_context.get_settings",
        ) as MockSettings,
    ):
        MockSettings.return_value = MagicMock(polygon_api_key="TEST_POLYGON_KEY")

        mock_poly = AsyncMock()
        mock_poly.get_snapshot = AsyncMock(return_value=None)
        mock_poly.get_news = AsyncMock(return_value=[])
        mock_poly.get_bars = AsyncMock(return_value=[])
        mock_poly.__aenter__ = AsyncMock(return_value=mock_poly)
        mock_poly.__aexit__ = AsyncMock(return_value=None)
        MockPoly.return_value = mock_poly

        mock_bz = AsyncMock()
        mock_bz.get_why_is_it_moving = AsyncMock(return_value=None)
        mock_bz.get_analyst_ratings = AsyncMock(return_value=[])
        mock_bz.get_earnings_results = AsyncMock(return_value=[])
        mock_bz.get_corporate_guidance = AsyncMock(return_value=[])
        mock_bz.get_news = AsyncMock(return_value=[])
        MockBz.return_value = mock_bz

        asyncio.run(fetch_assistant_symbol_context("MRVL"))

    MockPoly.assert_called_once_with(api_key="TEST_POLYGON_KEY")


# ─────────────────────────────────────────────────────────────────────────────
# build_symbol_chart
# ─────────────────────────────────────────────────────────────────────────────


def test_build_chart_returns_none_without_data() -> None:
    assert build_symbol_chart(None) is None
    assert build_symbol_chart(AssistantSymbolContext(symbol="NVDA")) is None


def test_build_chart_intraday_with_bars() -> None:
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        bars_5m=[_bar(100.0, 30), _bar(102.0, 35), _bar(104.0, 40)],
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    assert chart["kind"] == "intraday"
    assert chart["symbol"] == "NVDA"
    assert len(chart["points"]) == 3
    assert chart["last"] == 104.0
    assert chart["direction"] == "up"
    # 100 -> 104 is +4%.
    assert chart["change_pct"] == pytest.approx(4.0, abs=0.01)


def test_build_chart_prefers_snapshot_headline_numbers() -> None:
    snap = Snapshot(symbol="NVDA", day_close=120.0, prev_close=118.0, change_percent=-1.5)
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        snapshot=snap,
        bars_5m=[_bar(121.0, 30), _bar(120.0, 35)],
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    assert chart["last"] == 120.0
    assert chart["change_pct"] == -1.5
    assert chart["direction"] == "down"
    assert chart["prev_close"] == 118.0


def test_build_chart_includes_reference_levels() -> None:
    snap = Snapshot(symbol="NVDA", day_close=104.0, prev_close=100.0, change_percent=4.0, day_vwap=101.5)
    daily = [_daily_bar(90.0 + i, i + 1, high=95.0 + i, low=85.0 + i) for i in range(25)]
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        snapshot=snap,
        bars_5m=[_bar(100.0, 30), _bar(102.0, 35), _bar(104.0, 40)],
        bars_1d=daily,
        analyst_ratings=[_rating(180.0), _rating(200.0)],
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    kinds = {lvl["kind"] for lvl in chart["levels"]}
    assert {"vwap", "prev_close", "target", "support", "resistance", "sma50"} <= kinds
    by_kind = {lvl["kind"]: lvl for lvl in chart["levels"]}
    assert by_kind["vwap"]["value"] == 101.5
    assert by_kind["prev_close"]["value"] == 100.0
    # Analyst target is the average of 180 and 200.
    assert by_kind["target"]["value"] == 190.0
    # Each level carries a distance from the last price.
    assert "distance_pct" in by_kind["vwap"]


def test_support_omitted_when_no_base_near_price_parabolic() -> None:
    """A parabolic move has no recent base near price → Support is omitted rather
    than rendered as a faraway window low (the MRVL $158-vs-$300 bug)."""
    # Steep ramp 20 → 400; the most recent lows are all >25% below the $400 price.
    daily = [_daily_bar(20.0 + i * 10.0, (i % 28) + 1) for i in range(39)]
    snap = Snapshot(symbol="NVDA", day_close=400.0, prev_close=388.0, change_percent=3.0, day_vwap=399.0)
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        snapshot=snap,
        bars_5m=[_bar(395.0, 30), _bar(398.0, 35), _bar(400.0, 40)],
        bars_1d=daily,
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    kinds = {lvl["kind"] for lvl in chart["levels"]}
    assert "support" not in kinds  # nothing within the proximity band → omitted
    # Resistance (recent high just above price) and the factual averages still show.
    assert "sma50" in kinds


def test_support_uses_nearest_level_not_faraway_window_min() -> None:
    """Support must reflect a nearby base, never the absolute lookback minimum."""
    # Range-bound near $100 with an OLD crash low at $50 (far away) and a RECENT
    # pullback low at $92 (within band). Support must pick $92, never $50.
    daily: list[Bar] = []
    for i in range(25):
        if i == 2:
            daily.append(_daily_bar(100.0, i + 1, high=104.0, low=50.0))  # old crash low
        elif i == 20:
            daily.append(_daily_bar(96.0, i + 1, high=101.0, low=92.0))   # recent pivot low
        else:
            daily.append(_daily_bar(100.0, i + 1, high=104.0, low=97.0))
    snap = Snapshot(symbol="NVDA", day_close=100.0, prev_close=99.0, change_percent=1.0, day_vwap=100.5)
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        snapshot=snap,
        bars_5m=[_bar(99.0, 30), _bar(100.0, 35), _bar(100.0, 40)],
        bars_1d=daily,
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    by_kind = {lvl["kind"]: lvl for lvl in chart["levels"]}
    assert "support" in by_kind
    # Picks the nearest tested floor (~97), NOT the faraway $50 crash low.
    assert by_kind["support"]["value"] != 50.0
    assert by_kind["support"]["value"] >= 92.0  # safely inside the proximity band, near price


def test_build_chart_levels_empty_without_aux_data() -> None:
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        bars_5m=[_bar(100.0, 30), _bar(102.0, 35)],
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    assert chart["levels"] == []


def test_build_chart_quote_only_when_single_bar() -> None:
    snap = Snapshot(symbol="NVDA", day_close=99.5, change_percent=0.0)
    ctx = AssistantSymbolContext(symbol="NVDA", snapshot=snap, bars_5m=[_bar(99.5, 30)])
    chart = build_symbol_chart(ctx)
    assert chart is not None
    assert chart["kind"] == "quote"
    assert chart["points"] == []
    assert chart["last"] == 99.5
    assert chart["direction"] == "flat"


def test_result_symbol_is_uppercase() -> None:
    with (
        patch("stocvest.api.services.assistant_symbol_context.PolygonClient") as MockPoly,
        patch("stocvest.api.services.assistant_symbol_context.BenzingaClient") as MockBz,
    ):
        mock_poly = AsyncMock()
        mock_poly.get_snapshot = AsyncMock(return_value=None)
        mock_poly.get_news = AsyncMock(return_value=[])
        mock_poly.get_bars = AsyncMock(return_value=[])
        mock_poly.__aenter__ = AsyncMock(return_value=mock_poly)
        mock_poly.__aexit__ = AsyncMock(return_value=None)
        MockPoly.return_value = mock_poly

        mock_bz = AsyncMock()
        mock_bz.get_why_is_it_moving = AsyncMock(return_value=None)
        mock_bz.get_analyst_ratings = AsyncMock(return_value=[])
        mock_bz.get_earnings_results = AsyncMock(return_value=[])
        mock_bz.get_corporate_guidance = AsyncMock(return_value=[])
        MockBz.return_value = mock_bz

        result = asyncio.run(fetch_assistant_symbol_context("aapl"))

    assert result is not None
    assert result.symbol == "AAPL"
