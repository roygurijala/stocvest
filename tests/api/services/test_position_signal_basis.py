"""Honest Long Term basis label + structure-broken flag (A1/A2 copy fixes)."""

from __future__ import annotations

import pytest

from stocvest.api.services.position_composite_engine import resolve_position_signal_basis

pytestmark = pytest.mark.unit


def test_bearish_technical_marks_structure_broken() -> None:
    label, broken = resolve_position_signal_basis(True, "bearish")
    assert broken is True
    assert "broken" in label.lower()
    assert "fundamentals-led" in label.lower()
    # Must NOT claim a confirmed structural uptrend.
    assert "derived from weekly structural trend +" not in label.lower()


def test_neutral_technical_is_mixed_not_broken() -> None:
    label, broken = resolve_position_signal_basis(True, "neutral")
    assert broken is False
    assert "mixed" in label.lower()


def test_bullish_technical_keeps_structural_trend_label() -> None:
    label, broken = resolve_position_signal_basis(True, "bullish")
    assert broken is False
    assert label == "Derived from weekly structural trend + fundamentals."


def test_unavailable_technical_is_fundamentals_led() -> None:
    label, broken = resolve_position_signal_basis(False, "bearish")
    assert broken is False  # can't call structure broken without a trend read
    assert "unavailable" in label.lower()
