"""F3 balance sheet pillar tests."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.f3_balance_sheet import score_f3_balance_sheet
from tests.signals.position_fundamentals.conftest import levered_snapshot, quality_snapshot


@pytest.mark.unit
class TestF3BalanceSheet:
    def test_unavailable_without_data(self) -> None:
        assert score_f3_balance_sheet(PositionFundamentalsSnapshot(symbol="X", configured=True)).status == "unavailable"

    def test_healthy_balance_sheet_bullish(self) -> None:
        result = score_f3_balance_sheet(quality_snapshot())
        assert result.score is not None
        assert result.score >= 60

    def test_low_coverage_red_flag(self) -> None:
        result = score_f3_balance_sheet(levered_snapshot())
        assert any("Interest coverage below" in c for c in result.chips)
        assert result.verdict != "bullish"

    def test_high_leverage_chip(self) -> None:
        result = score_f3_balance_sheet(levered_snapshot())
        assert any("Elevated leverage" in c for c in result.chips)

    def test_cash_covers_short_term_debt(self) -> None:
        result = score_f3_balance_sheet(quality_snapshot())
        assert any("Cash covers" in c for c in result.chips)
