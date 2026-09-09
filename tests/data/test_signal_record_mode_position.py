"""SignalRecord.mode gains 'position' (ADR-004 POS-D9 ledger foundation)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.data.models import SignalRecord, _coerce_signal_mode

pytestmark = pytest.mark.unit


def _rec(mode: str) -> SignalRecord:
    return SignalRecord(
        signal_id="s1",
        symbol="AAPL",
        direction="bullish",
        signal_strength=80,
        pattern="position_composite",
        price_at_signal=100.0,
        generated_at=datetime.now(timezone.utc),
        mode=mode,  # type: ignore[arg-type]
    )


def test_position_is_a_valid_mode() -> None:
    assert _rec("position").mode == "position"


def test_coerce_handles_mixed_case_for_dynamo_hydration() -> None:
    # Direct construction takes lowercase (Literal); Dynamo hydration coerces casing.
    assert _coerce_signal_mode("POSITION") == "position"
    assert _coerce_signal_mode("Swing") == "swing"


def test_invalid_mode_rejected() -> None:
    with pytest.raises(ValueError):
        _rec("weekly")


def test_default_mode_is_day() -> None:
    rec = SignalRecord(
        signal_id="s2",
        symbol="MSFT",
        direction="bearish",
        signal_strength=40,
        price_at_signal=10.0,
        generated_at=datetime.now(timezone.utc),
    )
    assert rec.mode == "day"


def test_coerce_signal_mode_maps_all_three() -> None:
    assert _coerce_signal_mode("position") == "position"
    assert _coerce_signal_mode("swing") == "swing"
    assert _coerce_signal_mode("day") == "day"
    assert _coerce_signal_mode(None) == "day"
    assert _coerce_signal_mode("garbage") == "day"


def test_from_dynamo_item_hydrates_position_mode() -> None:
    rec = SignalRecord.from_dynamo_item(
        {
            "signal_id": "s3",
            "symbol": "NVDA",
            "direction": "bullish",
            "signal_strength": 90,
            "price_at_signal": 500.0,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "mode": "position",
        }
    )
    assert rec.mode == "position"
