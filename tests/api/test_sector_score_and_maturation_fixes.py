"""Regression tests for sector gate scale, maturation actionable alignment, and gate audit."""

from __future__ import annotations

import json

from stocvest.api.services.signal_backtest_capture import (
    decision_state_from_gate_blob,
    infer_decision_state_entry,
)
from stocvest.api.services.signal_validation_eligibility import (
    evaluate_swing_ledger_entry,
    sector_analyzer_score_from_body,
    sector_analyzer_score_from_layers,
)
from stocvest.data.models import SignalRecord
from stocvest.models.watchlist import WatchlistState, derive_maturation_state, derive_progress_band
from stocvest.signals.composite_score import CompositeVerdict


def test_sector_analyzer_score_from_layers_rejects_composite_scale() -> None:
    layers = [{"layer": "sector", "score": -0.6, "verdict": "bearish", "status": "available"}]
    assert sector_analyzer_score_from_layers(layers) is None


def test_sector_analyzer_score_from_layers_accepts_analyzer_scale() -> None:
    layers = [{"layer": "sector", "score": 62, "verdict": "neutral", "status": "available"}]
    assert sector_analyzer_score_from_layers(layers) == 62.0


def test_sector_gate_rejects_composite_scale_sector_layer_score() -> None:
    ok, gates = evaluate_swing_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=0.5,
        alignment_ratio=0.6,
        macro_market_regime="bull",
        risk_reward=2.5,
        layer_scores={"sector": -0.6},
        sector_layer_score=-0.6,
    )
    assert gates["sector_gate"].get("reason") == "sector_unavailable"
    assert gates["sector_gate"]["pass"] is True


def test_derive_maturation_state_caps_actionable_without_decision() -> None:
    state = derive_maturation_state(5, None, composite_decision_state="monitor")
    assert state == WatchlistState.DEVELOPING


def test_derive_maturation_state_actionable_when_decision_matches() -> None:
    state = derive_maturation_state(5, None, composite_decision_state="actionable")
    assert state == WatchlistState.ACTIONABLE


def test_progress_band_not_actionable_when_state_developing_with_five_layers() -> None:
    assert (
        derive_progress_band(5, state=WatchlistState.DEVELOPING) == "developing"
    )


def test_decision_state_entry_uses_gate_blob_for_shadow_row() -> None:
    blob = json.dumps({"gates": {"decision_state": {"pass": True, "value": "actionable"}}})
    rec = SignalRecord(
        signal_id="s1",
        symbol="AAPL",
        direction="bullish",
        signal_strength=70,
        pattern="swing_composite:ledger_capture_shadow",
        layer_scores={},
        price_at_signal=100.0,
        generated_at=__import__("datetime").datetime(2026, 6, 9, tzinfo=__import__("datetime").timezone.utc),
        ledger_qualified=False,
        gate_status_json=blob,
    )
    assert infer_decision_state_entry(rec, eligible=False) == "actionable"
    assert decision_state_from_gate_blob(blob) == "actionable"
