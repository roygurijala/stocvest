"""Risk/reward structure helpers — no 0.5 display floor."""

from __future__ import annotations

from stocvest.api.services.risk_reward_structure import (
    round_risk_reward_display,
    structure_risk_reward_long,
)


def test_round_risk_reward_display_does_not_floor_to_half() -> None:
    assert round_risk_reward_display(0.35) == 0.3
    assert round_risk_reward_display(0.91) == 0.9
    assert round_risk_reward_display(0.12) != 0.5


def test_structure_risk_reward_uses_t2_when_t1_tight() -> None:
    # entry 100, stop ~97.8, t1=102 (tight), t2=2R extension ~104.4
    stop = round(min(98, 99.5) * 0.998, 4)
    entry = 100.0
    t1 = 102.0
    t2 = entry + 2.0 * (entry - stop)
    rr = structure_risk_reward_long(entry, t1, stop, t2)
    assert rr is not None
    assert rr > 1.0
    assert round_risk_reward_display(rr) != 0.5
