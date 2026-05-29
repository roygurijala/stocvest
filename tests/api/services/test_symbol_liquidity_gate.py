"""Symbol liquidity gate for swing composite."""

from __future__ import annotations

from stocvest.api.services.symbol_liquidity_gate import swing_liquidity_gate_reason
from stocvest.data.models import Snapshot


def test_ccm_like_microcap_fails_adv_gate() -> None:
    snap = Snapshot(
        symbol="CCM",
        last_trade_price=5.05,
        prev_close=5.0,
        prev_day_volume=25_000.0,
    )
    reason = swing_liquidity_gate_reason(snap)
    assert reason is not None
    assert "watch" in reason.lower() or "volume" in reason.lower() or "1M" in reason


def test_liquid_symbol_passes() -> None:
    snap = Snapshot(
        symbol="AAPL",
        last_trade_price=180.0,
        prev_day_volume=50_000_000.0,
    )
    assert swing_liquidity_gate_reason(snap) is None
