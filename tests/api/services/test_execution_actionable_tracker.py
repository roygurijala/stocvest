"""Tradable desk transition tracking + email fan-out."""

from __future__ import annotations

from unittest.mock import patch

from stocvest.api.services.execution_actionable_tracker import process_composite_body


def test_ledger_qualified_transition_notifies_when_execution_false() -> None:
    body = {
        "ledger_qualified": True,
        "execution_actionable": False,
        "signal_summary": "bullish",
        "signal_score": 0.78,
    }
    with (
        patch(
            "stocvest.api.services.execution_actionable_tracker.read_execution_actionable_state",
            return_value=False,
        ),
        patch(
            "stocvest.api.services.execution_actionable_tracker.read_ledger_qualified_state",
            return_value=False,
        ),
        patch("stocvest.api.services.execution_actionable_tracker.write_execution_actionable_state"),
        patch("stocvest.api.services.execution_actionable_tracker.write_ledger_qualified_state"),
        patch(
            "stocvest.api.services.execution_actionable_tracker.apply_entry_gates_to_response_body",
            side_effect=lambda b, **_: b,
        ),
        patch(
            "stocvest.api.services.execution_actionable_tracker._notify_tradable_desk_transition",
        ) as notify,
    ):
        out = process_composite_body(body, mode="day", symbol="NVDA", notify=True)

    assert out["ledger_transitioned"] is True
    assert out["execution_transitioned"] is False
    notify.assert_called_once()
    assert notify.call_args.kwargs["ledger_qualified_only"] is True


def test_execution_transition_prefers_execution_email() -> None:
    body = {
        "ledger_qualified": True,
        "execution_actionable": True,
        "signal_summary": "bullish",
        "signal_score": 0.82,
    }
    with (
        patch(
            "stocvest.api.services.execution_actionable_tracker.read_execution_actionable_state",
            return_value=False,
        ),
        patch(
            "stocvest.api.services.execution_actionable_tracker.read_ledger_qualified_state",
            return_value=False,
        ),
        patch("stocvest.api.services.execution_actionable_tracker.write_execution_actionable_state"),
        patch("stocvest.api.services.execution_actionable_tracker.write_ledger_qualified_state"),
        patch(
            "stocvest.api.services.execution_actionable_tracker.apply_entry_gates_to_response_body",
            side_effect=lambda b, **_: b,
        ),
        patch(
            "stocvest.api.services.execution_actionable_tracker._notify_tradable_desk_transition",
        ) as notify,
    ):
        out = process_composite_body(body, mode="swing", symbol="AMD", notify=True)

    assert out["execution_transitioned"] is True
    notify.assert_called_once()
    assert notify.call_args.kwargs["ledger_qualified_only"] is False
