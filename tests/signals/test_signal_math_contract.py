"""Unit coverage for the Signal Math Contract (central scoring conventions)."""

from __future__ import annotations

import pytest

from stocvest.models.watchlist import MATURATION_LAYER_KEYS
from stocvest.signals import signal_math_contract as smc

pytestmark = pytest.mark.unit


def test_layer_set_matches_watchlist_contract():
    # The canonical six-layer set must never drift from the evidence/watchlist contract.
    assert smc.SIGNAL_LAYERS == tuple(MATURATION_LAYER_KEYS)
    assert smc.SIGNAL_LAYER_COUNT == 6


def test_score_range_anchors():
    assert (smc.LAYER_SCORE_MIN, smc.LAYER_SCORE_NEUTRAL, smc.LAYER_SCORE_MAX) == (0.0, 50.0, 100.0)
    assert (smc.DIRECTIONAL_SCORE_MIN, smc.DIRECTIONAL_SCORE_NEUTRAL, smc.DIRECTIONAL_SCORE_MAX) == (
        -1.0,
        0.0,
        1.0,
    )
    assert (smc.UNIT_MIN, smc.UNIT_MAX) == (0.0, 1.0)


@pytest.mark.parametrize(
    "value,expected",
    [(-5, 0.0), (0, 0.0), (50, 50.0), (100, 100.0), (140, 100.0)],
)
def test_clamp_layer_score(value, expected):
    assert smc.clamp_layer_score(value) == expected


@pytest.mark.parametrize("value,expected", [(-3, -1.0), (-1, -1.0), (0, 0.0), (1, 1.0), (4, 1.0)])
def test_clamp_directional_score(value, expected):
    assert smc.clamp_directional_score(value) == expected


@pytest.mark.parametrize("value,expected", [(-1, 0.0), (0, 0.0), (0.5, 0.5), (1, 1.0), (2, 1.0)])
def test_clamp_unit(value, expected):
    assert smc.clamp_unit(value) == expected


def test_layer_score_direction_neutral_is_zero():
    # Exactly 50 must not lean bearish (the bug this contract fixes).
    assert smc.layer_score_direction(50) == 0
    assert smc.layer_score_direction(50.000001) == 1
    assert smc.layer_score_direction(49.999999) == -1
    assert smc.layer_score_direction(80) == 1
    assert smc.layer_score_direction(20) == -1


def test_directional_sign_and_verdict():
    assert smc.directional_sign(0.0) == 0
    assert smc.directional_sign(0.01) == 1
    assert smc.directional_sign(-0.01) == -1
    assert smc.directional_verdict(0.25) == "bullish"
    assert smc.directional_verdict(-0.25) == "bearish"
    assert smc.directional_verdict(0.1) == "neutral"
    assert smc.directional_verdict(0.2) == "bullish"  # threshold is inclusive


@pytest.mark.parametrize(
    "ratio,expected",
    [(-0.5, 0), (0.0, 0), (0.5, 3), (0.6, 4), (0.84, 5), (1.0, 6), (1.5, 6)],
)
def test_ratio_to_layer_count(ratio, expected):
    assert smc.ratio_to_layer_count(ratio) == expected


def test_normalize_to_unit():
    assert smc.normalize_to_unit(5, 10) == 0.5
    assert smc.normalize_to_unit(-5, 10) == 0.5  # magnitude only
    assert smc.normalize_to_unit(20, 10) == 1.0  # clamped
    assert smc.normalize_to_unit(5, 0) == 0.0  # non-positive scale
    assert smc.normalize_to_unit(5, -1) == 0.0


def test_scale_conversions_round_trip_at_anchors():
    assert smc.layer_score_to_directional(50) == 0.0
    assert smc.layer_score_to_directional(100) == 1.0
    assert smc.layer_score_to_directional(0) == -1.0
    assert smc.directional_to_layer_score(0.0) == 50.0
    assert smc.directional_to_layer_score(1.0) == 100.0
    assert smc.directional_to_layer_score(-1.0) == 0.0
