from __future__ import annotations

from datetime import date

import json

from scripts.ledger_signal_report import (
    DeskTally,
    _describe_gate_failure,
    _failed_gates_from_item,
    _is_ledger_row,
    _period_window,
    _primary_gate_failure,
)


def test_period_window_daily() -> None:
    start, end, label = _period_window("daily", date(2026, 6, 9))
    assert start == end == date(2026, 6, 9)
    assert "2026-06-09" in label


def test_period_window_weekly() -> None:
    start, end, _ = _period_window("weekly", date(2026, 6, 9))
    assert end == date(2026, 6, 9)
    assert (end - start).days == 6


def test_period_window_monthly() -> None:
    start, end, _ = _period_window("monthly", date(2026, 6, 15))
    assert start == date(2026, 6, 1)
    assert end == date(2026, 6, 30)


def test_is_ledger_row_shadow_pattern() -> None:
    assert _is_ledger_row({"pattern": "swing_composite:ledger_capture_shadow"})


def test_is_ledger_row_qualified() -> None:
    assert _is_ledger_row({"ledger_qualified": True, "pattern": "swing_composite"})


def test_describe_decision_state_failure() -> None:
    desc = _describe_gate_failure(
        "decision_state",
        {"pass": False, "value": "monitor", "need": "actionable"},
    )
    assert desc is not None
    assert "monitor" in desc
    assert "actionable" in desc


def test_describe_risk_reward_failure() -> None:
    desc = _describe_gate_failure(
        "risk_reward",
        {"pass": False, "value": 1.1, "min": 1.3},
    )
    assert desc is not None
    assert "1.1" in desc
    assert "1.3" in desc


def test_failed_gates_from_shadow_row() -> None:
    blob = {
        "qualified": False,
        "gates": {
            "decision_state": {"pass": False, "value": "blocked", "need": "actionable"},
            "decision_score": {"pass": False, "value": 65, "min": 72},
        },
        "evaluation_source": "ledger_capture",
    }
    item = {
        "ledger_qualified": False,
        "gate_status_json": json.dumps(blob),
    }
    failed = _failed_gates_from_item(item)
    assert "decision_state" in failed
    assert "decision_score" in failed
    primary = _primary_gate_failure(failed)
    assert primary is not None
    assert "Decision state" in primary


def test_desk_tally_accumulates_gate_failures() -> None:
    blob = {
        "qualified": False,
        "gates": {
            "decision_state": {"pass": False, "value": "monitor", "need": "actionable"},
        },
    }
    st = DeskTally()
    st.add(
        {
            "symbol": "AAPL",
            "ledger_qualified": False,
            "gate_status_json": json.dumps(blob),
        }
    )
    assert st.shadow == 1
    assert st.shadow_with_gate_detail == 1
    assert st.failed_gate_counts["decision_state"] == 1
    assert st.symbol_primary_blocker["AAPL"]
