"""F2 growth pillar tests."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.f2_growth import score_f2_growth
from tests.signals.position_fundamentals.conftest import quality_snapshot, weak_growth_snapshot


@pytest.mark.unit
class TestF2Growth:
    def test_unavailable_with_one_quarter(self) -> None:
        snap = PositionFundamentalsSnapshot(symbol="X", configured=True)
        assert score_f2_growth(snap).status == "unavailable"

    def test_strong_revenue_growth_bullish(self) -> None:
        result = score_f2_growth(quality_snapshot())
        assert result.score is not None
        assert result.score >= 62
        assert result.verdict == "bullish"

    def test_declining_revenue_bearish(self) -> None:
        result = score_f2_growth(weak_growth_snapshot())
        assert result.score is not None
        assert result.score <= 45

    def test_guidance_raised_bonus(self) -> None:
        base = score_f2_growth(quality_snapshot(), guidance_direction="unknown").score
        raised = score_f2_growth(quality_snapshot(), guidance_direction="raised").score
        assert raised is not None and base is not None
        assert raised >= base

    def test_guidance_lowered_penalty(self) -> None:
        result = score_f2_growth(quality_snapshot(), guidance_direction="lowered")
        assert any("Guidance lowered" in c for c in result.chips)

    def test_three_year_cagr_when_enough_history(self) -> None:
        result = score_f2_growth(quality_snapshot())
        assert any("3Y revenue CAGR" in c for c in result.chips)
