"""GET /v1/watchlists/maturation-summary."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from stocvest.api.handlers.watchlists import watchlists_maturation_summary_handler
from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.api.services.user_profile_store import InMemoryUserProfileStore
from stocvest.api.types import LambdaEvent
from stocvest.data.models import UserProfile
from stocvest.data.watchlist_maturation_repository import WatchlistMaturationRepository
from stocvest.data.watchlist_maturation_transition_repository import (
    WatchlistMaturationTransitionRepository,
)
from stocvest.data.watchlist_store import InMemoryWatchlistStore
from stocvest.models.watchlist import WatchlistEntry, WatchlistState
from stocvest.models.watchlist_transition import WatchlistMaturationTransition
from tests.data.test_watchlist_maturation_repository import _FakeDynamoTable
from tests.data.test_watchlist_maturation_transition_repository import _FakeDynamoTable as _FakeTransTable


def _ctx() -> MagicMock:
    return MagicMock()


def _event(*, sub: str = "user-mat-1", mode: str | None = "day") -> LambdaEvent:
    qs = {"mode": mode} if mode else None
    return {
        "version": "2.0",
        "routeKey": "GET /v1/watchlists/maturation-summary",
        "queryStringParameters": qs,
        "requestContext": {
            "requestId": "req-mat",
            "authorizer": {"claims": {"sub": sub, "email": "m@example.com"}},
            "http": {"method": "GET", "path": "/v1/watchlists/maturation-summary"},
        },
    }


def test_maturation_summary_unauthorized_without_sub() -> None:
    ev = _event(sub="")
    ev["requestContext"] = {"authorizer": {"claims": {}}}  # type: ignore[assignment]
    resp = watchlists_maturation_summary_handler(ev, _ctx())
    assert resp["statusCode"] == 401


def test_maturation_summary_empty_when_repo_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "stocvest.api.handlers.watchlists.get_watchlist_maturation_repository",
        lambda: None,
    )
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "M", ["AAPL"], is_default=True)
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    resp = watchlists_maturation_summary_handler(_event(sub="u1"), _ctx())
    assert resp["statusCode"] == 200
    import json

    data = json.loads(str(resp["body"]))
    assert data.get("by_symbol") == {}


def test_maturation_summary_default_list_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "M", ["AAPL"], is_default=True)
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    entry_aapl = WatchlistEntry(
        user_id="u1",
        symbol="AAPL",
        mode="day",
        state=WatchlistState.ACTIONABLE,
        previous_state=None,
        state_changed_at="2026-01-01T00:00:00+00:00",
        state_change_reason="x",
        layers_aligned=6,
    )
    entry_nvda = WatchlistEntry(
        user_id="u1",
        symbol="NVDA",
        mode="day",
        state=WatchlistState.DEVELOPING,
        previous_state=None,
        state_changed_at="2026-01-01T00:00:00+00:00",
        state_change_reason="x",
        layers_aligned=3,
    )
    repo.put_entry(entry_aapl)
    repo.put_entry(entry_nvda)
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_maturation_repository", lambda: repo)
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", subscription_plan="swing_day_pro"))
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_user_profile_store", lambda: profiles)
    resp = watchlists_maturation_summary_handler(_event(sub="u1", mode="day"), _ctx())
    import json

    data = json.loads(str(resp["body"]))
    assert data["mode"] == "day"
    aapl = data["by_symbol"]["AAPL"]
    assert aapl["state"] == "actionable"
    assert "readiness_label" in aapl and isinstance(aapl["readiness_label"], str)
    assert aapl.get("label") == "Actionable"
    assert aapl.get("missing_layers") == []
    assert aapl.get("bias") == "neutral"


def test_maturation_summary_free_plan_omits_readiness_label(monkeypatch: pytest.MonkeyPatch) -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "M", ["AAPL"], is_default=True)
    table = _FakeDynamoTable()
    repo = WatchlistMaturationRepository(table)
    entry_aapl = WatchlistEntry(
        user_id="u1",
        symbol="AAPL",
        mode="day",
        state=WatchlistState.ACTIONABLE,
        previous_state=None,
        state_changed_at="2026-01-01T00:00:00+00:00",
        state_change_reason="x",
        layers_aligned=6,
    )
    repo.put_entry(entry_aapl)
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_maturation_repository", lambda: repo)
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", subscription_plan="free"))
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_user_profile_store", lambda: profiles)
    resp = watchlists_maturation_summary_handler(_event(sub="u1", mode="day"), _ctx())
    data = json.loads(str(resp["body"]))
    aapl = data["by_symbol"]["AAPL"]
    assert aapl["state"] == "actionable"
    assert aapl.get("label") == "Actionable"
    assert "readiness_label" not in aapl


def test_maturation_summary_includes_progression_from_latest_transition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = InMemoryWatchlistStore()
    store.create_watchlist("u1", "M", ["AAPL"], is_default=True)
    mat_table = _FakeDynamoTable()
    mat_repo = WatchlistMaturationRepository(mat_table)
    mat_repo.put_entry(
        WatchlistEntry(
            user_id="u1",
            symbol="AAPL",
            mode="swing",
            state=WatchlistState.DEVELOPING,
            previous_state=WatchlistState.DEVELOPING,
            state_changed_at="2026-05-11T12:00:00+00:00",
            state_change_reason="x",
            layers_aligned=4,
        )
    )
    trans_table = _FakeTransTable()
    trans_repo = WatchlistMaturationTransitionRepository(trans_table)
    trans_repo.put_transition(
        WatchlistMaturationTransition(
            user_id="u1",
            symbol="AAPL",
            mode="swing",
            recorded_at="2026-05-11T12:00:00+00:00",
            session_date="2026-05-11",
            from_state="developing",
            to_state="developing",
            layers_aligned=4,
            previous_layers_aligned=3,
            layers_total=6,
            alignment_pct=66.7,
            bias="long",
            transition_type="improved",
        )
    )
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_maturation_repository", lambda: mat_repo)
    monkeypatch.setattr(
        "stocvest.api.handlers.watchlists.get_watchlist_maturation_transition_repository",
        lambda: trans_repo,
    )
    profiles = InMemoryUserProfileStore()
    profiles.put_profile(UserProfile(user_id="u1", subscription_plan="free"))
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_user_profile_store", lambda: profiles)
    resp = watchlists_maturation_summary_handler(_event(sub="u1", mode="swing"), _ctx())
    data = json.loads(str(resp["body"]))
    aapl = data["by_symbol"]["AAPL"]
    assert aapl["layers_aligned"] == 4
    assert aapl["previous_layers_aligned"] == 3
    assert aapl["last_transition_type"] == "improved"


def test_lambda_dispatch_maturation_summary(monkeypatch: pytest.MonkeyPatch) -> None:
    """Brokers Lambda routes GET maturation-summary to watchlists handler."""
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")
    monkeypatch.setattr(
        "stocvest.api.handlers.watchlists.get_watchlist_maturation_repository",
        lambda: None,
    )
    event = {
        "version": "2.0",
        "routeKey": "GET /v1/watchlists/maturation-summary",
        "queryStringParameters": {"mode": "day"},
        "requestContext": {
            "requestId": "req-dispatch-mat",
            "authorizer": {"claims": {"sub": "dispatch-user", "email": "d@example.com"}},
            "http": {"method": "GET", "path": "/v1/watchlists/maturation-summary"},
        },
    }
    resp = lambda_handler(event, MagicMock())
    assert resp.get("statusCode") == 200
    body = json.loads(str(resp.get("body") or "{}"))
    assert body.get("mode") == "day"
    assert body.get("by_symbol") == {}
