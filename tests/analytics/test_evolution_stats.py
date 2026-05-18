"""Tests for setup evolution summary helpers."""

from __future__ import annotations

from stocvest.analytics.evolution_stats import compute_evolution_summary, filter_transitions_by_plan
from stocvest.models.watchlist_transition import WatchlistMaturationTransition


def _t(**kwargs: object) -> WatchlistMaturationTransition:
    base = dict(
        user_id="u1",
        symbol="TSLA",
        mode="swing",
        recorded_at="2026-05-10T12:00:00+00:00",
        session_date="2026-05-10",
        from_state=None,
        to_state="developing",
        layers_aligned=2,
        previous_layers_aligned=None,
        layers_total=6,
        alignment_pct=33.3,
        bias="long",
        transition_type="initial",
    )
    base.update(kwargs)
    return WatchlistMaturationTransition(**base)  # type: ignore[arg-type]


def test_empty_summary() -> None:
    s = compute_evolution_summary([])
    assert s["days_tracked"] == 0
    assert s["latest_state"] is None


def test_summary_counts_and_trend() -> None:
    rows = [
        _t(session_date="2026-05-10", to_state="not_aligned", layers_aligned=1, transition_type="initial"),
        _t(
            session_date="2026-05-11",
            to_state="developing",
            layers_aligned=3,
            transition_type="improved",
            recorded_at="2026-05-11T12:00:00+00:00",
        ),
    ]
    s = compute_evolution_summary(rows)
    assert s["days_tracked"] == 2
    assert s["latest_state"] == "developing"
    assert s["transition_counts"]["improved"] == 1
    assert len(s["alignment_trend"]) == 2


def test_free_plan_caps_rows() -> None:
    rows = [_t(session_date=f"2026-05-{d:02d}", recorded_at=f"2026-05-{d:02d}T12:00:00+00:00") for d in range(1, 25)]
    gated = filter_transitions_by_plan(rows, has_full_access=False, free_row_cap=5)
    assert len(gated) == 5
