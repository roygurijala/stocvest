from __future__ import annotations

from stocvest.api.services.market_environment import build_market_environment_policy
import json

from stocvest.api.services.signal_validation_eligibility import (
    DECISION_STATE_ACTIONABLE,
    DECISION_STATE_BLOCKED,
    DECISION_STATE_MONITOR,
    MIN_RISK_REWARD_DAY,
    MIN_RISK_REWARD_SWING,
    derive_decision_state,
    evaluate_day_ledger_entry,
    evaluate_swing_ledger_entry,
    gate_blob_json,
    market_environment_audit_blob,
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


def test_swing_crisis_environment_blocks_ledger() -> None:
    env = build_market_environment_policy(mode="swing", vix_level=33.0)
    ok, gates = evaluate_swing_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=5.0,
        layer_scores={"sector": 50.0},
        market_environment=env,
    )
    assert not ok
    assert gates["market_environment"]["pass"] is False


def test_swing_elevated_requires_3_to_1() -> None:
    env = build_market_environment_policy(mode="swing", vix_level=22.0)
    ok, gates = evaluate_swing_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=2.5,
        layer_scores={"sector": 50.0},
        market_environment=env,
    )
    assert not ok
    assert gates["risk_reward"]["min"] == 3.0


def test_swing_sector_gate_uses_analyzer_score_not_composite_signal() -> None:
    ok, gates = evaluate_swing_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=MIN_RISK_REWARD_SWING,
        layer_scores={"sector": -0.6},
        sector_layer_score=55.0,
    )
    assert gates["sector_gate"]["pass"] is True
    assert gates["sector_gate"]["value"] == 55.0
    assert ok


def test_swing_sector_gate_ignores_composite_signal_scale_in_layer_scores() -> None:
    ok, gates = evaluate_swing_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=MIN_RISK_REWARD_SWING,
        layer_scores={"sector": -0.6},
    )
    assert gates["sector_gate"]["pass"] is True
    assert gates["sector_gate"].get("reason") == "sector_unavailable"


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


def test_gate_blob_includes_market_environment_audit() -> None:
    env = build_market_environment_policy(mode="swing", vix_level=29.0, vix_change_5d_pct=8.0)
    audit = market_environment_audit_blob(env)
    assert audit is not None
    assert audit["environment_tier"] == "stressed"
    assert audit["policy_version"] == env["policy_version"]

    blob = json.loads(
        gate_blob_json(
            {"risk_reward": {"pass": True}},
            qualified=False,
            market_environment=env,
        )
    )
    assert blob["market_environment_audit"]["environment_tier"] == "stressed"
    assert blob["market_environment_audit"]["vix_level"] == 29.0
