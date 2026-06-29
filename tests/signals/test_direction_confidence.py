"""Unit tests for B79 direction confidence (pure presentation over the composite engine)."""

import pytest

from stocvest.signals.direction_confidence import assess_direction_confidence

pytestmark = pytest.mark.unit


def test_high_requires_all_three_dimensions():
    dc = assess_direction_confidence(score=0.42, confidence=0.7, alignment_ratio=0.8, is_neutral=False)
    assert dc.tier == "High"
    assert 0 <= dc.score <= 100
    assert dc.reason


def test_neutral_is_always_low():
    dc = assess_direction_confidence(score=0.5, confidence=0.9, alignment_ratio=1.0, is_neutral=True)
    assert dc.tier == "Low"
    assert "neutral" in dc.reason.lower()


def test_thin_conviction_drops_to_moderate_and_names_it():
    # Clears Moderate bars (conviction 0.22 >= 0.20) but misses High conviction (0.35).
    dc = assess_direction_confidence(score=0.22, confidence=0.7, alignment_ratio=0.8, is_neutral=False)
    assert dc.tier == "Moderate"
    assert "neutral band" in dc.reason.lower() or "thin" in dc.reason.lower()


def test_layer_disagreement_drops_to_moderate():
    # Strong conviction + data, but agreement between High (0.67) and Moderate (0.50) bars.
    dc = assess_direction_confidence(score=0.5, confidence=0.8, alignment_ratio=0.55, is_neutral=False)
    assert dc.tier == "Moderate"
    assert "disagree" in dc.reason.lower()


def test_low_when_below_moderate_bar():
    # Conviction below the 0.20 moderate floor -> Low regardless of other dims.
    dc = assess_direction_confidence(score=0.1, confidence=0.9, alignment_ratio=0.9, is_neutral=False)
    assert dc.tier == "Low"


def test_low_when_data_quality_thin():
    dc = assess_direction_confidence(score=0.5, confidence=0.2, alignment_ratio=0.9, is_neutral=False)
    assert dc.tier == "Low"
    assert "data" in dc.reason.lower()


@pytest.mark.parametrize("alignment", [-0.5, 0.0, 1.5])
def test_alignment_is_clamped(alignment):
    dc = assess_direction_confidence(score=0.5, confidence=0.8, alignment_ratio=alignment, is_neutral=False)
    assert dc.tier in ("High", "Moderate", "Low")
    assert 0 <= dc.score <= 100


def test_score_is_monotonic_in_conviction():
    low = assess_direction_confidence(score=0.1, confidence=0.6, alignment_ratio=0.6, is_neutral=False)
    high = assess_direction_confidence(score=0.45, confidence=0.6, alignment_ratio=0.6, is_neutral=False)
    assert high.score > low.score


def test_negative_score_is_symmetric():
    bull = assess_direction_confidence(score=0.42, confidence=0.7, alignment_ratio=0.8, is_neutral=False)
    bear = assess_direction_confidence(score=-0.42, confidence=0.7, alignment_ratio=0.8, is_neutral=False)
    assert bull.tier == bear.tier == "High"
    assert bull.score == bear.score
