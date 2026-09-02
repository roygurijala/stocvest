"""Risk/reward structure helpers — no 0.5 display floor."""

from __future__ import annotations

from stocvest.api.services.risk_reward_structure import (
    round_risk_reward_display,
    structure_risk_reward_for_mode,
    structure_risk_reward_long,
)


def test_round_risk_reward_display_does_not_floor_to_half() -> None:
    assert round_risk_reward_display(0.35) == 0.3
    assert round_risk_reward_display(0.91) == 0.9
    assert round_risk_reward_display(0.12) != 0.5


def test_structure_risk_reward_uses_t2_when_t1_tight() -> None:
    # entry 100, stop ~97.8, t1=102 (tight), t2=2R extension ~104.4 — only when resistance-anchored
    stop = round(min(98, 99.5) * 0.998, 4)
    entry = 100.0
    t1 = 102.0
    t2 = entry + 2.0 * (entry - stop)
    rr = structure_risk_reward_long(entry, t1, stop, t2, "resistance")
    assert rr is not None
    assert rr > 1.0
    assert round_risk_reward_display(rr) != 0.5


def test_swing_mode_uses_t1_only_even_when_t2_improves_rr() -> None:
    """UPWK-style inflation: T2 promotion must not apply on swing desk R/R."""
    entry = 7.78
    stop = 7.59
    t1 = 7.95
    t2 = 9.50
    plan = structure_risk_reward_long(entry, t1, stop, t2, "resistance")
    swing = structure_risk_reward_for_mode(
        entry, t1, stop, t2, "resistance", trading_mode="swing", use_long=True
    )
    assert plan is not None and plan > 2.0
    assert swing is None
