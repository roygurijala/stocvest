"""Tests for setup outcome event pairing."""

from __future__ import annotations

from stocvest.analytics.outcome_stats import aggregate_outcome_stats, build_outcome_events
from stocvest.models.watchlist_transition import WatchlistMaturationTransition


def _t(
    session_date: str,
    layers: int,
    *,
    tt: str = "unchanged",
    state: str = "developing",
    price_at_event: float | None = None,
) -> WatchlistMaturationTransition:
    return WatchlistMaturationTransition(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        recorded_at=f"{session_date}T12:00:00+00:00",
        session_date=session_date,
        from_state=None,
        to_state=state,
        layers_aligned=layers,
        previous_layers_aligned=None,
        layers_total=6,
        alignment_pct=layers / 6 * 100,
        bias="long",
        transition_type=tt,  # type: ignore[arg-type]
        price_at_event=price_at_event,
    )


def test_build_outcome_events_alignment_held() -> None:
    events = build_outcome_events(
        "AAPL",
        "swing",
        [_t("2026-05-10", 2), _t("2026-05-11", 4)],
    )
    assert len(events) == 1
    assert events[0].outcome_kind == "alignment_held"


def test_aggregate_building_dataset() -> None:
    stats = aggregate_outcome_stats([])
    assert stats["building_dataset"] is True
    assert stats["total_events"] == 0


def test_setup_continuation_when_price_moves_with_bias() -> None:
    events = build_outcome_events(
        "AAPL",
        "swing",
        [
            _t("2026-05-10", 3, price_at_event=100.0),
            _t("2026-05-11", 4, price_at_event=101.0),
        ],
    )
    assert len(events) == 1
    assert events[0].outcome_kind == "setup_continuation"
