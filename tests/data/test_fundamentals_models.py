"""Fundamentals models — FMP row parsing and data-quality heuristics."""

from __future__ import annotations

from datetime import date

import pytest

from stocvest.data.fundamentals_models import (
    BalanceSheet,
    CashFlowStatement,
    FinancialRatios,
    IncomeStatement,
    KeyMetrics,
    PositionFundamentalsSnapshot,
    assess_snapshot_data_quality,
    normalize_fundamentals_symbol,
)


@pytest.mark.unit
class TestFundamentalsSymbolHelpers:
    def test_normalize_class_share_dash(self) -> None:
        assert normalize_fundamentals_symbol("brk-b") == "BRK.B"

    def test_rejects_inf_as_none_via_parser(self) -> None:
        parsed = IncomeStatement.from_fmp_row(
            {"date": "2025-03-31", "symbol": "AAPL", "revenue": float("inf")}
        )
        assert parsed is not None
        assert parsed.revenue is None


@pytest.mark.unit
class TestIncomeStatementFromFmp:
    def test_parses_valid_row(self) -> None:
        row = {
            "date": "2025-03-31",
            "symbol": "aapl",
            "period": "Q2",
            "calendarYear": 2025,
            "revenue": 95_359_000_000,
            "grossProfit": 44_867_000_000,
            "netIncome": 24_780_000_000,
            "eps": 1.65,
        }
        parsed = IncomeStatement.from_fmp_row(row)
        assert parsed is not None
        assert parsed.symbol == "AAPL"
        assert parsed.as_of_date == date(2025, 3, 31)
        assert parsed.revenue == 95_359_000_000

    def test_rejects_missing_date(self) -> None:
        assert IncomeStatement.from_fmp_row({"symbol": "AAPL", "revenue": 1}) is None

    def test_rejects_non_dict(self) -> None:
        assert IncomeStatement.from_fmp_row("bad") is None  # type: ignore[arg-type]

    def test_coerces_invalid_numeric_to_none(self) -> None:
        row = {"date": "2025-03-31", "symbol": "MSFT", "revenue": "not-a-number"}
        parsed = IncomeStatement.from_fmp_row(row)
        assert parsed is not None
        assert parsed.revenue is None


@pytest.mark.unit
class TestOtherStatementParsers:
    def test_balance_sheet_parses_debt_fields(self) -> None:
        parsed = BalanceSheet.from_fmp_row(
            {
                "date": "2025-03-31",
                "symbol": "JPM",
                "totalDebt": 100.0,
                "netDebt": 50.0,
                "totalStockholdersEquity": 300.0,
            }
        )
        assert parsed is not None
        assert parsed.total_debt == 100.0
        assert parsed.stockholders_equity == 300.0

    def test_cash_flow_parses_fcf(self) -> None:
        parsed = CashFlowStatement.from_fmp_row(
            {
                "date": "2025-03-31",
                "symbol": "AAPL",
                "operatingCashFlow": 200.0,
                "freeCashFlow": 150.0,
            }
        )
        assert parsed is not None
        assert parsed.free_cash_flow == 150.0

    def test_ratios_parses_margins(self) -> None:
        parsed = FinancialRatios.from_fmp_row(
            {
                "date": "2025-03-31",
                "symbol": "AAPL",
                "returnOnEquity": 0.45,
                "interestCoverage": 12.0,
            }
        )
        assert parsed is not None
        assert parsed.return_on_equity == 0.45

    def test_key_metrics_parses_valuation(self) -> None:
        parsed = KeyMetrics.from_fmp_row(
            {
                "date": "2025-03-31",
                "symbol": "AAPL",
                "peRatio": 28.5,
                "marketCap": 3_000_000_000_000,
            }
        )
        assert parsed is not None
        assert parsed.pe_ratio == 28.5


@pytest.mark.unit
class TestAssessSnapshotDataQuality:
    def _stmt(self, symbol: str = "AAPL") -> IncomeStatement:
        return IncomeStatement(symbol=symbol, as_of_date=date(2025, 3, 31), revenue=1.0)

    def test_unavailable_when_not_configured(self) -> None:
        snap = PositionFundamentalsSnapshot(symbol="AAPL", configured=False)
        assert assess_snapshot_data_quality(snap) == "unavailable"

    def test_high_when_four_families_populated(self) -> None:
        row = [self._stmt()] * 4
        snap = PositionFundamentalsSnapshot(
            symbol="AAPL",
            configured=True,
            income_statements=row,
            balance_sheets=[BalanceSheet(symbol="AAPL", as_of_date=date(2025, 3, 31))] * 4,
            cash_flows=[CashFlowStatement(symbol="AAPL", as_of_date=date(2025, 3, 31))] * 4,
            ratios=[FinancialRatios(symbol="AAPL", as_of_date=date(2025, 3, 31))] * 4,
        )
        assert assess_snapshot_data_quality(snap) == "high"

    def test_medium_when_two_families(self) -> None:
        snap = PositionFundamentalsSnapshot(
            symbol="AAPL",
            configured=True,
            income_statements=[self._stmt()] * 4,
            balance_sheets=[BalanceSheet(symbol="AAPL", as_of_date=date(2025, 3, 31))] * 4,
        )
        assert assess_snapshot_data_quality(snap) == "medium"

    def test_low_when_one_family_under_four_rows(self) -> None:
        snap = PositionFundamentalsSnapshot(
            symbol="AAPL",
            configured=True,
            income_statements=[self._stmt()],
        )
        assert assess_snapshot_data_quality(snap) == "low"
