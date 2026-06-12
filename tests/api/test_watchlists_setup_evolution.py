"""Tests for GET /v1/watchlists/symbols/{symbol}/setup-evolution."""

from __future__ import annotations

from typing import Any

from stocvest.api.handlers.watchlists import watchlists_setup_evolution_handler
from stocvest.data.watchlist_maturation_repository import WatchlistMaturationRepository
from stocvest.data.watchlist_maturation_transition_repository import (
    WatchlistMaturationTransitionRepository,
)
from stocvest.data.watchlist_store import InMemoryWatchlistStore
from stocvest.models.watchlist import WatchlistEntry, WatchlistState
from stocvest.models.watchlist_transition import WatchlistMaturationTransition
from tests.data.test_watchlist_maturation_repository import _FakeDynamoTable


def _event(symbol: str = "TSLA", *, sub: str = "sub-1") -> dict[str, Any]:
    return {
        "version": "2.0",
        "routeKey": f"GET /v1/watchlists/symbols/{symbol}/setup-evolution",
        "pathParameters": {"symbol": symbol},
        "queryStringParameters": {"mode": "swing"},
        "requestContext": {
            "requestId": "req-evol",
            "authorizer": {"claims": {"sub": sub, "email": "u@example.com"}},
            "http": {"method": "GET", "path": f"/v1/watchlists/symbols/{symbol}/setup-evolution"},
        },
    }


def test_setup_evolution_requires_auth() -> None:
    ev = _event()
    ev["requestContext"] = {"authorizer": {"claims": {}}}  # type: ignore[assignment]
    resp = watchlists_setup_evolution_handler(ev, {})
    assert resp["statusCode"] == 401


def test_setup_evolution_not_on_watchlist() -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("sub-1", "Main", ["AAPL"], is_default=True)
    from stocvest.api.handlers import watchlists as wh

    wh.get_watchlist_store = lambda: store  # type: ignore[method-assign]
    resp = watchlists_setup_evolution_handler(_event("TSLA"), {})
    assert resp["statusCode"] == 404


def test_setup_evolution_returns_transitions(monkeypatch) -> None:
    import json

    store = InMemoryWatchlistStore()
    store.create_watchlist("sub-1", "Main", ["TSLA"], is_default=True)
    mat_table = _FakeDynamoTable()
    trans_table = _FakeDynamoTable()
    mat_repo = WatchlistMaturationRepository(mat_table)
    trans_repo = WatchlistMaturationTransitionRepository(trans_table)
    mat_repo.put_entry(
        WatchlistEntry(
            user_id="sub-1",
            symbol="TSLA",
            mode="swing",
            state=WatchlistState.DEVELOPING,
            previous_state=None,
            state_changed_at="2026-05-16T12:00:00+00:00",
            state_change_reason="test",
            layers_aligned=3,
            added_at="2026-05-16T10:00:00+00:00",
        )
    )
    trans_repo.put_transition(
        WatchlistMaturationTransition(
            user_id="sub-1",
            symbol="TSLA",
            mode="swing",
            recorded_at="2026-05-16T12:00:00+00:00",
            session_date="2026-05-16",
            from_state=None,
            to_state="developing",
            layers_aligned=3,
            previous_layers_aligned=None,
            layers_total=6,
            alignment_pct=50.0,
            bias="long",
            transition_type="initial",
        )
    )

    from stocvest.api.handlers import watchlists as wh

    wh.get_watchlist_store = lambda: store  # type: ignore[method-assign]
    monkeypatch.setattr(wh, "get_watchlist_maturation_repository", lambda: mat_repo)
    monkeypatch.setattr(wh, "get_watchlist_maturation_transition_repository", lambda: trans_repo)

    resp = watchlists_setup_evolution_handler(_event(), {})
    assert resp["statusCode"] == 200
    body = json.loads(resp["body"])
    assert body["symbol"] == "TSLA"
    assert body["started_tracking_at"] == "2026-05-16T10:00:00+00:00"
    assert len(body["transitions"]) == 1
    assert body["transitions"][0]["to_state"] == "developing"
    assert body["summary"]["latest_state"] == "developing"
    assert body["summary"]["days_tracked"] >= 1
    assert "analytics" in body
    assert body["analytics"]["actionable_score_threshold"] == 72
    assert len(body["analytics"]["score_trend"]) == 1
    assert len(body["analytics"]["state_journey"]) == 1
