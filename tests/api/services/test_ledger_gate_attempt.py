"""Tests for ledger gate attempt persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from stocvest.api.services.ledger_gate_attempt import persist_ledger_gate_attempt
from stocvest.data.models import SignalRecord


def _minimal_record(*, qualified: bool) -> SignalRecord:
    return SignalRecord(
        signal_id="sid-1",
        symbol="AAPL",
        direction="bullish",
        signal_strength=80,
        pattern="real_composite",
        layer_scores={"technical": 0.7},
        price_at_signal=100.0,
        generated_at=datetime.now(timezone.utc),
        user_id="u1",
        mode="day",
        ledger_qualified=qualified,
        ledger_position_open=qualified,
    )


def test_persist_qualified_calls_recorder(monkeypatch: pytest.MonkeyPatch) -> None:
    rec = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.ledger_gate_attempt.get_signal_recorder",
        lambda: rec,
    )
    persist_ledger_gate_attempt(_minimal_record(qualified=True), ledger_capture=True, mode="day")
    rec.record_signal.assert_called_once()
    assert rec.record_signal.call_args[0][0].ledger_qualified is True


def test_persist_shadow_when_ledger_capture(monkeypatch: pytest.MonkeyPatch) -> None:
    rec = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.ledger_gate_attempt.get_signal_recorder",
        lambda: rec,
    )
    persist_ledger_gate_attempt(_minimal_record(qualified=False), ledger_capture=True, mode="swing")
    rec.record_signal.assert_called_once()
    shadow = rec.record_signal.call_args[0][0]
    assert shadow.ledger_qualified is False
    assert shadow.ledger_position_open is False
    assert shadow.pattern.endswith(":ledger_capture_shadow")


def test_persist_skips_shadow_without_ledger_capture(monkeypatch: pytest.MonkeyPatch) -> None:
    rec = MagicMock()
    monkeypatch.setattr(
        "stocvest.api.services.ledger_gate_attempt.get_signal_recorder",
        lambda: rec,
    )
    persist_ledger_gate_attempt(_minimal_record(qualified=False), ledger_capture=False, mode="day")
    rec.record_signal.assert_not_called()
