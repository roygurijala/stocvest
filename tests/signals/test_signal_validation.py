from __future__ import annotations

from stocvest.api.services.swing_composite_evidence import is_signal_complete


def test_incomplete_signal_not_stored_as_active() -> None:
    ok, missing = is_signal_complete({"historical_entry_zone": None, "reference_stop_level": None, "reference_target_1": None, "vwap": None})
    assert ok is False
    assert "entry_zone" in missing


def test_signal_missing_stop_level_marked_incomplete() -> None:
    ok, missing = is_signal_complete({"historical_entry_zone": {"low": 1, "high": 2}, "reference_stop_level": None, "reference_target_1": 3, "vwap": 1.5})
    assert ok is False
    assert missing == ["stop_level"]


def test_vwap_computed_from_bars_when_missing() -> None:
    from stocvest.api.services.swing_composite_evidence import _intraday_vwap_from_payload_bars

    vwap = _intraday_vwap_from_payload_bars(
        {"intraday_bars": [{"high": 11.0, "low": 9.0, "close": 10.0, "volume": 100.0}]}
    )
    assert vwap == 10.0


def test_complete_signal_passes_validation() -> None:
    ok, missing = is_signal_complete(
        {"historical_entry_zone": {"low": 1, "high": 2}, "reference_stop_level": 0.9, "reference_target_1": 2.2, "vwap": 1.4}
    )
    assert ok is True
    assert missing == []
