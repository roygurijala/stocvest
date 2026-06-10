"""Tests for watchlist_ledger_capture worker."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from stocvest.models.watchlist import WatchlistEntry, WatchlistState
from stocvest.workers.watchlist_ledger_capture import run_watchlist_ledger_capture_sync


def test_ledger_capture_prioritizes_actionable(monkeypatch: pytest.MonkeyPatch) -> None:
    day_calls: list[str] = []

    class _Repo:
        def list_by_state(self, user_id: str, state: WatchlistState, *, mode: str) -> list[WatchlistEntry]:
            _ = user_id
            if mode == "day" and state == WatchlistState.ACTIONABLE:
                return [
                    WatchlistEntry(
                        user_id="u1",
                        symbol="NVDA",
                        mode="day",
                        state=WatchlistState.ACTIONABLE,
                        previous_state=None,
                        state_changed_at="",
                        state_change_reason="",
                        layers_aligned=5,
                    )
                ]
            return []

        def list_for_user(self, user_id: str, *, mode: str, exclude_archived: bool = True) -> list[WatchlistEntry]:
            _ = (user_id, mode, exclude_archived)
            return []

    def fake_day(*, symbol: str, user_id: str | None, user_email: str | None, ledger_capture: bool) -> dict:
        _ = (user_id, user_email, ledger_capture)
        day_calls.append(symbol)
        return {"ledger_qualified": False}

    def fake_swing(*, symbol: str, user_id: str | None, user_email: str | None, ledger_capture: bool) -> dict:
        _ = (symbol, user_id, user_email, ledger_capture)
        return {"ledger_qualified": False}

    store = MagicMock()
    store.scan_default_watchlists.return_value = [
        MagicMock(is_default=True, user_id="u1", symbols=["AAA", "NVDA"]),
    ]

    monkeypatch.setattr(
        "stocvest.workers.watchlist_ledger_capture.get_watchlist_maturation_repository",
        lambda: _Repo(),
    )
    monkeypatch.setattr("stocvest.workers.watchlist_ledger_capture.get_watchlist_store", lambda: store)
    monkeypatch.setattr(
        "stocvest.workers.watchlist_ledger_capture.real_composite_body_sync",
        fake_day,
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_ledger_capture.swing_composite_body_sync",
        fake_swing,
    )
    monkeypatch.setenv("STOCVEST_LEDGER_CAPTURE_MAX_CALLS", "5")

    out = run_watchlist_ledger_capture_sync(desk="day")
    assert out["job"] == "watchlist_ledger_capture"
    assert "NVDA" in day_calls
    assert day_calls[0] == "NVDA"


def test_ledger_capture_both_interleaves_so_swing_is_not_starved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: a tight call budget must not drain the whole day queue first.

    Previously the worker ran the entire day queue before swing; under the Lambda
    timeout (or a low max_calls cap) the swing loop never executed and zero swing
    signals were ever captured. The interleave guarantees both desks make progress.
    """
    day_calls: list[str] = []
    swing_calls: list[str] = []

    class _EmptyRepo:
        def list_by_state(self, user_id: str, state: WatchlistState, *, mode: str) -> list[WatchlistEntry]:
            _ = (user_id, state, mode)
            return []

        def list_for_user(self, user_id: str, *, mode: str, exclude_archived: bool = True) -> list[WatchlistEntry]:
            _ = (user_id, mode, exclude_archived)
            return []

    def fake_day(*, symbol: str, user_id: str | None, user_email: str | None, ledger_capture: bool) -> dict:
        _ = (user_id, user_email, ledger_capture)
        day_calls.append(symbol)
        return {"ledger_qualified": False}

    def fake_swing(*, symbol: str, user_id: str | None, user_email: str | None, ledger_capture: bool) -> dict:
        _ = (user_id, user_email, ledger_capture)
        swing_calls.append(symbol)
        return {"ledger_qualified": False}

    store = MagicMock()
    store.scan_default_watchlists.return_value = [
        MagicMock(is_default=True, user_id="u1", symbols=["AAA", "BBB", "CCC", "DDD"]),
    ]

    monkeypatch.setattr(
        "stocvest.workers.watchlist_ledger_capture.get_watchlist_maturation_repository",
        lambda: _EmptyRepo(),
    )
    monkeypatch.setattr("stocvest.workers.watchlist_ledger_capture.get_watchlist_store", lambda: store)
    monkeypatch.setattr("stocvest.workers.watchlist_ledger_capture.real_composite_body_sync", fake_day)
    monkeypatch.setattr("stocvest.workers.watchlist_ledger_capture.swing_composite_body_sync", fake_swing)
    # Budget smaller than the day queue alone — the old code would spend it all on day.
    monkeypatch.setenv("STOCVEST_LEDGER_CAPTURE_MAX_CALLS", "4")

    out = run_watchlist_ledger_capture_sync(desk="both")
    assert out["composite_calls"] == 4
    # Both desks must have been reached despite the tight budget.
    assert len(day_calls) > 0
    assert len(swing_calls) > 0


def test_ledger_capture_syncs_maturation_after_composite(monkeypatch: pytest.MonkeyPatch) -> None:
    sync_calls: list[tuple[str, str, str]] = []

    class _EmptyRepo:
        def list_by_state(self, user_id: str, state: WatchlistState, *, mode: str) -> list[WatchlistEntry]:
            _ = (user_id, state, mode)
            return []

        def list_for_user(self, user_id: str, *, mode: str, exclude_archived: bool = True) -> list[WatchlistEntry]:
            _ = (user_id, mode, exclude_archived)
            return []

    def fake_swing(*, symbol: str, user_id: str | None, user_email: str | None, ledger_capture: bool) -> dict:
        _ = (user_email, ledger_capture)
        return {
            "ledger_qualified": False,
            "decision_state": "monitor",
            "signal_summary": "neutral",
            "status": "active",
        }

    def fake_sync(*, user_id: str, symbol: str, mode: str, composite_body: dict, **kwargs) -> str:
        _ = (composite_body, kwargs)
        sync_calls.append((user_id, symbol, mode))
        return "written"

    store = MagicMock()
    store.scan_default_watchlists.return_value = [
        MagicMock(is_default=True, user_id="u1", symbols=["AAPL"]),
    ]

    monkeypatch.setattr(
        "stocvest.workers.watchlist_ledger_capture.get_watchlist_maturation_repository",
        lambda: _EmptyRepo(),
    )
    monkeypatch.setattr("stocvest.workers.watchlist_ledger_capture.get_watchlist_store", lambda: store)
    monkeypatch.setattr(
        "stocvest.workers.watchlist_ledger_capture.swing_composite_body_sync",
        fake_swing,
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_ledger_capture.sync_watchlist_maturation_from_composite",
        fake_sync,
    )
    monkeypatch.setenv("STOCVEST_LEDGER_CAPTURE_MAX_CALLS", "5")

    run_watchlist_ledger_capture_sync(desk="swing")
    assert sync_calls == [("u1", "AAPL", "swing")]
