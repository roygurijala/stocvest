"""Tests for scripts/catchup_watchlist_maturation.py planning helpers."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import MagicMock

from scripts.catchup_watchlist_maturation import (
    CatchupJob,
    build_catchup_jobs,
    find_stale_maturation_hints,
    run_catchup_jobs,
)
from stocvest.models.watchlist import WatchlistEntry, WatchlistState


@dataclass
class _Wl:
    user_id: str
    symbols: list[str]
    is_default: bool = True


def test_build_catchup_jobs_dedupes_users_and_respects_cap() -> None:
    rows = [
        _Wl("u1", ["AAPL", "MSFT", "GOOG"]),
        _Wl("u1", ["SHOULD", "SKIP"], is_default=True),
    ]
    jobs = build_catchup_jobs(rows, sym_cap_for_user=lambda _u: 2, desk="both")
    assert jobs == [
        CatchupJob("u1", "AAPL", "day"),
        CatchupJob("u1", "AAPL", "swing"),
        CatchupJob("u1", "MSFT", "day"),
        CatchupJob("u1", "MSFT", "swing"),
    ]


def test_build_catchup_jobs_swing_only() -> None:
    jobs = build_catchup_jobs([_Wl("u1", ["NVDA"])], sym_cap_for_user=lambda _u: 10, desk="swing")
    assert jobs == [CatchupJob("u1", "NVDA", "swing")]


def test_find_stale_maturation_hints_flags_old_and_actionable() -> None:
    repo = MagicMock()
    repo.get_entry.return_value = WatchlistEntry(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        state=WatchlistState.ACTIONABLE,
        previous_state=None,
        state_changed_at="",
        state_change_reason="",
        layers_aligned=5,
        last_evaluated_at="2026-05-01T12:00:00+00:00",
    )
    hints = find_stale_maturation_hints(
        repo,
        [CatchupJob("u1", "AAPL", "swing")],
        today_et="2026-06-10",
    )
    assert len(hints) == 1
    assert hints[0].state == "actionable"


def test_run_catchup_jobs_dry_run_does_not_call_engines(monkeypatch) -> None:
    monkeypatch.setattr(
        "scripts.catchup_watchlist_maturation.real_composite_body_sync",
        lambda **_: (_ for _ in ()).throw(AssertionError("should not run")),
    )
    out = run_catchup_jobs([CatchupJob("u1", "AAPL", "day")], max_calls=10, dry_run=True)
    assert out["dry_run"] is True
    assert out["jobs_planned"] == 1
