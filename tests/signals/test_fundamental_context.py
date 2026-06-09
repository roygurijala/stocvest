"""Fundamental backdrop (display-only, not scored)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.data.benzinga_client import (
    BenzingaEarningsResult,
    BenzingaGuidance,
    BenzingaMultiResult,
    BenzingaRating,
)
from stocvest.signals.fundamental_context import (
    _compute_analyst_direction,
    _compute_backdrop,
    _compute_earnings_trend,
    _compute_guidance_direction,
    build_fundamental_context,
)


def _dt() -> datetime:
    # Keep fixtures inside the analyst consensus window as calendar time advances.
    return datetime.now(timezone.utc) - timedelta(days=7)


def test_backdrop_positive_all_good() -> None:
    backdrop = _compute_backdrop(
        earnings_trend="beating",
        guidance_dir="raised",
        analyst_dir="upgrading",
        revenue_trend="growing",
    )
    assert backdrop == "positive"


def test_backdrop_weak_all_bad() -> None:
    backdrop = _compute_backdrop(
        earnings_trend="missing",
        guidance_dir="lowered",
        analyst_dir="downgrading",
        revenue_trend="declining",
    )
    assert backdrop == "weak"


def test_backdrop_mixed_split() -> None:
    backdrop = _compute_backdrop(
        earnings_trend="beating",
        guidance_dir="lowered",
        analyst_dir="downgrading",
        revenue_trend="unknown",
    )
    assert backdrop == "mixed"


def test_earnings_trend_beating_3_of_4() -> None:
    results = [
        BenzingaEarningsResult("AAPL", "Q1", 1.0, 0.9, 10.0, None, None, True, _dt()),
        BenzingaEarningsResult("AAPL", "Q2", 1.0, 0.9, 10.0, None, None, True, _dt()),
        BenzingaEarningsResult("AAPL", "Q3", 1.0, 0.9, 10.0, None, None, True, _dt()),
        BenzingaEarningsResult("AAPL", "Q4", 0.5, 0.9, -40.0, None, None, False, _dt()),
    ]
    trend, beats, misses = _compute_earnings_trend(results)
    assert trend == "beating"
    assert beats == 3
    assert misses == 1


def test_analyst_upgrading() -> None:
    ratings = [
        BenzingaRating("AAPL", "Upgrade", "Buy", 200.0, "Firm", _dt()),
        BenzingaRating("AAPL", "Upgrade", "Buy", 210.0, "Firm2", _dt()),
        BenzingaRating("AAPL", "Downgrade", "Hold", 180.0, "Firm3", _dt()),
    ]
    direction, up, down = _compute_analyst_direction(ratings)
    assert direction == "upgrading"
    assert up == 2
    assert down == 1


def test_guidance_raised() -> None:
    g = [BenzingaGuidance("AAPL", "raised", "FY", _dt(), "Raised outlook")]
    assert _compute_guidance_direction(g) == "raised"


@pytest.mark.asyncio
async def test_build_fundamental_context_never_raises() -> None:
    ctx = await build_fundamental_context("ZZZ", benzinga_multi=BenzingaMultiResult())
    assert ctx.backdrop == "neutral"
    assert "limited" in ctx.summary_line.lower()


@pytest.mark.asyncio
async def test_build_fundamental_context_from_multi() -> None:
    multi = BenzingaMultiResult(
        earnings=[
            BenzingaEarningsResult("NVDA", "Q1", 2.0, 1.5, 30.0, None, None, True, _dt()),
            BenzingaEarningsResult("NVDA", "Q2", 2.1, 1.6, 28.0, None, None, True, _dt()),
            BenzingaEarningsResult("NVDA", "Q3", 2.2, 1.7, 25.0, None, None, True, _dt()),
        ],
        guidance=[BenzingaGuidance("NVDA", "raised", "FY", _dt(), "Beat")],
        ratings=[BenzingaRating("NVDA", "Upgrade", "Buy", 900.0, "Goldman", _dt())],
    )
    ctx = await build_fundamental_context(
        "NVDA",
        benzinga_multi=multi,
        sector_display_name="Technology",
        sector_etf="XLK",
    )
    assert ctx.backdrop == "positive"
    assert ctx.sector_etf == "XLK"
    assert "Signal data only" in ctx.summary_line
