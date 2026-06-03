"""Tests for stocvest.api.services.assistant_symbol_context.

All tests use mocks — no real Polygon or Benzinga calls are made.
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from stocvest.api.services.assistant_symbol_context import (
    AssistantSymbolContext,
    fetch_assistant_symbol_context,
)
from stocvest.data.models import Snapshot


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
