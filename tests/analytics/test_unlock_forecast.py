"""Unlock forecast tests (Chunk 7)."""

from __future__ import annotations

from stocvest.analytics.unlock_forecast import compute_unlock_forecast


def test_sector_close_to_threshold_1_session() -> None:
    hints = compute_unlock_forecast(
        missing_layers=["sector"],
        layer_raw_data={
            "sector": {
                "layer": "sector",
                "status": "available",
                "score": 52,
                "verdict": "neutral",
                "sector_persistence": 0.58,
                "sector_etf": "SOXX",
            }
        },
        composite_bias="long",
    )
    assert len(hints) == 1
    assert hints[0].layer_name == "sector"
    assert hints[0].estimated_sessions == 1
    assert hints[0].confidence == "high"


def test_sector_far_returns_medium_confidence() -> None:
    hints = compute_unlock_forecast(
        missing_layers=["sector"],
        layer_raw_data={"sector": {"sector_persistence": 0.25, "sector_etf": "XLE"}},
        composite_bias="long",
    )
    assert hints[0].confidence == "medium"
    assert (hints[0].estimated_sessions or 0) >= 2


def test_macro_event_days_captured() -> None:
    hints = compute_unlock_forecast(
        missing_layers=["macro"],
        layer_raw_data={
            "macro": {
                "upcoming_events": [
                    {"name": "CPI", "hours_until": 12.0},
                ]
            }
        },
        composite_bias="long",
    )
    assert hints[0].layer_name == "macro"
    assert hints[0].estimated_sessions is not None
    assert "CPI" in hints[0].distance_description


def test_news_layer_no_hint_returned() -> None:
    hints = compute_unlock_forecast(
        missing_layers=["news"],
        layer_raw_data={"news": {"verdict": "bearish"}},
        composite_bias="long",
    )
    assert hints == []


def test_geo_layer_no_hint_returned() -> None:
    hints = compute_unlock_forecast(
        missing_layers=["geopolitical"],
        layer_raw_data={"geopolitical": {"verdict": "neutral"}},
        composite_bias="long",
    )
    assert hints == []


def test_primary_blocker_first_item() -> None:
    hints = compute_unlock_forecast(
        missing_layers=["macro", "internals"],
        layer_raw_data={
            "macro": {"upcoming_events": [{"name": "FOMC", "hours_until": 6.0}]},
            "internals": {"breadth_signal": "down", "participation": "mixed"},
        },
        composite_bias="long",
    )
    assert len(hints) >= 2
    assert hints[0].is_primary_blocker is True
    assert not any(h.is_primary_blocker for h in hints[1:])


def test_empty_missing_returns_empty() -> None:
    assert compute_unlock_forecast(missing_layers=[], layer_raw_data={}) == []


def test_sorted_high_confidence_first() -> None:
    hints = compute_unlock_forecast(
        missing_layers=["sector", "internals"],
        layer_raw_data={
            "sector": {"sector_persistence": 0.55, "sector_etf": "SOXX"},
            "internals": {"breadth_signal": "down", "participation": "broad_down"},
        },
        composite_bias="long",
    )
    assert hints[0].confidence == "high"
