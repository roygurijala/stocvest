"""Quality names sold with a hostile tape — observational gate (no new floors)."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest

from stocvest.signals.position_copy_guard import position_copy_is_clean
from stocvest.signals.position_gem_gates import extract_candidate_features
from stocvest.signals.position_tape_sold import TAPE_SOLD_WHY, qualifies_tape_sold
from tests.signals.test_position_gem_gates import _gem_body

pytestmark = pytest.mark.unit


def _features(body: dict[str, Any]):
    return extract_candidate_features(body)


def _off_highs_hostile(symbol: str = "RKLB") -> dict[str, Any]:
    """Hygiene + G1/F2 quality, weekly structure intact, off the near-high band, hostile tape."""
    body = deepcopy(_gem_body())
    body["symbol"] = symbol
    body["regime"] = "risk_off"
    body["market_cap"] = 8e9
    tech = body["layers"][1]
    tech["indicator_snapshot"]["pct_from_52w_high"] = -12.0
    return body


def test_tape_sold_why_is_observational() -> None:
    assert "bounce" in TAPE_SOLD_WHY.lower()
    assert "screening only" in TAPE_SOLD_WHY.lower()
    assert position_copy_is_clean(TAPE_SOLD_WHY)


def test_qualifies_when_quality_off_highs_in_hostile_tape() -> None:
    assert qualifies_tape_sold(_features(_off_highs_hostile())) is True


def test_mega_cap_qualifies_via_g1() -> None:
    """Mega-caps are eligible — this is not the gem hunt."""
    body = _off_highs_hostile("AAPL")
    body.pop("market_cap", None)
    assert qualifies_tape_sold(_features(body)) is True


def test_calm_tape_never_qualifies() -> None:
    body = _off_highs_hostile()
    body["regime"] = "sideways"
    assert qualifies_tape_sold(_features(body)) is False


def test_near_high_band_is_not_off_highs() -> None:
    body = _off_highs_hostile()
    body["layers"][1]["indicator_snapshot"]["pct_from_52w_high"] = -4.0
    assert qualifies_tape_sold(_features(body)) is False


def test_sharp_breakdown_is_a_company_break() -> None:
    body = _off_highs_hostile()
    body["layers"][1]["indicator_snapshot"]["pct_from_52w_high"] = -25.0
    assert qualifies_tape_sold(_features(body)) is False


def test_structure_broken_is_not_intact() -> None:
    body = _off_highs_hostile()
    body["signal_structure_broken"] = True
    f = _features(body)
    assert f.structure_broken is True
    assert qualifies_tape_sold(f) is False


def test_below_sma200_without_base_fails() -> None:
    body = _off_highs_hostile()
    body["layers"][1]["chips"] = ["Below W-SMA200"]
    body["layers"][1]["indicator_snapshot"]["in_base"] = False
    assert qualifies_tape_sold(_features(body)) is False


def test_in_base_below_sma200_still_intact() -> None:
    body = _off_highs_hostile()
    body["layers"][1]["chips"] = ["Below W-SMA200"]
    body["layers"][1]["indicator_snapshot"]["in_base"] = True
    assert qualifies_tape_sold(_features(body)) is True


def test_bearish_news_is_name_specific() -> None:
    body = _off_highs_hostile()
    body["layers"].append({"layer": "news", "score": 20, "verdict": "bearish", "status": "available", "chips": []})
    assert qualifies_tape_sold(_features(body)) is False


def test_bearish_geo_is_name_specific() -> None:
    body = _off_highs_hostile()
    body["layers"].append(
        {"layer": "geopolitical", "score": 20, "verdict": "bearish", "status": "available", "chips": []}
    )
    assert qualifies_tape_sold(_features(body)) is False


def test_insufficient_data_never_qualifies() -> None:
    body = _off_highs_hostile()
    body["status"] = "insufficient_data"
    assert qualifies_tape_sold(_features(body)) is False


def test_hygiene_failure_blocks() -> None:
    body = _off_highs_hostile("TQQQ")
    assert qualifies_tape_sold(_features(body)) is False


def test_bearish_technical_verdict_does_not_block_if_structure_intact() -> None:
    """G5 would fail in a crash; tape-sold still uses the intact-structure path."""
    body = _off_highs_hostile()
    body["layers"][1]["verdict"] = "bearish"
    assert qualifies_tape_sold(_features(body)) is True
