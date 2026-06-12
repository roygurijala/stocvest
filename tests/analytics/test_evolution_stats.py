"""Tests for setup evolution summary helpers."""

from __future__ import annotations

from stocvest.analytics.evolution_stats import (
    ACTIONABLE_SCORE_THRESHOLD,
    compute_evolution_analytics,
    compute_evolution_summary,
    compute_forward_projection,
    compute_inflection_moments,
    compute_layer_stability,
    compute_score_timeline,
    compute_state_journey,
    filter_transitions_by_plan,
    resolve_signal_score,
)
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


def test_resolve_signal_score_prefers_stored() -> None:
    row = _t(signal_score=78, layers_aligned=4)
    assert resolve_signal_score(row) == 78


def test_state_journey_segments_with_scores() -> None:
    rows = [
        _t(session_date="2026-06-08", to_state="not_aligned", layers_aligned=2, signal_score=42, transition_type="initial"),
        _t(session_date="2026-06-10", to_state="developing", layers_aligned=4, signal_score=59, transition_type="improved"),
        _t(session_date="2026-06-11", to_state="actionable", layers_aligned=5, signal_score=78, transition_type="improved"),
    ]
    journey = compute_state_journey(rows)
    assert len(journey) == 3
    assert journey[0]["entry_score"] == 42
    assert journey[-1]["is_current"] is True
    assert journey[-1]["current_score"] == 78


def test_inflection_momentum_weakening() -> None:
    rows = [
        _t(session_date="2026-06-08", signal_score=78, to_state="actionable"),
        _t(session_date="2026-06-09", signal_score=76, to_state="actionable", transition_type="unchanged"),
        _t(session_date="2026-06-10", signal_score=74, to_state="actionable", transition_type="unchanged"),
    ]
    inf = compute_inflection_moments(rows)
    assert inf["momentum"]["direction"] == "weakening"
    assert inf["peak"]["signal_score"] == 78


def test_layer_stability_bands() -> None:
    rows = [
        _t(session_date="2026-06-08", missing_layers=["macro", "geopolitical"]),
        _t(session_date="2026-06-09", missing_layers=["macro", "geopolitical"]),
        _t(session_date="2026-06-10", missing_layers=["macro", "geopolitical"]),
    ]
    blocks = compute_layer_stability(rows)
    by_layer = {b["layer"]: b for b in blocks}
    assert by_layer["technical"]["band"] == "consistent"
    assert by_layer["macro"]["band"] == "not_confirming"


def test_score_timeline_delta_labels() -> None:
    rows = [
        _t(session_date="2026-06-08", signal_score=44, to_state="not_aligned", transition_type="initial"),
        _t(session_date="2026-06-09", signal_score=48, to_state="developing", transition_type="improved"),
        _t(session_date="2026-06-10", signal_score=59, to_state="developing", transition_type="improved"),
    ]
    timeline = compute_score_timeline(rows)
    assert timeline[0]["session_date"] == "2026-06-10"
    assert timeline[0]["delta_label"] == "+11pts"
    assert timeline[-1]["delta_label"] == "—"


def test_forward_projection_toward_actionable() -> None:
    rows = [
        _t(session_date="2026-06-08", signal_score=60, to_state="developing"),
        _t(session_date="2026-06-09", signal_score=65, to_state="developing", transition_type="improved"),
        _t(session_date="2026-06-10", signal_score=70, to_state="developing", transition_type="improved"),
    ]
    proj = compute_forward_projection(rows, threshold=ACTIONABLE_SCORE_THRESHOLD)
    assert proj is not None
    assert proj["kind"] == "toward_actionable"
    assert proj["sessions_estimate"] >= 1


def test_compute_evolution_analytics_payload() -> None:
    rows = [
        _t(session_date="2026-06-08", signal_score=44, transition_type="initial"),
        _t(session_date="2026-06-09", signal_score=48, transition_type="improved"),
    ]
    payload = compute_evolution_analytics(rows)
    assert payload["actionable_score_threshold"] == ACTIONABLE_SCORE_THRESHOLD
    assert len(payload["score_trend"]) == 2
    assert payload["inflection"]["peak"]["signal_score"] == 48
