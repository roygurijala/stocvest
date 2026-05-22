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
