"""F5 earnings quality pillar tests."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.f5_earnings_quality import score_f5_earnings_quality
from tests.signals.position_fundamentals.conftest import quality_snapshot


@pytest.mark.unit
class TestF5EarningsQuality:
    def test_unavailable_without_cash_flow(self) -> None:
        snap = PositionFundamentalsSnapshot(
            symbol="X",
            configured=True,
            income_statements=quality_snapshot().income_statements[:4],
        )
        assert score_f5_earnings_quality(snap).status == "unavailable"

    def test_beat_streak_bonus(self) -> None:
        result = score_f5_earnings_quality(
            quality_snapshot(),
            quarters_beating=4,
            quarters_missing=0,
            earnings_trend="beating",
        )
        assert result.score is not None
        assert result.score >= 62
        assert any("Beat streak" in c for c in result.chips)

    def test_miss_streak_penalty(self) -> None:
        result = score_f5_earnings_quality(
            quality_snapshot(),
            quarters_beating=0,
            quarters_missing=4,
            earnings_trend="missing",
        )
        assert result.score is not None
        assert result.score <= 40

    def test_high_accruals_penalty(self) -> None:
        snap = quality_snapshot()
        snap.cash_flows[0] = snap.cash_flows[0].model_copy(update={"operating_cash_flow": 1e9})
        snap.income_statements[0] = snap.income_statements[0].model_copy(update={"net_income": 20e9})
        result = score_f5_earnings_quality(snap)
        assert any("accruals" in c.lower() for c in result.chips)

    def test_eps_lagging_revenue(self) -> None:
        snap = quality_snapshot()
        snap.income_statements[0] = snap.income_statements[0].model_copy(
            update={"revenue": 120e9, "eps_diluted": 1.0, "eps": 1.0}
        )
        snap.income_statements[4] = snap.income_statements[4].model_copy(
            update={"revenue": 100e9, "eps_diluted": 2.0, "eps": 2.0}
        )
        result = score_f5_earnings_quality(snap)
        assert any("EPS lagging" in c for c in result.chips)
