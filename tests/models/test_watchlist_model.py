"""Tests for stocvest.models.watchlist."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.models.watchlist import (
    ACTIONABLE_THRESHOLD,
    DEVELOPING_THRESHOLD,
    NEAR_READY_LAYER_COUNT,
    WatchlistEntry,
    WatchlistState,
    derive_maturation_state,
    derive_progress_band,
    derive_state,
    user_state_gsi_keys,
)


def test_derive_state_actionable_at_threshold() -> None:
    assert (
        derive_state(ACTIONABLE_THRESHOLD, None)
        == WatchlistState.ACTIONABLE
    )
    assert derive_state(6, None) == WatchlistState.ACTIONABLE


def test_derive_state_developing_at_three() -> None:
    assert derive_state(DEVELOPING_THRESHOLD, None) == WatchlistState.DEVELOPING


def test_derive_progress_band_near_ready_at_four() -> None:
    assert derive_progress_band(NEAR_READY_LAYER_COUNT) == "near_ready"
    assert derive_progress_band(NEAR_READY_LAYER_COUNT, state=WatchlistState.DEVELOPING) == "near_ready"


def test_derive_progress_band_actionable_at_five() -> None:
    assert derive_progress_band(ACTIONABLE_THRESHOLD) == "actionable"
    assert (
        derive_progress_band(ACTIONABLE_THRESHOLD, state=WatchlistState.DEVELOPING)
        == "developing"
    )


def test_derive_maturation_state_requires_decision_actionable() -> None:
    assert (
        derive_maturation_state(ACTIONABLE_THRESHOLD, None, composite_decision_state="monitor")
        == WatchlistState.DEVELOPING
    )
    assert (
        derive_maturation_state(ACTIONABLE_THRESHOLD, None, composite_decision_state="actionable")
        == WatchlistState.ACTIONABLE
    )


def test_derive_progress_band_invalidated_not_near_ready() -> None:
    assert (
        derive_progress_band(NEAR_READY_LAYER_COUNT, state=WatchlistState.INVALIDATED)
        == "not_aligned"
    )


def test_derive_state_not_aligned_below_threshold_no_history() -> None:
    assert derive_state(2, None) == WatchlistState.NOT_ALIGNED


def test_derive_state_invalidated_from_developing() -> None:
    assert (
        derive_state(2, WatchlistState.DEVELOPING, was_invalidated=False)
        == WatchlistState.INVALIDATED
    )


def test_derive_state_invalidated_from_actionable() -> None:
    assert (
        derive_state(1, WatchlistState.ACTIONABLE, was_invalidated=False)
        == WatchlistState.INVALIDATED
    )


def test_derive_state_re_evaluating_after_invalidated() -> None:
    assert (
        derive_state(3, WatchlistState.INVALIDATED, was_invalidated=True)
        == WatchlistState.RE_EVALUATING
    )


def test_derive_state_developing_not_re_eval_if_never_invalidated() -> None:
    assert (
        derive_state(3, WatchlistState.NOT_ALIGNED, was_invalidated=False)
        == WatchlistState.DEVELOPING
    )


def test_not_aligned_stays_not_aligned_below_threshold() -> None:
    assert (
        derive_state(2, WatchlistState.NOT_ALIGNED, was_invalidated=False)
        == WatchlistState.NOT_ALIGNED
    )


def test_readiness_label_core_layers() -> None:
    entry = WatchlistEntry(
        user_id="u1",
        symbol="NVDA",
        mode="swing",
        state=WatchlistState.DEVELOPING,
        previous_state=None,
        state_changed_at="",
        state_change_reason="",
        layers_aligned=4,
        missing_layers=["macro", "sector"],
    )
    assert "core ✓" in entry.readiness_label


def test_readiness_label_context_only() -> None:
    entry = WatchlistEntry(
        user_id="u1",
        symbol="XOM",
        mode="swing",
        state=WatchlistState.DEVELOPING,
        previous_state=None,
        state_changed_at="",
        state_change_reason="",
        layers_aligned=2,
        missing_layers=["technical", "news", "sector"],
    )
    assert "context only" in entry.readiness_label


def test_should_exclude_invalidated_past_archive() -> None:
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    entry = WatchlistEntry(
        user_id="u1",
        symbol="A",
        mode="swing",
        state=WatchlistState.INVALIDATED,
        previous_state=WatchlistState.DEVELOPING,
        state_changed_at="",
        state_change_reason="",
        layers_aligned=0,
        archive_after=past,
    )
    assert entry.should_exclude_from_active_queries() is True


def test_should_exclude_invalidated_before_archive() -> None:
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    entry = WatchlistEntry(
        user_id="u1",
        symbol="A",
        mode="swing",
        state=WatchlistState.INVALIDATED,
        previous_state=WatchlistState.DEVELOPING,
        state_changed_at="",
        state_change_reason="",
        layers_aligned=0,
        archive_after=future,
    )
    assert entry.should_exclude_from_active_queries() is False


def test_should_exclude_invalidated_no_archive_immediate() -> None:
    entry = WatchlistEntry(
        user_id="u1",
        symbol="A",
        mode="swing",
        state=WatchlistState.INVALIDATED,
        previous_state=WatchlistState.DEVELOPING,
        state_changed_at="",
        state_change_reason="",
        layers_aligned=0,
        archive_after=None,
    )
    assert entry.should_exclude_from_active_queries() is True


def test_user_state_gsi_keys() -> None:
    pk, sk = user_state_gsi_keys("sub-1", WatchlistState.ACTIONABLE, "nvda", "swing")
    assert pk == "USER#sub-1"
    assert sk == "STATE#actionable#SYM#NVDA#MODE#swing"


@pytest.mark.parametrize(
    ("state", "color", "label"),
    [
        (WatchlistState.NOT_ALIGNED, "red", "Not aligned"),
        (WatchlistState.DEVELOPING, "amber", "Developing"),
        (WatchlistState.ACTIONABLE, "green", "Actionable"),
        (WatchlistState.INVALIDATED, "gray", "Invalidated"),
        (WatchlistState.RE_EVALUATING, "blue", "Re-evaluating"),
    ],
)
def test_state_color_and_label(state: WatchlistState, color: str, label: str) -> None:
    entry = WatchlistEntry(
        user_id="u",
        symbol="S",
        mode="swing",
        state=state,
        previous_state=None,
        state_changed_at="",
        state_change_reason="",
        layers_aligned=0,
    )
    assert entry.color == color
    assert entry.label == label
