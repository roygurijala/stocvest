"""Unit tests for the News relevance × impact × age weighting math."""

from __future__ import annotations

import pytest

from stocvest.signals.news_impact import (
    CONFIDENCE_K,
    IMPACT_FLOOR,
    RELEVANCE_FLOOR,
    apply_confidence_shrink,
    confidence_from_weight,
    heuristic_impact,
    heuristic_relevance,
    resolve_relevance_impact,
)

pytestmark = pytest.mark.unit


def test_heuristic_impact_rewards_hard_catalyst_over_generic() -> None:
    hard = heuristic_impact("Company reports Q3 earnings beat", "tops estimates")
    soft = heuristic_impact("Is this stock a buy for the next decade?", "long-term musings")
    assert hard > soft
    assert soft == pytest.approx(IMPACT_FLOOR)
    assert 0.0 <= soft <= hard <= 1.0


def test_heuristic_relevance_rewards_credible_source() -> None:
    top = heuristic_relevance("Reuters")
    unknown = heuristic_relevance("Some Random Stock Blog")
    assert top > unknown
    assert unknown == pytest.approx(RELEVANCE_FLOOR)
    assert top == pytest.approx(1.0)


def test_resolve_prefers_claude_when_both_present() -> None:
    art = {"title": "x", "claude_relevance": 0.9, "claude_impact": 0.8, "publisher": {"name": "blog"}}
    rel, imp, source = resolve_relevance_impact(art, "AAPL")
    assert source == "claude"
    assert rel == pytest.approx(0.9)
    assert imp == pytest.approx(0.8)


def test_resolve_falls_back_to_heuristic_when_claude_partial() -> None:
    # Only one of the two Claude values present → not trusted; use heuristic for both.
    art = {"title": "earnings beat", "description": "", "claude_relevance": 0.9, "publisher": {"name": "Reuters"}}
    rel, imp, source = resolve_relevance_impact(art, "AAPL")
    assert source == "heuristic"
    assert rel == pytest.approx(heuristic_relevance("Reuters"))


def test_resolve_clamps_out_of_range_claude_values() -> None:
    art = {"claude_relevance": 5.0, "claude_impact": -2.0}
    rel, imp, source = resolve_relevance_impact(art, "AAPL")
    assert source == "claude"
    assert rel == 1.0
    assert imp == 0.0


def test_confidence_saturates_at_k() -> None:
    assert confidence_from_weight(0.0) == 0.0
    assert confidence_from_weight(CONFIDENCE_K) == pytest.approx(1.0)
    assert confidence_from_weight(CONFIDENCE_K * 10) == 1.0
    assert 0.0 < confidence_from_weight(CONFIDENCE_K / 2) < 1.0


def test_shrink_pulls_toward_neutral() -> None:
    # Full confidence leaves the score untouched; zero confidence collapses to 50.
    assert apply_confidence_shrink(90, 1.0) == 90
    assert apply_confidence_shrink(90, 0.0) == 50
    assert apply_confidence_shrink(10, 0.0) == 50
    # Partial confidence pulls an extreme score part-way back to neutral.
    half = apply_confidence_shrink(90, 0.5)
    assert 50 < half < 90
