"""Tests for watchlist maturation sync from composite evidence."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from stocvest.api.handlers.signals import composite_response_with_evidence_cache
from stocvest.api.services.watchlist_maturation_sync import (
    sync_watchlist_maturation_from_composite,
)
from stocvest.data.watchlist_maturation_repository import WatchlistMaturationRepository
from stocvest.data.watchlist_maturation_transition_repository import (
    WatchlistMaturationTransitionRepository,
)
from stocvest.data.watchlist_store import InMemoryWatchlistStore
from stocvest.models.watchlist import WatchlistState
from tests.data.test_watchlist_maturation_repository import _FakeDynamoTable


def _layer(lid: str, *, verdict: str = "bullish", status: str = "ok", score: float = 0.5) -> dict[str, Any]:
    return {"layer": lid, "verdict": verdict, "status": status, "score": score, "reasoning": "r"}


def _six_layers(*, verdict: str = "bullish") -> list[dict[str, Any]]:
    return [
        _layer("technical", verdict=verdict),
        _layer("news", verdict=verdict),
        _layer("macro", verdict=verdict),
        _layer("sector", verdict=verdict),
        _layer("geopolitical", verdict=verdict),
        _layer("internals", verdict=verdict),
    ]


def _bullish_body() -> dict[str, Any]:
    return {
        "symbol": "AAPL",
        "signal_summary": "bullish",
        "layers": _six_layers(verdict="bullish"),
    }


def test_sync_skips_when_symbol_not_on_default_watchlist() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["MSFT"], is_default=True)
    status = sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_bullish_body(),
        maturation_repo=repo,
        watchlist_store=store,
    )
    assert status == "skipped_symbol_not_on_watchlist"
    assert table._by_pk_sk == {}


def test_sync_writes_when_symbol_on_default_watchlist() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["AAPL", "NVDA"], is_default=True)
    status = sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_bullish_body(),
        maturation_repo=repo,
        watchlist_store=store,
    )
    assert status == "written"
    got = repo.get_entry("u1", "AAPL", "swing")
    assert got is not None
    assert got.state == WatchlistState.ACTIONABLE
    assert got.layers_aligned == 6
    assert got.bias == "long"
    assert got.missing_layers == []


def test_sync_records_insufficient_data_touch() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="day",
        composite_body={
            "symbol": "AAPL",
            "status": "insufficient_data",
            "available_layers": 2,
            "required_layers": 4,
        },
        maturation_repo=repo,
        watchlist_store=store,
    )
    got = repo.get_entry("u1", "AAPL", "day")
    assert got is not None
    assert got.layers_aligned == 2
    assert got.last_evaluated_at


def test_neutral_composite_counts_available_layers() -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    body = {
        "symbol": "AAPL",
        "signal_summary": "neutral",
        "layers": _six_layers(verdict="neutral"),
    }
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=body,
        maturation_repo=repo,
        watchlist_store=store,
    )
    got = repo.get_entry("u1", "AAPL", "swing")
    assert got is not None
    assert got.layers_aligned == 6
    assert got.state == WatchlistState.ACTIONABLE


def test_composite_evidence_cache_hit_also_syncs_maturation(monkeypatch: pytest.MonkeyPatch) -> None:
    """Cached Evidence must still upsert maturation (watchlist reads Dynamo, not Upstash)."""
    calls: list[tuple[str, str, str]] = []
    cached = _bullish_body() | {"symbol": "NVDA"}

    def capture(**kw: Any) -> None:
        calls.append((kw["user_id"], kw["symbol"], kw["mode"]))

    monkeypatch.setattr(
        "stocvest.api.services.watchlist_maturation_sync.sync_watchlist_maturation_from_composite",
        capture,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: False,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.read_dashboard_cache",
        lambda _k: {"state_version": "swing_v1", "data": dict(cached)},
    )
    monkeypatch.setattr("stocvest.api.handlers.signals.write_dashboard_cache", lambda *a, **k: True)

    out = composite_response_with_evidence_cache(
        symbol="NVDA",
        user_id="sub-x",
        user_email=None,
        mode="swing",
        sync_compute=lambda: (_ for _ in ()).throw(AssertionError("compute must not run")),
    )
    assert out.get("source") == "cache"
    assert calls == [("sub-x", "NVDA", "swing")]


def test_composite_evidence_cache_invokes_maturation_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, str]] = []

    def capture(**kw: Any) -> None:
        calls.append((kw["user_id"], kw["symbol"], kw["mode"]))

    monkeypatch.setattr(
        "stocvest.api.services.watchlist_maturation_sync.sync_watchlist_maturation_from_composite",
        capture,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: False,
    )
    monkeypatch.setattr("stocvest.api.handlers.signals.read_dashboard_cache", lambda _k: None)
    monkeypatch.setattr("stocvest.api.handlers.signals.write_dashboard_cache", lambda *a, **k: True)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals._compute_with_thread_timeout",
        lambda fn, timeout_sec: fn(),
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.polygon_circuit",
        MagicMock(call=lambda fn: fn()),
    )

    composite_response_with_evidence_cache(
        symbol="NVDA",
        user_id="sub-x",
        user_email=None,
        mode="swing",
        sync_compute=lambda: _bullish_body() | {"symbol": "NVDA", "layers": _six_layers()},
    )
    assert calls == [("sub-x", "NVDA", "swing")]


def _four_bullish_two_bear_body() -> dict[str, Any]:
    return {
        "symbol": "AAPL",
        "signal_summary": "bullish",
        "layers": [
            _layer("technical", verdict="bullish"),
            _layer("news", verdict="bullish"),
            _layer("macro", verdict="bullish"),
            _layer("sector", verdict="bullish"),
            _layer("geopolitical", verdict="bearish"),
            _layer("internals", verdict="bearish"),
        ],
    }


def test_sync_notifies_on_state_change_after_initial_row(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[Any, ...]] = []

    def capture(**kw: Any) -> None:
        calls.append((kw["previous_state"], kw["new_state"]))

    monkeypatch.setattr(
        "stocvest.api.services.watchlist_maturation_notify.try_notify_watchlist_maturation_state_change",
        capture,
    )
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_bullish_body(),
        maturation_repo=repo,
        watchlist_store=store,
    )
    assert calls == []
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_four_bullish_two_bear_body(),
        maturation_repo=repo,
        watchlist_store=store,
    )
    assert calls == [(WatchlistState.ACTIONABLE, WatchlistState.DEVELOPING)]


def test_sync_logs_transition_on_alignment_change() -> None:
    mat_table = _FakeDynamoTable()
    trans_table = _FakeDynamoTable()
    mat_repo = WatchlistMaturationRepository(mat_table)
    trans_repo = WatchlistMaturationTransitionRepository(trans_table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_bullish_body(),
        maturation_repo=mat_repo,
        transition_repo=trans_repo,
        watchlist_store=store,
    )
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_four_bullish_two_bear_body(),
        maturation_repo=mat_repo,
        transition_repo=trans_repo,
        watchlist_store=store,
    )
    rows = trans_repo.list_for_symbol("u1", "AAPL", "swing")
    assert len(rows) == 2
    assert rows[0].to_state == "actionable"
    assert rows[1].to_state == "developing"
    assert rows[1].previous_layers_aligned == 6


def test_sync_skips_transition_when_nothing_changed() -> None:
    mat_table = _FakeDynamoTable()
    trans_table = _FakeDynamoTable()
    mat_repo = WatchlistMaturationRepository(mat_table)
    trans_repo = WatchlistMaturationTransitionRepository(trans_table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    body = _bullish_body()
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=body,
        maturation_repo=mat_repo,
        transition_repo=trans_repo,
        watchlist_store=store,
    )
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=body,
        maturation_repo=mat_repo,
        transition_repo=trans_repo,
        watchlist_store=store,
    )
    assert len(trans_repo.list_for_symbol("u1", "AAPL", "swing")) == 1


def test_sync_skips_notify_when_email_on_state_change_false(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[int] = []

    def capture(**kw: Any) -> None:
        calls.append(1)

    monkeypatch.setattr(
        "stocvest.api.services.watchlist_maturation_notify.try_notify_watchlist_maturation_state_change",
        capture,
    )
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["AAPL"], is_default=True)
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_bullish_body(),
        maturation_repo=repo,
        watchlist_store=store,
        email_on_state_change=False,
    )
    sync_watchlist_maturation_from_composite(
        user_id="u1",
        symbol="AAPL",
        mode="swing",
        composite_body=_four_bullish_two_bear_body(),
        maturation_repo=repo,
        watchlist_store=store,
        email_on_state_change=False,
    )
    assert calls == []


def test_composite_evidence_cache_reports_written_sync(monkeypatch: pytest.MonkeyPatch) -> None:
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "Main", ["NVDA"], is_default=True)
    monkeypatch.setattr(
        "stocvest.api.services.watchlist_maturation_sync.get_watchlist_maturation_repository",
        lambda: repo,
    )
    monkeypatch.setattr(
        "stocvest.api.services.watchlist_maturation_sync.get_watchlist_store",
        lambda: store,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: False,
    )
    monkeypatch.setattr("stocvest.api.handlers.signals.read_dashboard_cache", lambda _k: None)
    monkeypatch.setattr("stocvest.api.handlers.signals.write_dashboard_cache", lambda *a, **k: True)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals._compute_with_thread_timeout",
        lambda fn, timeout_sec: fn(),
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.polygon_circuit",
        MagicMock(call=lambda fn: fn()),
    )

    out = composite_response_with_evidence_cache(
        symbol="NVDA",
        user_id="u1",
        user_email=None,
        mode="swing",
        sync_compute=lambda: _bullish_body() | {"symbol": "NVDA", "layers": _six_layers()},
    )
    assert out.get("watchlist_maturation_sync") == "written"
    assert repo.get_entry("u1", "NVDA", "swing") is not None


def test_composite_evidence_cache_skips_sync_without_user(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[Any] = []

    def capture(**kw: Any) -> None:
        calls.append(1)

    monkeypatch.setattr(
        "stocvest.api.services.watchlist_maturation_sync.sync_watchlist_maturation_from_composite",
        capture,
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.evidence_rate_limit_exceeded",
        lambda _uid: False,
    )
    monkeypatch.setattr("stocvest.api.handlers.signals.read_dashboard_cache", lambda _k: None)
    monkeypatch.setattr("stocvest.api.handlers.signals.write_dashboard_cache", lambda *a, **k: True)
    monkeypatch.setattr(
        "stocvest.api.handlers.signals._compute_with_thread_timeout",
        lambda fn, timeout_sec: fn(),
    )
    monkeypatch.setattr(
        "stocvest.api.handlers.signals.polygon_circuit",
        MagicMock(call=lambda fn: fn()),
    )

    composite_response_with_evidence_cache(
        symbol="NVDA",
        user_id=None,
        user_email=None,
        mode="day",
        sync_compute=lambda: {"symbol": "NVDA", "score": 1},
    )
    assert calls == []
