"""F4 valuation pillar + value-trap guard tests."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.f4_valuation import (
    apply_value_trap_guard,
    score_f4_valuation,
)
from stocvest.signals.position_fundamentals.sector_overrides import SectorOverrideFlags
from stocvest.signals.position_fundamentals.types import PositionPillarResult
from tests.signals.position_fundamentals.conftest import quality_snapshot, weak_growth_snapshot


@pytest.mark.unit
class TestF4Valuation:
    def test_unavailable_without_data(self) -> None:
        assert score_f4_valuation(PositionFundamentalsSnapshot(symbol="X", configured=True)).status == "unavailable"

    def test_reasonable_valuation_active(self) -> None:
        result = score_f4_valuation(quality_snapshot(), f2_verdict="bullish", f2_score=70)
        assert result.status == "active"
        assert result.score is not None

    def test_value_trap_guard_caps_bullish(self) -> None:
        raw = score_f4_valuation(
            weak_growth_snapshot(),
            f2_verdict="bearish",
            f2_score=35,
        )
        assert raw.score is not None
        assert raw.score <= 55
        assert raw.verdict != "bullish"
        assert any("Value-trap guard" in c for c in raw.chips)

    def test_value_trap_guard_helper(self) -> None:
        pillar = PositionPillarResult(
            pillar_id="F4",
            label="Valuation",
            weight=15,
            status="active",
            score=75,
            verdict="bullish",
            reasoning="test",
            chips=[],
        )
        guarded = apply_value_trap_guard(
            pillar,
            f2_verdict="bearish",
            f2_score=30,
            pe_ratio=12.0,
        )
        assert guarded.score is not None
        assert guarded.score <= 55
        assert guarded.verdict == "neutral"

    def test_value_trap_not_applied_when_growth_strong(self) -> None:
        pillar = PositionPillarResult(
            pillar_id="F4",
            label="Valuation",
            weight=15,
            status="active",
            score=75,
            verdict="bullish",
            reasoning="test",
            chips=[],
        )
        guarded = apply_value_trap_guard(
            pillar,
            f2_verdict="bullish",
            f2_score=70,
            pe_ratio=12.0,
        )
        assert guarded.score == 75
        assert guarded.verdict == "bullish"

    def test_biotech_de_weights_valuation(self) -> None:
        result = score_f4_valuation(
            quality_snapshot(),
            sector_flags=SectorOverrideFlags(de_weight_valuation=True),
            f2_verdict="bullish",
            f2_score=70,
        )
        assert any("de-weighted" in c for c in result.chips)
