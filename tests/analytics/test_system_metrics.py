"""Tests for platform setup behavior aggregates."""

from __future__ import annotations

from stocvest.analytics.system_metrics import aggregate_platform_behavior
from stocvest.models.watchlist_transition import WatchlistMaturationTransition


def _t(**kw: object) -> WatchlistMaturationTransition:
    base = dict(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        recorded_at="2026-05-10T12:00:00+00:00",
        session_date="2026-05-10",
        from_state=None,
        to_state="developing",
        layers_aligned=2,
        previous_layers_aligned=None,
        layers_total=6,
        alignment_pct=33.0,
        bias="long",
        transition_type="initial",
    )
    base.update(kw)
    return WatchlistMaturationTransition(**base)  # type: ignore[arg-type]


def test_aggregate_platform_behavior_counts_users() -> None:
    rows = [
        _t(user_id="u1", session_date="2026-05-10"),
        _t(user_id="u2", symbol="MSFT", session_date="2026-05-10", recorded_at="2026-05-10T13:00:00+00:00"),
    ]
    out = aggregate_platform_behavior(rows, mode="swing", days=30)
    assert out["scope"] == "platform"
    assert out["unique_users"] == 2
    assert out["unique_symbols"] == 2
    assert out["transition_count"] == 2
