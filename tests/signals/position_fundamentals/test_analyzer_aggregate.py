"""Position fundamentals analyzer aggregate tests."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.types import PositionPillarResult
from stocvest.signals.position_fundamentals_analyzer import (
    PositionFundamentalsAnalyzer,
    PositionFundamentalsContext,
    aggregate_pillar_scores,
    weakest_pillar,
)
from tests.signals.position_fundamentals.conftest import levered_snapshot, quality_snapshot


@pytest.mark.unit
class TestAggregateHelpers:
    def test_aggregate_renormalizes_weights(self) -> None:
        pillars = [
            PositionPillarResult("F1", "a", 20, "active", 80, "bullish", "", []),
            PositionPillarResult("F2", "b", 20, "unavailable", None, "neutral", "", []),
        ]
        score, verdict = aggregate_pillar_scores(pillars)
        assert score == 80
        assert verdict == "bullish"

    def test_aggregate_unavailable_when_no_scores(self) -> None:
        pillars = [
            PositionPillarResult("F1", "a", 20, "unavailable", None, "neutral", "", []),
        ]
        score, verdict = aggregate_pillar_scores(pillars)
        assert score is None
        assert verdict == "neutral"

    def test_weakest_pillar(self) -> None:
        pillars = [
            PositionPillarResult("F1", "a", 20, "active", 80, "bullish", "", []),
            PositionPillarResult("F3", "c", 20, "active", 40, "neutral", "", []),
        ]
        assert weakest_pillar(pillars) == "F3"


@pytest.mark.unit
class TestPositionFundamentalsAnalyzer:
    def test_not_configured_unavailable(self) -> None:
        result = PositionFundamentalsAnalyzer().analyze(
            PositionFundamentalsSnapshot(symbol="AAPL", configured=False)
        )
        assert result.status == "unavailable"
        assert result.score is None

    def test_quality_snapshot_active_layer(self) -> None:
        result = PositionFundamentalsAnalyzer().analyze(
            quality_snapshot(),
            context=PositionFundamentalsContext(
                guidance_direction="raised",
                earnings_trend="beating",
                quarters_beating=4,
            ),
        )
        assert result.status == "active"
        assert result.score is not None
        assert result.score >= 60
        assert len(result.pillars) == 5
        assert result.weakest_pillar_id is not None
        assert result.to_api_dict()["pillars"]

    def test_degraded_when_pillar_missing(self) -> None:
        snap = quality_snapshot()
        snap.income_statements = []
        result = PositionFundamentalsAnalyzer().analyze(snap)
        assert result.status == "degraded"
        assert result.score is not None

    def test_levered_snapshot_not_bullish_layer(self) -> None:
        result = PositionFundamentalsAnalyzer().analyze(
            levered_snapshot(),
            context=PositionFundamentalsContext(quarters_missing=3, earnings_trend="missing"),
        )
        assert result.score is not None
        assert result.score < 62

    def test_f4_runs_after_f2_for_value_trap(self) -> None:
        result = PositionFundamentalsAnalyzer().analyze(
            levered_snapshot(),
            context=PositionFundamentalsContext(quarters_missing=4, earnings_trend="missing"),
        )
        f4 = next(p for p in result.pillars if p.pillar_id == "F4")
        assert f4.verdict != "bullish" or not any("Value-trap" in c for c in f4.chips)

    def test_api_dict_includes_all_pillar_ids(self) -> None:
        result = PositionFundamentalsAnalyzer().analyze(quality_snapshot())
        ids = {p["pillar_id"] for p in result.to_api_dict()["pillars"]}
        assert ids == {"F1", "F2", "F3", "F4", "F5"}
