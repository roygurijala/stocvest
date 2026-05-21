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
    out = run_watchlist_maturation_refresh_sync(slot="eod")
    assert out.get("skipped") is True


def test_refresh_calls_day_composite_and_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    sync_calls: list[tuple[str, str, str]] = []

    def fake_day(*, symbol: str, user_id: str | None, user_email: str | None) -> dict:
        _ = user_email
        return {"symbol": symbol, "signal_summary": "bullish", "layers": []}

    def fake_sync(
        *,
        user_id: str,
        symbol: str,
        mode: str,
        composite_body: object,
        email_on_state_change: bool = True,
        **_: object,
    ) -> None:
        _ = (email_on_state_change, composite_body)
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
    monkeypatch.setenv("STOCVEST_MATURATION_REFRESH_MAX_CALLS", "10")

    out = run_watchlist_maturation_refresh_sync(scan_type="maturation_refresh")
    assert out["job"] == "watchlist_maturation_refresh"
    assert out["slot"] == "eod"
    assert out["day"]["ok"] == 2
    assert len(sync_calls) == 2
    assert all(m == "day" for _, _, m in sync_calls)


def test_swing_open_runs_swing_only(monkeypatch: pytest.MonkeyPatch) -> None:
    sync_calls: list[str] = []

    def fake_swing(*, symbol: str, user_id: str | None, user_email: str | None) -> dict:
        _ = (user_id, user_email)
        return {"symbol": symbol, "signal_summary": "bullish", "layers": []}

    def fake_sync(*, mode: str, **_: object) -> None:
        sync_calls.append(mode)

    store = MagicMock()
    store.scan_default_watchlists.return_value = [
        MagicMock(is_default=True, user_id="u1", symbols=["NVDA"]),
    ]

    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.get_watchlist_maturation_repository",
        lambda: object(),
    )
    monkeypatch.setattr("stocvest.workers.watchlist_maturation_refresh.get_watchlist_store", lambda: store)
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.swing_composite_body_sync",
        fake_swing,
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.sync_watchlist_maturation_from_composite",
        fake_sync,
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.real_composite_body_sync",
        MagicMock(),
    )

    out = run_watchlist_maturation_refresh_sync(scan_type="maturation_refresh_swing")
    assert out["slot"] == "swing_open"
    assert out["swing"]["ok"] == 1
    assert sync_calls == ["swing"]
    assert "day" not in out


def test_day_open_skips_when_market_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.get_watchlist_maturation_repository",
        lambda: object(),
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.fetch_composite_market_status_payload_sync",
        lambda: {"is_market_open": False, "market_session": "closed"},
    )
    out = run_watchlist_maturation_refresh_sync(scan_type="maturation_refresh_day")
    assert out["skipped"] is True
    assert out["reason"] == "market_not_open"


def test_day_open_runs_day_when_market_open(monkeypatch: pytest.MonkeyPatch) -> None:
    sync_modes: list[str] = []

    def fake_sync(*, mode: str, **_: object) -> None:
        sync_modes.append(mode)

    store = MagicMock()
    store.scan_default_watchlists.return_value = [
        MagicMock(is_default=True, user_id="u1", symbols=["AAPL"]),
    ]

    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.get_watchlist_maturation_repository",
        lambda: object(),
    )
    monkeypatch.setattr("stocvest.workers.watchlist_maturation_refresh.get_watchlist_store", lambda: store)
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.fetch_composite_market_status_payload_sync",
        lambda: {"is_market_open": True, "market_session": "regular"},
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.real_composite_body_sync",
        lambda **_: {"signal_summary": "bullish", "layers": []},
    )
    monkeypatch.setattr(
        "stocvest.workers.watchlist_maturation_refresh.sync_watchlist_maturation_from_composite",
        fake_sync,
    )

    out = run_watchlist_maturation_refresh_sync(scan_type="maturation_refresh_day")
    assert out["slot"] == "day_open"
    assert out["day"]["ok"] == 1
    assert sync_modes == ["day"]
