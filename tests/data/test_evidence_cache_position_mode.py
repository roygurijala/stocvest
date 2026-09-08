"""Evidence cache desk separation (ADR-004 mode isolation)."""

from __future__ import annotations

import pytest

from stocvest.api.services.benzinga_feed_health import composite_layers_meta
from stocvest.data.dashboard_cache import evidence_cache_key, make_state_version


@pytest.mark.unit
def test_evidence_cache_key_separates_position_from_swing() -> None:
    swing = evidence_cache_key("AAPL", "swing")
    position = evidence_cache_key("AAPL", "position")
    day = evidence_cache_key("AAPL", "day")
    assert swing != position
    assert day != position
    assert ":position:" in position
    assert ":swing:" in swing
    assert ":day:" in day


@pytest.mark.unit
def test_make_state_version_includes_position_desk() -> None:
    assert make_state_version("position").startswith("position_")


@pytest.mark.unit
def test_composite_layers_meta_counts_fundamentals_active_for_position() -> None:
    class _Layer:
        def __init__(self, status: str) -> None:
            self.status = status

    results = [
        _Layer("active"),
        _Layer("as_of_close"),
        _Layer("available"),
        _Layer("degraded"),
        _Layer("unavailable"),
        _Layer("available"),
        _Layer("available"),
    ]
    ids = [
        "fundamentals",
        "technical",
        "news",
        "macro",
        "sector",
        "geopolitical",
        "internals",
    ]
    swing_meta = composite_layers_meta(results, ids)
    pos_meta = composite_layers_meta(results, ids, mode="position")
    assert swing_meta["composite_layers_active"] == 4
    assert pos_meta["composite_layers_active"] == 5
