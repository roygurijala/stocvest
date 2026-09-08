"""F1 profitability pillar tests."""

from __future__ import annotations

from datetime import date

import pytest

from stocvest.data.fundamentals_models import FinancialRatios, IncomeStatement, PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.f1_profitability import score_f1_profitability
from stocvest.signals.position_fundamentals.sector_overrides import SectorOverrideFlags
from tests.signals.position_fundamentals.conftest import quality_snapshot


@pytest.mark.unit
class TestF1Profitability:
    def test_unavailable_without_data(self) -> None:
        snap = PositionFundamentalsSnapshot(symbol="X", configured=True)
        result = score_f1_profitability(snap)
        assert result.status == "unavailable"
        assert result.score is None

    def test_strong_profitability_scores_bullish(self) -> None:
        result = score_f1_profitability(quality_snapshot())
        assert result.status == "active"
        assert result.score is not None
        assert result.score >= 62
        assert result.verdict == "bullish"

    def test_negative_fcf_penalizes(self) -> None:
        snap = quality_snapshot()
        snap.cash_flows[0] = snap.cash_flows[0].model_copy(update={"free_cash_flow": -1e9})
        result = score_f1_profitability(snap)
        assert any("Negative free cash flow" in c for c in result.chips)

    def test_banks_use_roa_flag(self) -> None:
        snap = quality_snapshot("JPM")
        flags = SectorOverrideFlags(use_roa_not_roic=True)
        result = score_f1_profitability(snap, sector_flags=flags)
        assert result.status == "active"
        assert any("ROA" in c for c in result.chips)

    def test_low_roe_scores_lower(self) -> None:
        snap = PositionFundamentalsSnapshot(
            symbol="WEAK",
            configured=True,
            ratios=[
                FinancialRatios(
                    symbol="WEAK",
                    as_of_date=date(2025, 3, 31),
                    return_on_equity=0.03,
                    net_profit_margin=0.04,
                )
            ],
            income_statements=[
                IncomeStatement(symbol="WEAK", as_of_date=date(2025, 3, 31), revenue=1.0)
            ],
        )
        result = score_f1_profitability(snap)
        assert result.score is not None
        assert result.score < 50
