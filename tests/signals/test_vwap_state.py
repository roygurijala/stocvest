from __future__ import annotations

from stocvest.signals.vwap_state import (
    VWAP_STATE_CHIP,
    VWAP_STATE_TOOLTIP,
    VWAPState,
    build_vwap_chip,
    resolve_vwap_state,
)


def test_pre_market_returns_pre_market_state() -> None:
    assert resolve_vwap_state(None, False, 0, True) == VWAPState.PRE_MARKET


def test_post_market_returns_post_market_state() -> None:
    assert resolve_vwap_state(None, False, 100, False) == VWAPState.POST_MARKET


def test_few_bars_returns_forming() -> None:
    assert resolve_vwap_state(430.0, True, 3, False) == VWAPState.FORMING


def test_none_vwap_market_open_returns_forming() -> None:
    assert resolve_vwap_state(None, True, 20, False) == VWAPState.FORMING


def test_available_state_normal_session() -> None:
    assert resolve_vwap_state(430.21, True, 100, False) == VWAPState.AVAILABLE


def test_chip_above_vwap() -> None:
    chip = build_vwap_chip(VWAPState.AVAILABLE, 430.21, 432.0)
    assert chip == "VWAP $430.21 — Above"


def test_chip_below_vwap() -> None:
    chip = build_vwap_chip(VWAPState.AVAILABLE, 430.21, 428.0)
    assert chip == "VWAP $430.21 — Below"


def test_chip_pre_market_label() -> None:
    assert build_vwap_chip(VWAPState.PRE_MARKET) == "VWAP starts at 9:30 ET"


def test_chip_forming_label() -> None:
    assert build_vwap_chip(VWAPState.FORMING) == "VWAP Forming"


def test_chip_post_market_label() -> None:
    assert build_vwap_chip(VWAPState.POST_MARKET) == "VWAP (RTH closed)"


def test_no_blank_chip_any_state() -> None:
    for st in VWAPState:
        chip = build_vwap_chip(st, 100.0 if st == VWAPState.AVAILABLE else None, 101.0)
        assert chip
        assert "None" not in chip
        if st != VWAPState.AVAILABLE:
            assert "—" not in chip


def test_tooltip_exists_for_all_states() -> None:
    for st in VWAPState:
        assert VWAP_STATE_TOOLTIP[st].strip()
        assert VWAP_STATE_CHIP[st].strip()
