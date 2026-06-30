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
    fetch_stocvest_composite_read,
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


# ── STOCVEST composite read (cached evidence) ───────────────────────────────

_EVIDENCE_ENVELOPE = {
    "computed_at": "2026-06-03T20:00:00Z",
    "data": {
        "symbol": "AVGO",
        "signal_summary": "neutral",
        "alignment_ratio": 0.5,
        "alignment": {"label": "Balanced"},
        "regime": "risk-on",
        "causal_narrative": "Layers split with no clear leader.",
        "layers": [
            {"layer": "technical", "status": "available", "verdict": "bullish"},
            {"layer": "macro", "status": "available", "verdict": "bearish"},
            {"layer": "sector", "status": "available", "verdict": "bearish"},
            {"layer": "internals", "status": "available", "verdict": "bearish"},
            {"layer": "news", "status": "available", "verdict": "neutral"},
            {"layer": "geopolitical", "status": "unavailable", "verdict": "neutral"},
        ],
    },
}


def test_fetch_stocvest_read_extracts_verdict_and_leans() -> None:
    with patch(
        "stocvest.api.services.assistant_symbol_context.read_dashboard_cache",
        return_value=_EVIDENCE_ENVELOPE,
    ):
        read = fetch_stocvest_composite_read("AVGO", "swing")
    assert read is not None
    assert read["verdict"] == "neutral"
    # Only the 5 "available" layers are counted; the unavailable one is excluded.
    assert read["leans"] == {"bullish": 1, "bearish": 3, "neutral": 1, "available": 5}
    assert read["alignment_label"] == "Balanced"
    assert read["regime"] == "risk-on"
    assert read["reasoning"] == "Layers split with no clear leader."
    assert read["stale"] is False


def test_fetch_stocvest_read_none_when_uncached() -> None:
    with patch(
        "stocvest.api.services.assistant_symbol_context.read_dashboard_cache",
        return_value=None,
    ):
        assert fetch_stocvest_composite_read("AVGO", "swing") is None


def test_fetch_stocvest_read_none_on_error_body() -> None:
    with patch(
        "stocvest.api.services.assistant_symbol_context.read_dashboard_cache",
        return_value={"data": {"error": "timeout"}},
    ):
        assert fetch_stocvest_composite_read("AVGO", "swing") is None


def test_fetch_stocvest_read_none_on_blank_symbol() -> None:
    assert fetch_stocvest_composite_read("", "swing") is None


def test_fetch_stocvest_read_marks_stale_from_cache_source() -> None:
    envelope = {
        "computed_at": "2026-06-03T20:00:00Z",
        "data": {
            "symbol": "AVGO",
            "signal_summary": "bullish",
            "source": "cache_stale",
            "layers": [{"layer": "technical", "status": "available", "verdict": "bullish"}],
        },
    }
    with patch(
        "stocvest.api.services.assistant_symbol_context.read_dashboard_cache",
        return_value=envelope,
    ):
        read = fetch_stocvest_composite_read("AVGO", "day")
    assert read is not None
    assert read["verdict"] == "bullish"
    assert read["mode"] == "day"
    assert read["stale"] is True


def test_fetch_stocvest_read_limitations_split_partial_neutral() -> None:
    """A 5-of-6, split, neutral cached read enumerates what it cannot confirm."""
    with patch(
        "stocvest.api.services.assistant_symbol_context.read_dashboard_cache",
        return_value=_EVIDENCE_ENVELOPE,
    ):
        read = fetch_stocvest_composite_read("AVGO", "swing")
    assert read is not None
    limitations = read.get("limitations")
    assert isinstance(limitations, list)
    assert any("5 of 6" in x for x in limitations)
    assert any("split" in x for x in limitations)
    assert any("inconclusive" in x for x in limitations)
    # Fresh (source not cache) → no staleness caveat.
    assert not any("cached evaluation" in x for x in limitations)


def test_fetch_stocvest_read_limitations_include_staleness() -> None:
    envelope = {
        "computed_at": "2026-06-03T20:00:00Z",
        "data": {
            "symbol": "AVGO",
            "signal_summary": "bullish",
            "source": "cache_stale",
            "layers": [{"layer": "technical", "status": "available", "verdict": "bullish"}],
        },
    }
    with patch(
        "stocvest.api.services.assistant_symbol_context.read_dashboard_cache",
        return_value=envelope,
    ):
        read = fetch_stocvest_composite_read("AVGO", "day")
    assert read is not None
    limitations = read.get("limitations")
    assert isinstance(limitations, list)
    assert any("cached evaluation" in x for x in limitations)
    assert any("1 of 6" in x for x in limitations)


def test_fetch_stocvest_read_no_limitations_when_complete_and_decisive() -> None:
    """A full, fresh, one-directional read carries no limitations key — the
    assistant should present it without manufacturing doubt."""
    envelope = {
        "computed_at": "2026-06-03T20:00:00Z",
        "data": {
            "symbol": "AVGO",
            "signal_summary": "bullish",
            "source": "live",
            "alignment": {"label": "High"},
            "layers": [
                {"layer": "technical", "status": "available", "verdict": "bullish"},
                {"layer": "macro", "status": "available", "verdict": "bullish"},
                {"layer": "sector", "status": "available", "verdict": "bullish"},
                {"layer": "internals", "status": "available", "verdict": "bullish"},
                {"layer": "news", "status": "available", "verdict": "bullish"},
                {"layer": "geopolitical", "status": "available", "verdict": "neutral"},
            ],
        },
    }
    with patch(
        "stocvest.api.services.assistant_symbol_context.read_dashboard_cache",
        return_value=envelope,
    ):
        read = fetch_stocvest_composite_read("AVGO", "swing")
    assert read is not None
    assert read["verdict"] == "bullish"
    assert "limitations" not in read


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
    # Forecast range — high/low of the analyst targets (current vs max/min).
    assert by_kind["target_high"]["value"] == 200.0
    assert by_kind["target_low"]["value"] == 180.0
    # Each level carries a distance from the last price.
    assert "distance_pct" in by_kind["vwap"]


def test_build_chart_forecast_range_collapses_for_tight_consensus() -> None:
    # Targets within ~1% of the average produce no separate high/low lines.
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        snapshot=Snapshot(symbol="NVDA", day_close=100.0, prev_close=99.0, change_percent=1.0),
        bars_5m=[_bar(100.0, 30), _bar(100.5, 35)],
        analyst_ratings=[_rating(200.0), _rating(200.5)],
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    kinds = {lvl["kind"] for lvl in chart["levels"]}
    assert "target" in kinds
    assert "target_high" not in kinds
    assert "target_low" not in kinds


def test_build_chart_full_timeframe_by_desk() -> None:
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        snapshot=Snapshot(symbol="NVDA", day_close=100.0, prev_close=99.0, change_percent=1.0),
        bars_5m=[_bar(100.0, 30), _bar(100.5, 35)],
    )
    assert build_symbol_chart(ctx, "day")["full_chart_timeframe"] == "1hour"
    assert build_symbol_chart(ctx, "swing")["full_chart_timeframe"] == "1day"
    # Default desk is swing -> daily candles.
    assert build_symbol_chart(ctx)["full_chart_timeframe"] == "1day"


def test_support_not_faraway_plateau_after_gap_up() -> None:
    """After a gap-up, Support must not be the faraway pre-gap base (MRVL $158-vs-$300 class)."""
    daily: list[Bar] = []
    for i in range(35):
        if i < 34:
            daily.append(_daily_bar(100.0, i + 1, high=105.0, low=95.0))
        else:
            daily.append(_daily_bar(400.0, i + 1, high=405.0, low=395.0))
    snap = Snapshot(symbol="NVDA", day_close=400.0, prev_close=388.0, change_percent=3.0, day_vwap=399.0)
    ctx = AssistantSymbolContext(
        symbol="NVDA",
        snapshot=snap,
        bars_5m=[_bar(395.0, 30), _bar(398.0, 35), _bar(400.0, 40)],
        bars_1d=daily,
    )
    chart = build_symbol_chart(ctx)
    assert chart is not None
    by_kind = {lvl["kind"]: lvl for lvl in chart["levels"]}
    if "support" in by_kind:
        assert by_kind["support"]["value"] > 350.0
        assert by_kind["support"]["value"] != 95.0
    assert "sma50" in by_kind


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
