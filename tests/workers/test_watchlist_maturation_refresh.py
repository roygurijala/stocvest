"""Tests for watchlist_maturation_refresh worker."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from stocvest.workers.watchlist_maturation_refresh import run_watchlist_maturation_refresh_sync


def test_refresh_skips_without_maturation_table(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.get_watchlist_maturation_repository",
        lambda: None,
    )
    out = run_watchlist_maturation_refresh_sync()
    assert out.get("skipped") is True


def test_refresh_calls_composite_and_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    sync_calls: list[tuple[str, str, str]] = []

    def fake_day(*, symbol: str, user_id: str | None, user_email: str | None) -> dict:
        _ = user_email
        return {"symbol": symbol, "signal_summary": "bullish", "layers": []}

    def fake_sync(*, user_id: str, symbol: str, mode: str, composite_body: object) -> None:
        sync_calls.append((user_id, symbol, mode))

    class _Repo:
        pass

    store = MagicMock()
    store.scan_default_watchlists.return_value = [
        MagicMock(
            is_default=True,
            user_id="u1",
            symbols=["AAA", "BBB"],
        )
    ]

    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.get_watchlist_maturation_repository",
        lambda: _Repo(),
    )
    monkeypatch.setattr("stocvest.workers.watchlist_maturation_refresh.get_watchlist_store", lambda: store)
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.real_composite_body_sync",
        fake_day,
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.sync_watchlist_maturation_from_composite",
        fake_sync,
    )
    monkeypatch.setenv("STOCVEST_MATURATION_REFRESH_MAX_USERS", "5")
    monkeypatch.setenv("STOCVEST_MATURATION_REFRESH_MAX_SYMBOLS_PER_USER", "2")
    monkeypatch.setenv("STOCVEST_MATURATION_REFRESH_MAX_CALLS", "10")

    out = run_watchlist_maturation_refresh_sync()
    assert out["job"] == "watchlist_maturation_refresh"
    assert out["day"]["ok"] == 2
    assert len(sync_calls) == 2
    assert all(m == "day" for _, _, m in sync_calls)
