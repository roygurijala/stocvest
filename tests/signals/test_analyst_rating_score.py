"""Tests for structured Benzinga analyst rating scoring."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.data.benzinga_client import BenzingaMultiResult, BenzingaRating
from stocvest.signals.analyst_rating_score import (
    analyst_firm_weight,
    compute_structured_analyst_adjustment,
    consensus_counts,
    price_target_adjustment,
)


def _rating(
    *,
    action: str = "Upgrade",
    firm: str = "Goldman Sachs",
    pt: float | None = 120.0,
    age_days: float = 0.5,
) -> BenzingaRating:
    return BenzingaRating(
        symbol="AAPL",
        action=action,
        rating="Buy",
        price_target=pt,
        analyst_firm=firm,
        published_at=datetime.now(timezone.utc) - timedelta(days=age_days),
    )


def test_tier_1_firm_weight() -> None:
    assert analyst_firm_weight("Goldman Sachs") == 1.5
    assert analyst_firm_weight("Jefferies") == 1.0


def test_price_target_distance_bands() -> None:
    assert price_target_adjustment(100.0, 130.0) == 0.15
    assert price_target_adjustment(100.0, 110.0) == 0.08
    assert price_target_adjustment(100.0, 102.0) == 0.03
    assert price_target_adjustment(100.0, 95.0) == -0.10


def test_consensus_counts_30d_window() -> None:
    now = datetime(2026, 5, 27, 16, 0, tzinfo=timezone.utc)
    ratings = [
        BenzingaRating("AAPL", "Upgrade", "Buy", None, "MS", now - timedelta(days=5)),
        BenzingaRating("AAPL", "Upgrade", "Buy", None, "Citi", now - timedelta(days=10)),
        BenzingaRating("AAPL", "Upgrade", "Buy", None, "UBS", now - timedelta(days=20)),
        BenzingaRating("AAPL", "Downgrade", "Sell", None, "X", now - timedelta(days=40)),
    ]
    up, down, mom = consensus_counts(ratings, now=now)
    assert up == 3
    assert down == 0
    assert mom == 3


def test_day_upgrade_today_gets_stronger_adjust_than_stale() -> None:
    fresh = compute_structured_analyst_adjustment(
        BenzingaMultiResult(ratings=[_rating(age_days=0.5)]),
        mode="day",
        current_price=100.0,
    )
    stale = compute_structured_analyst_adjustment(
        BenzingaMultiResult(ratings=[_rating(age_days=10)]),
        mode="day",
        current_price=100.0,
    )
    assert fresh.adjust > stale.adjust


def test_swing_consensus_improving_adds_chip() -> None:
    now = datetime(2026, 5, 27, tzinfo=timezone.utc)
    ratings = [
        _rating(age_days=2),
        BenzingaRating("AAPL", "Upgrade", "Buy", 130.0, "Morgan Stanley", now - timedelta(days=8)),
        BenzingaRating("AAPL", "Upgrade", "Outperform", 125.0, "JPMorgan", now - timedelta(days=15)),
        BenzingaRating("AAPL", "Upgrade", "Buy", 128.0, "Bank of America", now - timedelta(days=20)),
    ]
    out = compute_structured_analyst_adjustment(
        BenzingaMultiResult(ratings=ratings),
        mode="swing",
        current_price=100.0,
        now=now,
    )
    assert out.consensus is not None
    assert out.consensus["momentum"] >= 3
    assert any("consensus improving" in c.lower() for c in out.chips)


def test_old_rating_excluded_from_score() -> None:
    out = compute_structured_analyst_adjustment(
        BenzingaMultiResult(ratings=[_rating(age_days=20)]),
        mode="day",
        current_price=100.0,
    )
    assert out.adjust == 0.0
