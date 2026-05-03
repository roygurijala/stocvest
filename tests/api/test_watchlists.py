from __future__ import annotations

import json
from typing import Any

import pytest

from stocvest.api.lambda_dispatch import lambda_handler
from stocvest.data.scan_symbols import SYSTEM_DEFAULTS, get_scan_symbols
from stocvest.data.watchlist_store import InMemoryWatchlistStore, get_watchlist_store


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


def test_max_50_symbols_enforced(brokers: None) -> None:
    syms = [f"S{i:02d}" for i in range(50)]
    wid = _body(lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Full", "symbols": syms}), {}))[
        "watchlist_id"
    ]
    r = lambda_handler(
        _ev("POST", f"/v1/watchlists/{wid}/symbols", body={"symbol": "ZZ"}, path_parameters={"watchlist_id": wid}),
        {},
    )
    assert r["statusCode"] == 400


def test_max_5_watchlists_enforced(brokers: None) -> None:
    for i in range(5):
        rr = lambda_handler(_ev("POST", "/v1/watchlists", body={"name": f"W{i}", "symbols": []}), {})
        assert rr["statusCode"] == 200, i
    r6 = lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Six", "symbols": []}), {})
    assert r6["statusCode"] == 400


def test_default_watchlist_returned_for_scanner(brokers: None) -> None:
    lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Mine", "symbols": ["IBM"], "is_default": True}), {})
    r = lambda_handler(_ev("GET", "/v1/watchlists/default/symbols"), {})
    assert r["statusCode"] == 200
    b = _body(r)
    assert "IBM" in b["symbols"]
    assert len(b["symbols"]) <= 20


def test_system_defaults_when_no_watchlist() -> None:
    assert get_scan_symbols(None, InMemoryWatchlistStore()) == list(SYSTEM_DEFAULTS)
    store = InMemoryWatchlistStore()
    assert get_scan_symbols("u-empty", store) == list(SYSTEM_DEFAULTS)


def test_delete_last_watchlist_blocked(brokers: None) -> None:
    wid = _body(lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "Only", "symbols": []}), {}))[
        "watchlist_id"
    ]
    r = lambda_handler(
        _ev("DELETE", f"/v1/watchlists/{wid}", path_parameters={"watchlist_id": wid}),
        {},
    )
    assert r["statusCode"] == 400


def test_set_default_unsets_others(brokers: None) -> None:
    w1 = _body(lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "A", "symbols": [], "is_default": True}), {}))
    w2 = _body(lambda_handler(_ev("POST", "/v1/watchlists", body={"name": "B", "symbols": [], "is_default": True}), {}))
    assert w2["is_default"] is True
    lst = _body(lambda_handler(_ev("GET", "/v1/watchlists"), {}))["watchlists"]
    by_id = {x["watchlist_id"]: x for x in lst}
    assert by_id[w2["watchlist_id"]]["is_default"] is True
    assert by_id[w1["watchlist_id"]]["is_default"] is False


def test_get_watchlist_store_returns_memory_when_table_cleared() -> None:
    assert isinstance(get_watchlist_store(), InMemoryWatchlistStore)
