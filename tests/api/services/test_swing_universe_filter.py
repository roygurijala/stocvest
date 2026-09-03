"""Tests for swing leveraged/inverse universe exclusions."""

from __future__ import annotations

from stocvest.api.services.geometry_tradeability import geometry_tradeability
from stocvest.api.services.swing_universe_filter import is_swing_excluded_symbol


def test_nvdq_is_swing_excluded() -> None:
    assert is_swing_excluded_symbol("NVDQ") is True
    assert is_swing_excluded_symbol("nvdq") is True
    assert is_swing_excluded_symbol("MSFT") is False


def test_geometry_tradeability_blocks_excluded_without_symbol_in_body() -> None:
    """Symbol must be passed explicitly when composite body omits it (discovery rows)."""
    body = {
        "status": "active",
        "signal_summary": "bullish",
        "last_trade_price": 8.83,
        "reference_stop_level": 8.20,
        "reference_target_1": 9.20,
        "reference_stop_distance_atr": 2.8,
        "min_rr_desk": 2.0,
        "risk_reward": 2.5,
    }
    ok, reason = geometry_tradeability(body, mode="swing", symbol="NVDQ")
    assert ok is False
    assert reason == "leveraged_inverse_excluded"


def test_geometry_tradeability_blocks_excluded_swing_symbol() -> None:
    body = {
        "status": "active",
        "signal_summary": "bullish",
        "symbol": "NVDQ",
        "last_trade_price": 8.83,
        "reference_stop_level": 8.20,
        "reference_target_1": 9.20,
        "reference_stop_distance_atr": 2.8,
        "min_rr_desk": 2.0,
        "risk_reward": 2.5,
    }
    ok, reason = geometry_tradeability(body, mode="swing")
    assert ok is False
    assert reason == "leveraged_inverse_excluded"


def test_geometry_tradeability_allows_excluded_symbol_on_day_desk() -> None:
    body = {
        "status": "active",
        "signal_summary": "bullish",
        "symbol": "NVDQ",
        "last_trade_price": 8.83,
        "reference_stop_level": 8.70,
        "reference_target_1": 9.20,
        "min_rr_desk": 2.0,
        "risk_reward": 2.5,
    }
    ok, reason = geometry_tradeability(body, mode="day")
    assert ok is True
    assert reason is None
