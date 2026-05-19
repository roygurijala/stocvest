"""Laggard jobs dispatcher tests (Chunk 9)."""

from __future__ import annotations

from unittest.mock import patch

from stocvest.workers.laggard_jobs import handler


def test_dispatches_warm_price_cache() -> None:
    with patch("stocvest.workers.price_cache_warmer.handler", return_value={"statusCode": 200, "job": "warm_price_cache"}) as m:
        resp = handler({"action": "warm_price_cache"}, None)
    assert resp["job"] == "warm_price_cache"
    m.assert_called_once()


def test_dispatches_pre_ipo_monitor() -> None:
    with patch("stocvest.workers.pre_ipo_monitor.handler", return_value={"statusCode": 200, "job": "pre_ipo_monitor"}):
        resp = handler({"action": "pre_ipo_monitor"}, None)
    assert resp["job"] == "pre_ipo_monitor"


def test_unknown_action_400() -> None:
    resp = handler({"action": "nope"}, None)
    assert resp["statusCode"] == 400
