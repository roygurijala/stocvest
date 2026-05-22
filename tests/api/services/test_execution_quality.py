"""Tests for soft execution-quality payload builder."""

from __future__ import annotations

from datetime import datetime, timezone

from stocvest.api.services.execution_quality import build_execution_quality_payload


def test_build_execution_quality_strong_band() -> None:
    ref = datetime(2026, 5, 19, 19, 55, tzinfo=timezone.utc)  # 3:55 PM ET (EDT)
    payload = build_execution_quality_payload(
        mode="day",
        price_at_signal=100.0,
        reference_stop_level=98.5,
        reference_target_1=103.0,
        risk_reward=2.3,
        atr=1.0,
        volume_ratio=1.2,
        orb_signal="breakout",
        vwap_state="available",
        ref_utc=ref,
    )
    assert payload["band"] == "strong"
    assert payload["stop_atr_ratio"] == 1.5
    assert payload["level_path"]["structure_complete"] is True
    assert payload["session_window"]["in_day_ledger_window"] is True


def test_build_execution_quality_unavailable_without_levels() -> None:
    payload = build_execution_quality_payload(
        mode="swing",
        price_at_signal=50.0,
        reference_stop_level=None,
        reference_target_1=None,
        risk_reward=None,
        atr=None,
        volume_ratio=None,
    )
    assert payload["band"] == "unavailable"
    assert payload["level_path"]["structure_complete"] is False
