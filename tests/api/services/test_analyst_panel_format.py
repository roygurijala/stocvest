"""Tests for analyst panel formatting."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from stocvest.api.services.analyst_panel_format import format_analyst_ratings_for_panel
from stocvest.data.benzinga_client import BenzingaRating


def test_format_analyst_panel_unique_firm_consensus() -> None:
    now = datetime(2026, 5, 27, 16, 0, tzinfo=timezone.utc)
    ratings = [
        BenzingaRating("AAPL", "Upgrade", "Buy", 200.0, "Goldman Sachs", now - timedelta(days=1)),
        BenzingaRating("AAPL", "Upgrade", "Buy", 195.0, "Goldman Sachs", now - timedelta(days=2)),
        BenzingaRating("AAPL", "Upgrade", "Outperform", 190.0, "Morgan Stanley", now - timedelta(days=5)),
    ]
    out = format_analyst_ratings_for_panel(
        ratings,
        symbol="AAPL",
        analyst_feed_configured=True,
        current_price=170.0,
        now=now,
    )
    assert out["feed_state"] == "available"
    assert out["consensus"]["upgrades_30d"] == 2
    assert len(out["ratings"]) == 3
    assert out["ratings"][0]["upside_pct"] is not None
    assert out["ratings"][0]["firm_tier"] == "tier_1"


def test_format_analyst_panel_unconfigured() -> None:
    out = format_analyst_ratings_for_panel([], symbol="AAPL", analyst_feed_configured=False)
    assert out["feed_state"] == "unconfigured"
    assert out["ratings"] == []
