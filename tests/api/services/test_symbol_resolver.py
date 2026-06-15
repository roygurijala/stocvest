"""Unit tests for :mod:`stocvest.api.services.symbol_resolver`."""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.api.services.symbol_resolver import (
    resolve_company_to_symbol,
    resolve_symbol,
)
from stocvest.data.polygon_client import PolygonError
from stocvest.data.models import Snapshot


class _FakeClient:
    """Minimal stand-in exposing reference + snapshot lookups."""

    def __init__(
        self,
        *,
        result: dict[str, Any] | None = None,
        error: Exception | None = None,
        snapshot: Any | None = None,
        snapshot_error: Exception | None = None,
        search_rows: list[dict[str, str]] | None = None,
    ) -> None:
        self._result = result
        self._error = error
        self._snapshot = snapshot
        self._snapshot_error = snapshot_error
        self._search_rows = search_rows
        self.calls: list[str] = []

    async def get_ticker_details(self, symbol: str) -> dict[str, Any]:
        self.calls.append(symbol)
        if self._error is not None:
            raise self._error
        return self._result or {}

    async def get_snapshot(self, symbol: str) -> Any:
        if self._snapshot_error is not None:
            raise self._snapshot_error
        if self._snapshot is not None:
            return self._snapshot
        raise PolygonError(f"Polygon 404 on snapshot/{symbol}: NOT_FOUND")

    async def search_reference_tickers(self, query: str, *, limit: int = 15) -> list[dict[str, str]]:
        _ = limit
        return list(self._search_rows or [])


class _FakeSearchClient:
    """Stand-in exposing ``search_reference_tickers`` for company lookups."""

    def __init__(
        self,
        *,
        rows: list[dict[str, str]] | None = None,
        rows_by_query: dict[str, list[dict[str, str]]] | None = None,
        error: Exception | None = None,
    ) -> None:
        self._rows = rows or []
        self._rows_by_query = rows_by_query
        self._error = error
        self.queries: list[str] = []

    async def search_reference_tickers(self, query: str, *, limit: int = 15) -> list[dict[str, str]]:
        self.queries.append(query)
        if self._error is not None:
            raise self._error
        if self._rows_by_query is not None:
            return self._rows_by_query.get(query, [])
        return self._rows


def _run(coro: Any) -> Any:
    return asyncio.run(coro)


def test_valid_active_symbol_resolves_with_name() -> None:
    client = _FakeClient(result={"ticker": "NVDA", "name": "NVIDIA Corporation", "active": True})
    res = _run(resolve_symbol("nvda", client=client))
    assert res.valid is True
    assert res.found is True
    assert res.name == "NVIDIA Corporation"
    assert res.symbol == "NVDA"
    assert res.display_label == "NVDA (NVIDIA Corporation)"


def test_delisted_symbol_is_rejected() -> None:
    client = _FakeClient(result={"ticker": "DEAD", "name": "Defunct Co", "active": False})
    res = _run(resolve_symbol("dead", client=client))
    assert res.valid is False
    assert res.found is True
    assert res.active is False
    assert res.reason and "delisted" in res.reason.lower()


def test_404_means_not_found_and_blocks_add() -> None:
    client = _FakeClient(error=PolygonError("Polygon 404 on /v3/reference/tickers/ZZZZ: NOT_FOUND"))
    res = _run(resolve_symbol("ZZZZ", client=client))
    assert res.valid is False
    assert res.found is False
    assert res.verified is True
    assert res.reason and "ZZZZ" in res.reason


def test_reference_404_with_live_snapshot_allows_add() -> None:
    client = _FakeClient(
        error=PolygonError("Polygon 404 on /v3/reference/tickers/LOFF: NOT_FOUND"),
        snapshot=Snapshot(
            symbol="LOFF",
            last_trade_price=33.07,
            company_name="Direxion Daily SpaceX Bull 2X ETF",
        ),
    )
    res = _run(resolve_symbol("LOFF", client=client))
    assert res.valid is True
    assert res.found is True
    assert res.verified is True
    assert res.symbol == "LOFF"
    assert res.name == "Direxion Daily SpaceX Bull 2X ETF"


def test_reference_search_fallback_when_details_empty() -> None:
    client = _FakeClient(
        result={},
        search_rows=[{"ticker": "LOFF", "name": "Direxion Daily SpaceX Bull 2X ETF"}],
    )
    res = _run(resolve_symbol("LOFF", client=client))
    assert res.valid is True
    assert res.found is True
    assert res.name == "Direxion Daily SpaceX Bull 2X ETF"


def test_transient_error_fails_open() -> None:
    client = _FakeClient(error=PolygonError("Polygon 503 on /v3/reference/tickers/AAPL after retries: busy"))
    res = _run(resolve_symbol("AAPL", client=client))
    # We never block a real add on a transient upstream failure.
    assert res.valid is True
    assert res.found is False
    assert res.verified is False


def test_empty_reference_is_not_found() -> None:
    client = _FakeClient(result={})
    res = _run(resolve_symbol("AAPL", client=client))
    assert res.valid is False
    assert res.found is False


def test_bad_shape_rejected_without_network() -> None:
    client = _FakeClient(result={"ticker": "X", "name": "X", "active": True})
    res = _run(resolve_symbol("not a ticker!!", client=client))
    assert res.valid is False
    assert res.found is False
    assert client.calls == []  # no lookup attempted


def test_empty_symbol_rejected() -> None:
    res = _run(resolve_symbol("   "))
    assert res.valid is False
    assert res.found is False


# ── resolve_company_to_symbol ────────────────────────────────────────────────


def test_company_name_resolves_via_name_prefix() -> None:
    # "marvel" should resolve to MRVL because "Marvell Technology" starts with it.
    client = _FakeSearchClient(rows=[
        {"ticker": "MRVL", "name": "Marvell Technology, Inc."},
        {"ticker": "MVIS", "name": "MicroVision, Inc."},
    ])
    sym = _run(resolve_company_to_symbol("marvel", client=client))
    assert sym == "MRVL"


def test_company_name_exact_ticker_wins() -> None:
    client = _FakeSearchClient(rows=[
        {"ticker": "PLTR", "name": "Palantir Technologies Inc."},
    ])
    sym = _run(resolve_company_to_symbol("pltr", client=client))
    assert sym == "PLTR"


def test_company_name_no_match_returns_none() -> None:
    # A garbage phrase that matches no company name must not resolve.
    client = _FakeSearchClient(rows=[
        {"ticker": "XYZ", "name": "Totally Unrelated Holdings"},
    ])
    sym = _run(resolve_company_to_symbol("ratio evaluation", client=client))
    assert sym is None


def test_company_name_empty_rows_returns_none() -> None:
    client = _FakeSearchClient(rows=[])
    sym = _run(resolve_company_to_symbol("nonexistentco", client=client))
    assert sym is None


def test_company_name_search_error_fails_closed() -> None:
    client = _FakeSearchClient(error=PolygonError("Polygon 503: busy"))
    sym = _run(resolve_company_to_symbol("apple", client=client))
    assert sym is None


def test_company_name_too_short_skips_search() -> None:
    client = _FakeSearchClient(rows=[{"ticker": "AA", "name": "Alcoa"}])
    sym = _run(resolve_company_to_symbol("ai", client=client))
    assert sym is None
    assert client.queries == []  # never reached the network


def test_company_name_falls_back_to_token_when_phrase_fails() -> None:
    # "broadcom forecast" has no company match as a phrase, but the "broadcom"
    # token resolves to AVGO — the resolver must try the token after the phrase.
    client = _FakeSearchClient(rows_by_query={
        "broadcom forecast": [],
        "broadcom": [{"ticker": "AVGO", "name": "Broadcom Inc."}],
    })
    sym = _run(resolve_company_to_symbol("broadcom forecast", client=client))
    assert sym == "AVGO"
    assert client.queries[0] == "broadcom forecast"  # full phrase tried first


def test_company_name_skips_short_tokens_in_fallback() -> None:
    # The 2-char "do" must never be searched as a standalone token.
    client = _FakeSearchClient(rows_by_query={"tesla": [{"ticker": "TSLA", "name": "Tesla, Inc."}]})
    sym = _run(resolve_company_to_symbol("tesla do", client=client))
    assert sym == "TSLA"
    assert "do" not in client.queries
