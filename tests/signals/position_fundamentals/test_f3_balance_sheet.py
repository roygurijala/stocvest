"""F3 balance sheet pillar tests."""

from __future__ import annotations

from datetime import date

import pytest

from stocvest.data.fundamentals_models import (
    BalanceSheet,
    FinancialRatios,
    PositionFundamentalsSnapshot,
)
from stocvest.signals.position_fundamentals.f3_balance_sheet import score_f3_balance_sheet
from stocvest.signals.position_fundamentals.sector_overrides import resolve_sector_override_flags
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

    def test_bank_interest_coverage_is_chip_only(self) -> None:
        snap = PositionFundamentalsSnapshot(
            symbol="JPM",
            configured=True,
            ratios=[
                FinancialRatios(
                    symbol="JPM",
                    as_of_date=date(2026, 6, 30),
                    current_ratio=0.9,
                    interest_coverage=0.8,
                    debt_equity_ratio=3.3,
                )
            ],
        )
        bank = score_f3_balance_sheet(snap, sector_flags=resolve_sector_override_flags("banks"))
        generic = score_f3_balance_sheet(snap)
        assert any("Interest coverage 0.8x — not a solvency metric" in c for c in bank.chips)
        assert not any("Interest coverage below" in c for c in bank.chips)
        assert any("Interest coverage below" in c for c in generic.chips)
        assert bank.score is not None and generic.score is not None
        assert bank.score > generic.score

    def test_bank_cash_vs_st_debt_is_chip_only(self) -> None:
        snap = PositionFundamentalsSnapshot(
            symbol="JPM",
            configured=True,
            ratios=[FinancialRatios(symbol="JPM", as_of_date=date(2026, 6, 30))],
            balance_sheets=[
                BalanceSheet(
                    symbol="JPM",
                    as_of_date=date(2026, 6, 30),
                    cash_and_equivalents=10.0,
                    short_term_debt=40.0,
                )
            ],
        )
        bank = score_f3_balance_sheet(snap, sector_flags=resolve_sector_override_flags("banks"))
        generic = score_f3_balance_sheet(snap)
        assert any("not a solvency metric for this sector" in c for c in bank.chips)
        assert not any(c == "Cash below short-term debt" for c in bank.chips)
        assert any(c == "Cash below short-term debt" for c in generic.chips)
        assert bank.score is not None and generic.score is not None
        assert bank.score > generic.score
