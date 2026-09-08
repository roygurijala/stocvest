"""Canonical fundamentals types for Position desk scoring (ADR-004 POS-D1).

FMP JSON rows are normalized here before pillar analyzers (POS-D2) consume them.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from stocvest.data.symbol_normalize import to_polygon_symbol

FundamentalsPeriod = Literal["quarter", "annual"]
FundamentalsDataQuality = Literal["high", "medium", "low", "unavailable"]

_DEFAULT_FUNDAMENTALS_LIMIT = 12
_MIN_FUNDAMENTALS_LIMIT = 1
_MAX_FUNDAMENTALS_LIMIT = 40


def normalize_fundamentals_symbol(symbol: str) -> str:
    """Uppercase + class-share wire form (``BRK-B`` → ``BRK.B``) for FMP requests."""
    return to_polygon_symbol(str(symbol or "").strip())


def clamp_fundamentals_limit(limit: int, *, max_limit: int = _MAX_FUNDAMENTALS_LIMIT) -> int:
    try:
        value = int(limit)
    except (TypeError, ValueError):
        value = _DEFAULT_FUNDAMENTALS_LIMIT
    return max(_MIN_FUNDAMENTALS_LIMIT, min(max_limit, value))


def _coerce_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out:  # NaN
        return None
    if out in (float("inf"), float("-inf")):
        return None
    return out


def _parse_statement_date(value: Any) -> date | None:
    if value is None:
        return None
    raw = str(value).strip()[:10]
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


class StatementRow(BaseModel):
    """Shared metadata for quarterly/annual statement rows."""

    symbol: str
    as_of_date: date
    period: str | None = None
    calendar_year: int | None = None

    @field_validator("symbol", mode="before")
    @classmethod
    def _normalize_symbol(cls, value: Any) -> str:
        return normalize_fundamentals_symbol(str(value or ""))


class IncomeStatement(StatementRow):
    revenue: float | None = None
    gross_profit: float | None = None
    operating_income: float | None = None
    net_income: float | None = None
    eps: float | None = None
    eps_diluted: float | None = None
    shares_outstanding: float | None = None
    shares_outstanding_diluted: float | None = None

    @classmethod
    def from_fmp_row(cls, row: dict[str, Any]) -> IncomeStatement | None:
        if not isinstance(row, dict):
            return None
        as_of = _parse_statement_date(row.get("date") or row.get("fillingDate"))
        symbol = normalize_fundamentals_symbol(str(row.get("symbol") or ""))
        if as_of is None or not symbol:
            return None
        return cls(
            symbol=symbol,
            as_of_date=as_of,
            period=(str(row.get("period")).strip() if row.get("period") is not None else None),
            calendar_year=_coerce_optional_int(row.get("calendarYear")),
            revenue=_coerce_optional_float(row.get("revenue")),
            gross_profit=_coerce_optional_float(row.get("grossProfit")),
            operating_income=_coerce_optional_float(row.get("operatingIncome")),
            net_income=_coerce_optional_float(row.get("netIncome")),
            eps=_coerce_optional_float(row.get("eps")),
            eps_diluted=_coerce_optional_float(row.get("epsdiluted")),
            shares_outstanding=_coerce_optional_float(row.get("weightedAverageShsOut")),
            shares_outstanding_diluted=_coerce_optional_float(row.get("weightedAverageShsOutDil")),
        )


class BalanceSheet(StatementRow):
    total_assets: float | None = None
    total_liabilities: float | None = None
    total_debt: float | None = None
    net_debt: float | None = None
    cash_and_equivalents: float | None = None
    total_current_assets: float | None = None
    total_current_liabilities: float | None = None
    short_term_debt: float | None = None
    long_term_debt: float | None = None
    stockholders_equity: float | None = None

    @classmethod
    def from_fmp_row(cls, row: dict[str, Any]) -> BalanceSheet | None:
        if not isinstance(row, dict):
            return None
        as_of = _parse_statement_date(row.get("date") or row.get("fillingDate"))
        symbol = normalize_fundamentals_symbol(str(row.get("symbol") or ""))
        if as_of is None or not symbol:
            return None
        return cls(
            symbol=symbol,
            as_of_date=as_of,
            period=(str(row.get("period")).strip() if row.get("period") is not None else None),
            calendar_year=_coerce_optional_int(row.get("calendarYear")),
            total_assets=_coerce_optional_float(row.get("totalAssets")),
            total_liabilities=_coerce_optional_float(row.get("totalLiabilities")),
            total_debt=_coerce_optional_float(row.get("totalDebt")),
            net_debt=_coerce_optional_float(row.get("netDebt")),
            cash_and_equivalents=_coerce_optional_float(row.get("cashAndCashEquivalents")),
            total_current_assets=_coerce_optional_float(row.get("totalCurrentAssets")),
            total_current_liabilities=_coerce_optional_float(row.get("totalCurrentLiabilities")),
            short_term_debt=_coerce_optional_float(row.get("shortTermDebt")),
            long_term_debt=_coerce_optional_float(row.get("longTermDebt")),
            stockholders_equity=_coerce_optional_float(row.get("totalStockholdersEquity")),
        )


class CashFlowStatement(StatementRow):
    operating_cash_flow: float | None = None
    free_cash_flow: float | None = None
    capital_expenditure: float | None = None
    dividends_paid: float | None = None
    stock_based_compensation: float | None = None
    net_income: float | None = None

    @classmethod
    def from_fmp_row(cls, row: dict[str, Any]) -> CashFlowStatement | None:
        if not isinstance(row, dict):
            return None
        as_of = _parse_statement_date(row.get("date") or row.get("fillingDate"))
        symbol = normalize_fundamentals_symbol(str(row.get("symbol") or ""))
        if as_of is None or not symbol:
            return None
        return cls(
            symbol=symbol,
            as_of_date=as_of,
            period=(str(row.get("period")).strip() if row.get("period") is not None else None),
            calendar_year=_coerce_optional_int(row.get("calendarYear")),
            operating_cash_flow=_coerce_optional_float(row.get("operatingCashFlow")),
            free_cash_flow=_coerce_optional_float(row.get("freeCashFlow")),
            capital_expenditure=_coerce_optional_float(row.get("capitalExpenditure")),
            dividends_paid=_coerce_optional_float(row.get("dividendsPaid")),
            stock_based_compensation=_coerce_optional_float(row.get("stockBasedCompensation")),
            net_income=_coerce_optional_float(row.get("netIncome")),
        )


class FinancialRatios(StatementRow):
    gross_profit_margin: float | None = None
    operating_profit_margin: float | None = None
    net_profit_margin: float | None = None
    return_on_equity: float | None = None
    return_on_assets: float | None = None
    return_on_capital_employed: float | None = None
    current_ratio: float | None = None
    debt_equity_ratio: float | None = None
    interest_coverage: float | None = None
    price_earnings_ratio: float | None = None
    price_to_free_cash_flow: float | None = None
    enterprise_value_multiple: float | None = None

    @classmethod
    def from_fmp_row(cls, row: dict[str, Any]) -> FinancialRatios | None:
        if not isinstance(row, dict):
            return None
        as_of = _parse_statement_date(row.get("date") or row.get("fillingDate"))
        symbol = normalize_fundamentals_symbol(str(row.get("symbol") or ""))
        if as_of is None or not symbol:
            return None
        return cls(
            symbol=symbol,
            as_of_date=as_of,
            period=(str(row.get("period")).strip() if row.get("period") is not None else None),
            calendar_year=_coerce_optional_int(row.get("calendarYear")),
            gross_profit_margin=_coerce_optional_float(row.get("grossProfitMargin")),
            operating_profit_margin=_coerce_optional_float(row.get("operatingProfitMargin")),
            net_profit_margin=_coerce_optional_float(row.get("netProfitMargin")),
            return_on_equity=_coerce_optional_float(row.get("returnOnEquity")),
            return_on_assets=_coerce_optional_float(row.get("returnOnAssets")),
            return_on_capital_employed=_coerce_optional_float(row.get("returnOnCapitalEmployed")),
            current_ratio=_coerce_optional_float(row.get("currentRatio")),
            debt_equity_ratio=_coerce_optional_float(row.get("debtEquityRatio")),
            interest_coverage=_coerce_optional_float(row.get("interestCoverage")),
            price_earnings_ratio=_coerce_optional_float(row.get("priceEarningsRatio")),
            price_to_free_cash_flow=_coerce_optional_float(row.get("priceToFreeCashFlowsRatio")),
            enterprise_value_multiple=_coerce_optional_float(row.get("enterpriseValueMultiple")),
        )


class KeyMetrics(StatementRow):
    market_cap: float | None = None
    enterprise_value: float | None = None
    pe_ratio: float | None = None
    pb_ratio: float | None = None
    ev_to_sales: float | None = None
    ev_to_operating_cash_flow: float | None = None
    ev_to_free_cash_flow: float | None = None
    earnings_yield: float | None = None
    free_cash_flow_yield: float | None = None
    dividend_yield: float | None = None

    @classmethod
    def from_fmp_row(cls, row: dict[str, Any]) -> KeyMetrics | None:
        if not isinstance(row, dict):
            return None
        as_of = _parse_statement_date(row.get("date") or row.get("fillingDate"))
        symbol = normalize_fundamentals_symbol(str(row.get("symbol") or ""))
        if as_of is None or not symbol:
            return None
        return cls(
            symbol=symbol,
            as_of_date=as_of,
            period=(str(row.get("period")).strip() if row.get("period") is not None else None),
            calendar_year=_coerce_optional_int(row.get("calendarYear")),
            market_cap=_coerce_optional_float(row.get("marketCap")),
            enterprise_value=_coerce_optional_float(row.get("enterpriseValue")),
            pe_ratio=_coerce_optional_float(row.get("peRatio")),
            pb_ratio=_coerce_optional_float(row.get("pbRatio")),
            ev_to_sales=_coerce_optional_float(row.get("evToSales")),
            ev_to_operating_cash_flow=_coerce_optional_float(row.get("evToOperatingCashFlow")),
            ev_to_free_cash_flow=_coerce_optional_float(row.get("evToFreeCashFlow")),
            earnings_yield=_coerce_optional_float(row.get("earningsYield")),
            free_cash_flow_yield=_coerce_optional_float(row.get("freeCashFlowYield")),
            dividend_yield=_coerce_optional_float(row.get("dividendYield")),
        )


class PositionFundamentalsSnapshot(BaseModel):
    """Bundle returned by the provider for one symbol (POS-D2 input)."""

    symbol: str
    income_statements: list[IncomeStatement] = Field(default_factory=list)
    balance_sheets: list[BalanceSheet] = Field(default_factory=list)
    cash_flows: list[CashFlowStatement] = Field(default_factory=list)
    ratios: list[FinancialRatios] = Field(default_factory=list)
    key_metrics: list[KeyMetrics] = Field(default_factory=list)
    sector_peers: list[str] = Field(default_factory=list)
    configured: bool = False
    data_quality: FundamentalsDataQuality = "unavailable"

    @field_validator("symbol", mode="before")
    @classmethod
    def _normalize_symbol(cls, value: Any) -> str:
        return normalize_fundamentals_symbol(str(value or ""))


def assess_snapshot_data_quality(snapshot: PositionFundamentalsSnapshot) -> FundamentalsDataQuality:
    """Heuristic coverage tier for POS-D2 gates (G9). Pure, testable."""
    if not snapshot.configured:
        return "unavailable"
    families = [
        snapshot.income_statements,
        snapshot.balance_sheets,
        snapshot.cash_flows,
        snapshot.ratios,
        snapshot.key_metrics,
    ]
    populated_4plus = sum(1 for fam in families if len(fam) >= 4)
    any_data = sum(1 for fam in families if len(fam) > 0)
    if populated_4plus >= 4:
        return "high"
    if populated_4plus >= 2:
        return "medium"
    if any_data >= 1:
        return "low"
    return "unavailable"
