"""Tests for watchlist maturation transition helpers."""

from __future__ import annotations

from stocvest.models.watchlist import WatchlistEntry, WatchlistState
from stocvest.models.watchlist_transition import (
    derive_transition_type,
    should_log_maturation_transition,
)


def _entry(**kw) -> WatchlistEntry:
    base = dict(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        state=WatchlistState.DEVELOPING,
        previous_state=None,
        state_changed_at="2026-05-16T12:00:00+00:00",
        state_change_reason="",
        layers_aligned=3,
        missing_layers=["internals", "sector"],
        bias="long",
    )
    base.update(kw)
    return WatchlistEntry(**base)


def test_should_log_on_first_observation() -> None:
    assert should_log_maturation_transition(None, _entry()) is True


def test_should_skip_when_unchanged() -> None:
    prev = _entry(layers_aligned=3, missing_layers=["internals", "sector"])
    nxt = _entry(layers_aligned=3, missing_layers=["internals", "sector"])
    assert should_log_maturation_transition(prev, nxt) is False


def test_should_log_alignment_delta() -> None:
    prev = _entry(layers_aligned=2)
    nxt = _entry(layers_aligned=3)
    assert should_log_maturation_transition(prev, nxt) is True


def test_should_log_missing_layers_change() -> None:
    prev = _entry(layers_aligned=3, missing_layers=["internals"])
    nxt = _entry(layers_aligned=3, missing_layers=["sector"])
    assert should_log_maturation_transition(prev, nxt) is True


def test_derive_transition_improved_on_state_rank() -> None:
    prev = _entry(state=WatchlistState.DEVELOPING)
    nxt = _entry(state=WatchlistState.ACTIONABLE)
    assert derive_transition_type(prev, nxt) == "improved"


def test_derive_transition_worsened() -> None:
    prev = _entry(state=WatchlistState.ACTIONABLE)
    nxt = _entry(state=WatchlistState.DEVELOPING)
    assert derive_transition_type(prev, nxt) == "worsened"


def test_derive_transition_unchanged_same_state_alignment_shift() -> None:
    prev = _entry(state=WatchlistState.DEVELOPING, layers_aligned=2)
    nxt = _entry(state=WatchlistState.DEVELOPING, layers_aligned=3)
    assert derive_transition_type(prev, nxt) == "unchanged"
