"""Price cache warmer worker tests (Chunk 9)."""

from __future__ import annotations

from unittest.mock import patch

from stocvest.workers.price_cache_warmer import handler


def test_handler_returns_200_success() -> None:
    with patch(
        "stocvest.workers.price_cache_warmer.asyncio.run",
        return_value={"job": "warm_price_cache", "symbols": 10, "cached": 9, "errors": 1},
    ):
        resp = handler({}, None)
    assert resp["statusCode"] == 200
    assert resp["cached"] == 9


def test_handler_returns_200_partial_errors() -> None:
    with patch(
        "stocvest.workers.price_cache_warmer.asyncio.run",
        return_value={"job": "warm_price_cache", "symbols": 5, "cached": 2, "errors": 3},
    ):
        resp = handler({}, None)
    assert resp["statusCode"] == 200
    assert resp["errors"] == 3


def test_handler_never_raises() -> None:
    with patch("stocvest.workers.price_cache_warmer.asyncio.run", side_effect=RuntimeError("boom")):
        resp = handler({"action": "warm_price_cache"}, None)
    assert resp["statusCode"] == 200
    assert resp.get("error") == "RuntimeError"
