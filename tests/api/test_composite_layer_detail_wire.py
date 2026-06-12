from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.composite_layer_detail_wire import (
    quality_article_wire,
    recent_ratings_wire,
    technical_indicator_snapshot_wire,
)
from stocvest.data.benzinga_client import BenzingaRating


def test_quality_article_wire_includes_neutral_sentiment() -> None:
    row = quality_article_wire(
        {
            "title": "Company reaffirms outlook",
            "source": "polygon",
            "published_utc": "2026-06-10T12:00:00Z",
            "article_url": "https://example.com/a",
        },
        0.0,
    )
    assert row is not None
    assert row["sentiment"] == "neutral"
    assert row["text"].startswith("Company reaffirms")


def test_recent_ratings_wire_returns_recent_actions() -> None:
    ratings = [
        BenzingaRating(
            symbol="NAVN",
            action="Upgrade",
            rating="Outperform",
            price_target=24.0,
            analyst_firm="Goldman Sachs",
            published_at=datetime(2026, 6, 8, tzinfo=timezone.utc),
        )
    ]
    out = recent_ratings_wire(ratings)
    assert len(out) == 1
    assert out[0]["firm"] == "Goldman Sachs"
    assert out[0]["action"] == "Upgrade"


def test_technical_indicator_snapshot_wire_day_mode() -> None:
    class _Tech:
        rsi = 58.2
        ema9 = 12.5
        ema20 = 11.8
        vwap_from_bars = 12.1
        volume_vs_adv = 1.4
        bars_analyzed = 42
        ema_alignment = "bullish"
        volume_surge = True

    snap = technical_indicator_snapshot_wire(_Tech(), mode="day")
    assert snap is not None
    assert snap["mode"] == "day"
    assert snap["rsi"] == 58.2
    assert snap["volume_surge"] is True
