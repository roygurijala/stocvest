"""Tests for soft planning gates payload."""

from datetime import datetime, timezone

from stocvest.api.services.planning_gates import build_planning_gates_payload


def test_planning_gates_all_favorable_swing() -> None:
    payload = build_planning_gates_payload(
        mode="swing",
        market_regime="Bullish",
        risk_reward=2.5,
        execution_quality={
            "volume_ratio": 1.6,
            "volume_band": "strong",
            "stop_atr_ratio": 1.1,
        },
        reference_stop_provenance="Below min(session low, VWAP); widened to 1.0×ATR14 floor",
        atr=4.0,
        setup_judgment={"tradeability": {"band": "moderate"}},
        ref_utc=datetime(2026, 5, 27, 20, 0, tzinfo=timezone.utc),
    )
    assert payload["regime_tag"] == "trending"
    assert payload["all_favorable"] is True
    assert len(payload["checks"]) == 5
    assert payload["risk_cap_pct"]["dip"] == 1.5


def test_day_dip_window_passes_afternoon_et() -> None:
    # 2:30 PM ET = 18:30 UTC (EDT)
    payload = build_planning_gates_payload(
        mode="day",
        market_regime="Neutral",
        risk_reward=1.5,
        execution_quality={"volume_ratio": 0.4, "volume_band": "weak"},
        reference_stop_provenance="structural",
        atr=None,
        setup_judgment=None,
        ref_utc=datetime(2026, 5, 27, 18, 30, tzinfo=timezone.utc),
    )
    time_check = next(c for c in payload["checks"] if c["id"] == "time_window")
    assert time_check["pass"] is True
    assert payload["regime_tag"] == "ranging"
