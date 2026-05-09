from __future__ import annotations

from stocvest.api.services.signal_validation_eligibility import (
    DECISION_STATE_ACTIONABLE,
    DECISION_STATE_BLOCKED,
    DECISION_STATE_MONITOR,
    MIN_RISK_REWARD_DAY,
    MIN_RISK_REWARD_SWING,
    derive_decision_state,
    evaluate_day_ledger_entry,
    evaluate_swing_ledger_entry,
)
from stocvest.signals.composite_score import CompositeVerdict


def test_derive_decision_state_blocked_insufficient() -> None:
    assert (
        derive_decision_state(response_status="insufficient_data", verdict=CompositeVerdict.BULLISH)
        == DECISION_STATE_BLOCKED
    )


def test_derive_decision_state_monitor_neutral() -> None:
    assert derive_decision_state(response_status="active", verdict=CompositeVerdict.NEUTRAL) == DECISION_STATE_MONITOR


def test_derive_decision_state_actionable() -> None:
    assert derive_decision_state(response_status="active", verdict=CompositeVerdict.BULLISH) == DECISION_STATE_ACTIONABLE


def test_swing_rr_uses_2_to_1() -> None:
    ok, gates = evaluate_swing_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=MIN_RISK_REWARD_SWING - 0.1,
        layer_scores={"sector": 50.0},
    )
    assert not ok
    assert gates["risk_reward"]["pass"] is False
    assert gates["risk_reward"]["min"] == MIN_RISK_REWARD_SWING


def test_day_rr_uses_1_3_to_1() -> None:
    ok, gates = evaluate_day_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=MIN_RISK_REWARD_DAY - 0.05,
        intraday_bar_count=25,
        orb_signal="orb_long",
        vwap_state=None,
    )
    assert not ok
    assert gates["risk_reward"]["min"] == MIN_RISK_REWARD_DAY


def test_day_rr_passes_at_floor() -> None:
    ok, gates = evaluate_day_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=MIN_RISK_REWARD_DAY,
        intraday_bar_count=25,
        orb_signal="x",
        vwap_state=None,
    )
    assert ok
    assert gates["risk_reward"]["pass"] is True


def test_blocked_short_circuits_other_gates() -> None:
    ok, gates = evaluate_swing_ledger_entry(
        response_status="insufficient_data",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.9,
        alignment_ratio=0.99,
        macro_market_regime="bull",
        risk_reward=5.0,
        layer_scores={"sector": 90.0},
    )
    assert not ok
    assert "decision_state" in gates
    assert "risk_reward" not in gates
