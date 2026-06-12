"""Tests for execution-actionable gate evaluation."""

from __future__ import annotations

from stocvest.api.services.execution_actionable import (
    apply_entry_gates_to_response_body,
    evaluate_entry_zone_gate,
    evaluate_execution_actionable,
    price_in_entry_zone,
    resolve_decision_state,
)
from stocvest.signals.composite_score import CompositeVerdict


def _active_body(*, price: float = 100.0, rr: float = 2.5) -> dict:
    return {
        "status": "active",
        "verdict": "bearish",
        "signal_summary": "Bearish",
        "alignment_ratio": 0.65,
        "signal_score": 80,
        "risk_reward": rr,
        "market_regime": "neutral",
        "last_trade_price": price,
        "historical_entry_zone": {"low": 99.0, "high": 101.0},
        "layers": [
            {"layer": "technical", "score": 0.4},
            {"layer": "sector", "score": 55.0},
        ],
        "market_environment": {
            "environment_tier": "normal",
            "min_rr_swing": 2.0,
            "new_swing_allowed": True,
        },
    }


def test_price_in_entry_zone() -> None:
    assert price_in_entry_zone(100.0, 99.0, 101.0) is True
    assert price_in_entry_zone(98.0, 99.0, 101.0) is False


def test_entry_zone_gate_inside() -> None:
    ok, gate = evaluate_entry_zone_gate(_active_body())
    assert ok is True
    assert gate["pass"] is True


def test_entry_zone_gate_outside() -> None:
    ok, gate = evaluate_entry_zone_gate(_active_body(price=105.0))
    assert ok is False
    assert gate["pass"] is False


def test_execution_actionable_requires_zone_and_ledger() -> None:
    body = _active_body()
    ledger_ok, exec_ok, gates = evaluate_execution_actionable(body, mode="swing")
    assert ledger_ok is True
    assert exec_ok is True
    assert gates["entry_zone"]["pass"] is True

    body_out = _active_body(price=105.0)
    ledger_ok2, exec_ok2, _ = evaluate_execution_actionable(body_out, mode="swing")
    assert ledger_ok2 is True
    assert exec_ok2 is False


def test_apply_entry_gates_sets_decision_state() -> None:
    body = _active_body()
    apply_entry_gates_to_response_body(body, mode="swing")
    assert body["execution_actionable"] is True
    assert body["decision_state"] == "actionable"

    body2 = _active_body(price=105.0)
    apply_entry_gates_to_response_body(body2, mode="swing")
    assert body2["execution_actionable"] is False
    assert body2["decision_state"] == "monitor"


def test_apply_entry_gates_blocked_when_rr_below_threshold() -> None:
    body = _active_body(rr=0.5)
    apply_entry_gates_to_response_body(body, mode="swing")
    assert body["ledger_qualified"] is False
    assert body["execution_actionable"] is False
    assert body["decision_state"] == "blocked"


def test_scenario_payload_maps_strength_and_pattern() -> None:
    from stocvest.api.services.execution_actionable import scenario_payload_from_body

    body = _active_body()
    body["pattern"] = "ema9_bounce volume_expansion"
    body["signal_score"] = 72
    scenario = scenario_payload_from_body(body, mode="swing", symbol="GGAL")
    assert scenario["strength"] == 72
    assert scenario["pattern"] == "ema9_bounce volume_expansion"
    assert scenario["entry_zone_low"] == 99.0
    assert scenario["entry_zone_high"] == 101.0


def test_resolve_decision_state_blocked_when_ledger_fails() -> None:
    body = _active_body(rr=0.5)
    ledger_ok, exec_ok, _ = evaluate_execution_actionable(body, mode="swing")
    assert ledger_ok is False
    assert exec_ok is False
    assert (
        resolve_decision_state(
            body,
            execution_actionable=exec_ok,
            ledger_qualified=ledger_ok,
            verdict=CompositeVerdict.BEARISH,
        )
        == "blocked"
    )
