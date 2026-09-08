"""Common pillar math helpers."""

from __future__ import annotations

import pytest

from stocvest.signals.position_fundamentals.common import (
    cagr,
    finalize_pillar_score,
    median_value,
    pillar_data_quality,
    quarter_offset_value,
    score_to_verdict,
    yoy_ratio,
)
from stocvest.data.fundamentals_models import IncomeStatement
from datetime import date


@pytest.mark.unit
class TestCommonHelpers:
    def test_yoy_ratio(self) -> None:
        assert yoy_ratio(110.0, 100.0) == pytest.approx(0.10)
        assert yoy_ratio(100.0, 0.0) is None
        assert yoy_ratio(10.0, -5.0) is None

    def test_cagr(self) -> None:
        assert cagr(100.0, 133.1, 3) == pytest.approx(0.10, rel=1e-3)

    def test_score_to_verdict_thresholds(self) -> None:
        assert score_to_verdict(70) == "bullish"
        assert score_to_verdict(50) == "neutral"
        assert score_to_verdict(30) == "bearish"

    def test_finalize_pillar_score_clamps(self) -> None:
        score, verdict = finalize_pillar_score(150)
        assert score == 100
        assert verdict == "bullish"

    def test_quarter_offset_value(self) -> None:
        rows = [
            IncomeStatement(symbol="A", as_of_date=date(2025, 3, 31), revenue=100.0),
            IncomeStatement(symbol="A", as_of_date=date(2024, 12, 31), revenue=90.0),
            IncomeStatement(symbol="A", as_of_date=date(2024, 9, 30), revenue=80.0),
            IncomeStatement(symbol="A", as_of_date=date(2024, 6, 30), revenue=70.0),
            IncomeStatement(symbol="A", as_of_date=date(2024, 3, 31), revenue=60.0),
        ]
        latest, prior = quarter_offset_value(rows, lambda r: r.revenue)
        assert latest == 100.0
        assert prior == 60.0

    def test_median_value(self) -> None:
        assert median_value([1, 3, 9]) == 3.0
        assert median_value([]) is None

    def test_pillar_data_quality(self) -> None:
        assert pillar_data_quality(8) == "high"
        assert pillar_data_quality(4) == "medium"
        assert pillar_data_quality(1) == "low"
        assert pillar_data_quality(0) == "unavailable"
