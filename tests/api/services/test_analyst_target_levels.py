"""Analyst target level extraction — Benzinga ratings and Perplexity JSON."""

from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.analyst_target_levels import (
    analyst_targets_from_payload,
    analyst_targets_from_ratings,
    parse_perplexity_analyst_targets,
)
from stocvest.data.benzinga_client import BenzingaRating


def _rating(symbol: str, pt: float | None) -> BenzingaRating:
    return BenzingaRating(
        symbol=symbol,
        action="initiates",
        rating="Buy",
        price_target=pt,
        analyst_firm="Test Bank",
        published_at=datetime.now(timezone.utc),
    )


def test_analyst_targets_from_ratings_dedupes() -> None:
    rows = [
        _rating("ABC", 12.5),
        _rating("ABC", 12.5),
        _rating("ABC", 15.0),
        _rating("ABC", None),
        _rating("ABC", -1.0),
    ]
    assert analyst_targets_from_ratings(rows) == [12.5, 15.0]


def test_parse_perplexity_analyst_targets_merges_fields() -> None:
    data = {
        "price_targets": [10.0, 11.0],
        "price_target_avg": 10.5,
        "price_target_high": 11.0,
        "price_target_low": 10.0,
    }
    assert parse_perplexity_analyst_targets(data) == [10.0, 11.0, 10.5]


def test_analyst_targets_from_payload() -> None:
    payload = {"analyst_target_levels": [9.5, 9.5, 12.0, "bad"]}
    assert analyst_targets_from_payload(payload) == [9.5, 12.0]


def test_long_geometry_uses_analyst_target_as_resistance() -> None:
    from stocvest.api.services.swing_composite_evidence import _long_side_geometry

    bars = [{"low": 2.0, "high": h} for h in [3.0, 4.5, 6.0, 8.0, 9.0, 10.5, 11.4]]
    stop, t1, t2, _, prov = _long_side_geometry(
        day_lo=8.0,
        day_hi=11.4,
        vwap=9.0,
        prev_close=8.5,
        last=9.44,
        daily_bars=bars,
        analyst_target_levels=[12.0],
    )
    assert t1 == 11.4
    assert t2 == 12.0
    assert prov == "resistance"
    assert stop is not None
