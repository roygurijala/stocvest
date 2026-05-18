"""Tests for maturation transition logging helpers."""

from __future__ import annotations

from stocvest.api.services.watchlist_maturation_transition_log import _price_at_event


def test_price_at_event_from_composite() -> None:
    assert _price_at_event({"last_trade_price": 142.5}) == 142.5
    assert _price_at_event({}) is None
