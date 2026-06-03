"""Unit tests for :mod:`stocvest.api.services.symbol_resolver`."""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.api.services.symbol_resolver import resolve_symbol
from stocvest.data.polygon_client import PolygonError


class _FakeClient:
    """Minimal stand-in exposing only ``get_ticker_details``."""

    def __init__(self, *, result: dict[str, Any] | None = None, error: Exception | None = None) -> None:
        self._result = result
        self._error = error
        self.calls: list[str] = []

    async def get_ticker_details(self, symbol: str) -> dict[str, Any]:
        self.calls.append(symbol)
        if self._error is not None:
            raise self._error
        return self._result or {}


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
