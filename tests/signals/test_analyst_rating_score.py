"""Tests for structured Benzinga analyst rating scoring."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from stocvest.data.benzinga_client import BenzingaMultiResult, BenzingaRating
from stocvest.signals.analyst_rating_score import (
    analyst_firm_weight,
    blend_headline_and_analyst,
    compute_structured_analyst_score,
    consensus_counts,
    day_session_recency_scale,
    et_session_bucket,
    price_target_adjustment,
    pt_conviction_multiplier,
)

ET = ZoneInfo("America/New_York")


def _rating(
    *,
    action: str = "Upgrade",
    firm: str = "Goldman Sachs",
    pt: float | None = 120.0,
    age_days: float = 0.5,
    published_at: datetime | None = None,
) -> BenzingaRating:
    pub = published_at or (datetime.now(timezone.utc) - timedelta(days=age_days))
    return BenzingaRating(
        symbol="AAPL",
        action=action,
        rating="Buy",
        price_target=pt,
        analyst_firm=firm,
        published_at=pub,
    )


def _bz(*ratings: BenzingaRating) -> BenzingaMultiResult:
    return BenzingaMultiResult(ratings=list(ratings), analyst_feed_configured=True)


def test_tier_1_firm_weight() -> None:
    assert analyst_firm_weight("Goldman Sachs") == 1.5
    assert analyst_firm_weight("Jefferies") == 1.0


def test_price_target_distance_bands() -> None:
    assert price_target_adjustment(100.0, 130.0) == 0.15
    assert price_target_adjustment(100.0, 110.0) == 0.08
    assert price_target_adjustment(100.0, 102.0) == 0.03
    assert price_target_adjustment(100.0, 95.0) == -0.10


def test_pt_conviction_multiplier_modulates_not_flips() -> None:
    assert pt_conviction_multiplier(100.0, 130.0, bearish=False) == 1.15
    assert pt_conviction_multiplier(100.0, 95.0, bearish=True) == 1.08
    assert pt_conviction_multiplier(100.0, 110.0, bearish=True) == 0.92


def test_consensus_counts_unique_firms_only() -> None:
    now = datetime(2026, 5, 27, 16, 0, tzinfo=timezone.utc)
    ratings = [
        BenzingaRating("AAPL", "Upgrade", "Buy", None, "MS", now - timedelta(days=5)),
        BenzingaRating("AAPL", "Upgrade", "Buy", None, "MS", now - timedelta(days=6)),
        BenzingaRating("AAPL", "Upgrade", "Buy", None, "Citi", now - timedelta(days=10)),
        BenzingaRating("AAPL", "Downgrade", "Sell", None, "X", now - timedelta(days=40)),
    ]
    up, down, mom = consensus_counts(ratings, now=now)
    assert up == 2
    assert down == 0
    assert mom == 2


def test_day_premarket_beats_rth_same_day() -> None:
    now = datetime(2026, 5, 27, 14, 0, tzinfo=timezone.utc)
    pre = datetime(2026, 5, 27, 8, 0, tzinfo=ET).astimezone(timezone.utc)
    rth = datetime(2026, 5, 27, 11, 0, tzinfo=ET).astimezone(timezone.utc)
    assert et_session_bucket(pre) == "pre_market"
    assert et_session_bucket(rth) == "rth"
    assert day_session_recency_scale(pre, now) > day_session_recency_scale(rth, now)


def test_day_upgrade_today_gets_stronger_adjust_than_stale() -> None:
    fresh = compute_structured_analyst_score(
        _bz(_rating(age_days=0.5)),
        mode="day",
        current_price=100.0,
    )
    stale = compute_structured_analyst_score(
        _bz(_rating(age_days=10)),
        mode="day",
        current_price=100.0,
    )
    assert fresh.score > stale.score


def test_swing_consensus_improving_adds_chip() -> None:
    now = datetime(2026, 5, 27, tzinfo=timezone.utc)
    ratings = [
        _rating(age_days=2),
        BenzingaRating("AAPL", "Upgrade", "Buy", 130.0, "Morgan Stanley", now - timedelta(days=8)),
        BenzingaRating("AAPL", "Upgrade", "Outperform", 125.0, "JPMorgan", now - timedelta(days=15)),
        BenzingaRating("AAPL", "Upgrade", "Buy", 128.0, "Bank of America", now - timedelta(days=20)),
    ]
    out = compute_structured_analyst_score(
        BenzingaMultiResult(ratings=ratings, analyst_feed_configured=True),
        mode="swing",
        current_price=100.0,
        now=now,
    )
    assert out.consensus is not None
    assert out.consensus["momentum"] >= 3
    assert out.consensus.get("unique_firms") is True
    assert any("consensus improving" in c.lower() for c in out.chips)
    assert any("firms" in c for c in out.chips)


def test_maintains_with_pt_raise_scores_bullish() -> None:
    out = compute_structured_analyst_score(
        _bz(_rating(action="Maintains", pt=115.0)),
        mode="swing",
        current_price=100.0,
    )
    assert out.score > 0.0
    assert out.catalyst in ("analyst_pt_raise", "analyst_maintains_bullish")


def test_initiate_sell_scores_bearish() -> None:
    out = compute_structured_analyst_score(
        _bz(
            BenzingaRating(
                "AAPL",
                "Initiates",
                "Underperform",
                90.0,
                "Jefferies",
                datetime.now(timezone.utc) - timedelta(days=1),
            )
        ),
        mode="swing",
        current_price=100.0,
    )
    assert out.score < 0.0


def test_old_rating_excluded_from_score() -> None:
    out = compute_structured_analyst_score(
        _bz(_rating(age_days=20)),
        mode="day",
        current_price=100.0,
    )
    assert out.score == 0.0


def test_unconfigured_feed_state() -> None:
    out = compute_structured_analyst_score(
        BenzingaMultiResult(ratings=[_rating()], analyst_feed_configured=False),
        mode="day",
        current_price=100.0,
    )
    assert out.feed_state == "unconfigured"
    assert out.chips == ()


def test_blend_headline_and_analyst_mode_weights() -> None:
    swing = blend_headline_and_analyst(0.0, 0.6, mode="swing", analyst_active=True)
    day = blend_headline_and_analyst(0.0, 0.6, mode="day", analyst_active=True)
    assert swing == 0.18
    assert day == 0.30
