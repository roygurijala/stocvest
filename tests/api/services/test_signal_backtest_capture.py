from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import patch

from stocvest.api.services.ledger_gate_attempt import persist_ledger_gate_attempt
from stocvest.api.services.signal_backtest_capture import (
    enrich_record_for_backtest,
    infer_decision_state_entry,
    platform_mirror_signal_id,
)
from stocvest.api.services.signal_recorder import InMemorySignalRecorder, reset_signal_recorder_for_tests
from stocvest.data.models import SignalRecord


def _record(*, eligible: bool) -> SignalRecord:
    blob = json.dumps(
        {
            "qualified": eligible,
            "gates": {},
            "market_environment_audit": {
                "environment_tier": "elevated",
                "vix_level": 24.0,
                "vix_change_pct": 2.0,
            },
        }
    )
    return SignalRecord(
        signal_id="abc-123",
        symbol="AAPL",
        direction="bullish" if eligible else "bearish",
        signal_strength=80,
        pattern="real_composite",
        layer_scores={},
        price_at_signal=100.0,
        generated_at=datetime(2026, 5, 10, tzinfo=timezone.utc),
        user_id="user-1",
        mode="day",
        ledger_qualified=eligible,
        gate_status_json=blob,
    )


def test_infer_decision_shadow_blocked() -> None:
    rec = _record(eligible=False).model_copy(
        update={"pattern": "orb:ledger_capture_shadow", "ledger_qualified": False}
    )
    assert infer_decision_state_entry(rec) == "blocked"


def test_enrich_sets_capture_kind() -> None:
    rec = enrich_record_for_backtest(_record(eligible=True), eligible=True)
    assert rec.capture_kind == "qualified"
    assert rec.decision_state_entry == "actionable"


def test_persist_writes_platform_mirror() -> None:
    reset_signal_recorder_for_tests()
    store = InMemorySignalRecorder()
    rec = enrich_record_for_backtest(_record(eligible=True), eligible=True)
    with patch("stocvest.api.services.ledger_gate_attempt.get_signal_recorder", return_value=store):
        with patch("stocvest.api.services.signal_recorder.get_signal_recorder", return_value=store):
            persist_ledger_gate_attempt(rec, ledger_capture=True, mode="day")
    mirror_id = platform_mirror_signal_id("abc-123")
    assert store.get_signal_record_raw(mirror_id) is not None
    mirror = store.get_signal_record_raw(mirror_id)
    assert mirror is not None
    assert mirror.user_id is None
    assert mirror.source_signal_id == "abc-123"
