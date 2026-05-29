from __future__ import annotations

import json
from typing import Any

import pytest

from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.data.scan_symbols import SYSTEM_DEFAULTS, get_scan_symbols
from stocvest.data.watchlist_store import InMemoryWatchlistStore, WatchlistItem, get_watchlist_store, _utc_now


def _ev(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
    path_parameters: dict[str, str] | None = None,
    sub: str = "wl-user-1",
    email: str = "wl@example.com",
) -> dict[str, Any]:
    rk = f"{method} {path}"
    return {
        "version": "2.0",
        "routeKey": rk,
        "path": path,
        "httpMethod": method,
        "pathParameters": path_parameters,
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "requestContext": {
            "requestId": "req-wl",
            "authorizer": {"claims": {"sub": sub, "email": email}},
            "http": {"method": method, "path": path},
        },
    }


def _body(resp: dict[str, Any]) -> Any:
    return json.loads(str(resp.get("body") or "{}"))


@pytest.fixture
def brokers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("STOCVEST_LAMBDA_MODULE", "brokers")


def test_create_watchlist(brokers: None) -> None:
    r = lambda_handler(
        _ev("POST", "/v1/watchlists", body={"name": "Tech", "symbols": ["AAPL", "nvda"], "is_default": True}),
        {},
    )
    assert r["statusCode"] == 200
    b = _body(r)
    assert b["name"] == "Tech"
    assert b["symbols"] == ["AAPL", "NVDA"]
    assert b["is_default"] is True


def test_add_symbol_to_watchlist(brokers: None) -> None:
    wid = _body(
        lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Main", "symbols": ["SPY"]}), {})
    )["watchlist_id"]
    r = lambda_handler(
        _ev("POST", f"/v1/watchlists/{wid}/symbols", body={"symbol": "qqq"}, path_parameters={"watchlist_id": wid}),
        {},
    )
    assert r["statusCode"] == 200
    syms = _body(r)["symbols"]
    assert "SPY" in syms and "QQQ" in syms


def test_remove_symbol_from_watchlist(brokers: None) -> None:
    wid = _body(
        lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "R", "symbols": ["AAPL", "MSFT"]}), {})
    )["watchlist_id"]
    r = lambda_handler(
        _ev(
            "DELETE",
            "/v1/watchlists/x/symbols/AAPL",
            path_parameters={"watchlist_id": wid, "symbol": "AAPL"},
        ),
        {},
    )
    assert r["statusCode"] == 200
    assert "AAPL" not in _body(r)["symbols"]


def test_free_plan_caps_at_five_symbols(brokers: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.services.user_profile_store import get_user_profile_store
    from stocvest.data.models import UserProfile

    store = get_user_profile_store()
    store.put_profile(UserProfile(user_id="wl-user-1", subscription_plan="free"))
    syms = [f"S{i}" for i in range(5)]
    wid = _body(
        lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Free", "symbols": syms}, sub="wl-user-1"), {})
    )["watchlist_id"]
    r = lambda_handler(
        _ev(
            "POST",
            f"/v1/watchlists/{wid}/symbols",
            body={"symbol": "ZZ"},
            path_parameters={"watchlist_id": wid},
            sub="wl-user-1",
        ),
        {},
    )
    assert r["statusCode"] == 400
    assert _body(r).get("error") == "symbol_limit"


def test_swing_pro_allows_fifty_symbols(brokers: None, monkeypatch: pytest.MonkeyPatch) -> None:
    from stocvest.api.services.user_profile_store import get_user_profile_store
    from stocvest.data.models import UserProfile

    store = get_user_profile_store()
    store.put_profile(UserProfile(user_id="wl-pro", subscription_plan="swing_pro"))
    syms = [f"S{i:02d}" for i in range(50)]
    wid = _body(
        lambda_handler(
            _ev("POST", "/v1/watchlists", body={"name": "Pro", "symbols": syms}, sub="wl-pro"),
            {},
        )
    )["watchlist_id"]
    r = lambda_handler(
        _ev(
            "POST",
            f"/v1/watchlists/{wid}/symbols",
            body={"symbol": "ZZ"},
            path_parameters={"watchlist_id": wid},
            sub="wl-pro",
        ),
        {},
    )
    assert r["statusCode"] == 400


def test_second_watchlist_create_rejected(brokers: None) -> None:
    r1 = lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "First", "symbols": ["AAPL"]}), {})
    assert r1["statusCode"] == 200
    r2 = lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Second", "symbols": ["MSFT"]}), {})
    assert r2["statusCode"] == 400
    body = _body(r2)
    assert body.get("error") == "watchlist_limit"


def test_default_watchlist_returned_for_scanner(brokers: None) -> None:
    lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Mine", "symbols": ["IBM"], "is_default": True}), {})
    r = lambda_handler(_ev("GET", "/v1/watchlists/default/symbols"), {})
    assert r["statusCode"] == 200
    b = _body(r)
    assert "IBM" in b["symbols"]
    assert len(b["symbols"]) <= 20


def test_system_defaults_when_no_watchlist() -> None:
    liquid = get_scan_symbols(None, InMemoryWatchlistStore())
    assert liquid[: len(SYSTEM_DEFAULTS)] == list(SYSTEM_DEFAULTS)
    assert "DELL" in liquid
    store = InMemoryWatchlistStore()
    assert get_scan_symbols("u-empty", store) == liquid


def test_delete_last_watchlist_blocked(brokers: None) -> None:
    wid = _body(lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Only", "symbols": []}), {}))[
        "watchlist_id"
    ]
    r = lambda_handler(
        _ev("DELETE", f"/v1/watchlists/{wid}", path_parameters={"watchlist_id": wid}),
        {},
    )
    assert r["statusCode"] == 400


def test_patch_watchlist_name(brokers: None) -> None:
    w = _body(lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Old", "symbols": ["SPY"]}), {}))
    wid = w["watchlist_id"]
    r = lambda_handler(
        _ev("PATCH", f"/v1/watchlists/{wid}", body={"name": "Renamed"}, path_parameters={"watchlist_id": wid}),
        {},
    )
    assert r["statusCode"] == 200
    assert _body(r)["name"] == "Renamed"


def test_legacy_multiple_lists_consolidated_on_get(brokers: None, monkeypatch: pytest.MonkeyPatch) -> None:
    """If storage somehow has two rows for one user, GET /v1/watchlists merges and deletes extras."""
    import uuid

    store = InMemoryWatchlistStore()
    monkeypatch.setattr("stocvest.api.handlers.watchlists.get_watchlist_store", lambda: store)
    now = _utc_now()
    w1 = store.create_watchlist("wl-user-1", "Main", ["AAPL"], is_default=True)
    wid2 = str(uuid.uuid4())
    store._by_user["wl-user-1"][wid2] = WatchlistItem(
        user_id="wl-user-1",
        watchlist_id=wid2,
        name="Extra",
        symbols=["NVDA", "MSFT"],
        is_default=False,
        created_at=now,
        updated_at=now,
    )
    lst = _body(lambda_handler(_ev("GET", "/v1/watchlists"), {}))["watchlists"]
    assert len(lst) == 1
    assert lst[0]["watchlist_id"] == w1.watchlist_id
    syms = set(lst[0]["symbols"])
    assert syms == {"AAPL", "NVDA", "MSFT"}


def test_get_watchlist_store_returns_memory_when_table_cleared() -> None:
    assert isinstance(get_watchlist_store(), InMemoryWatchlistStore)


def test_watchlist_item_from_item_dedupes_symbols_case_insensitive() -> None:
    w = WatchlistItem.from_item(
        "u1",
        {
            "watchlistId": "w1",
            "name": "Main",
            "symbols": ["aapl", "AAPL", " msft ", "NVDA", "nvda"],
            "isDefault": True,
            "createdAt": "t0",
            "updatedAt": "t1",
        },
    )
    assert w.symbols == ["AAPL", "MSFT", "NVDA"]
