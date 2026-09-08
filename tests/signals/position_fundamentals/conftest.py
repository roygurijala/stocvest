"""Shared fixtures for position fundamentals pillar tests."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Iterable

from stocvest.data.fundamentals_models import (
    BalanceSheet,
    CashFlowStatement,
    FinancialRatios,
    IncomeStatement,
    KeyMetrics,
    PositionFundamentalsSnapshot,
)


def _quarter_dates(n: int, *, start: date = date(2025, 3, 31)) -> list[date]:
    """Approximate quarter-end dates going backward (~91 days)."""
    return [start - timedelta(days=91 * i) for i in range(n)]


def income_rows(
    symbol: str,
    revenues: Iterable[float],
    *,
    eps_values: Iterable[float] | None = None,
) -> list[IncomeStatement]:
    rev_list = list(revenues)
    eps_list = list(eps_values) if eps_values is not None else []
    dates = _quarter_dates(len(rev_list))
    rows: list[IncomeStatement] = []
    for i, rev in enumerate(rev_list):
        eps = eps_list[i] if i < len(eps_list) else rev / 1_000_000_000
        rows.append(
            IncomeStatement(
                symbol=symbol,
                as_of_date=dates[i],
                revenue=rev,
                net_income=rev * 0.2,
                eps=eps,
                eps_diluted=eps,
            )
        )
    return rows


def ratio_rows(
    symbol: str,
    *,
    roe: float = 0.18,
    roic: float = 0.14,
    net_margin: float = 0.22,
    pe: float = 24.0,
    count: int = 8,
) -> list[FinancialRatios]:
    rows: list[FinancialRatios] = []
    for i, dt in enumerate(_quarter_dates(count)):
        rows.append(
            FinancialRatios(
                symbol=symbol,
                as_of_date=dt,
                return_on_equity=roe - i * 0.005,
                return_on_capital_employed=roic,
                return_on_assets=0.10,
                gross_profit_margin=0.45,
                operating_profit_margin=0.30,
                net_profit_margin=net_margin,
                current_ratio=1.8,
                debt_equity_ratio=0.6,
                interest_coverage=8.0,
                price_earnings_ratio=pe + i,
                price_to_free_cash_flow=18.0,
            )
        )
    return rows


def balance_rows(symbol: str, *, count: int = 4) -> list[BalanceSheet]:
    return [
        BalanceSheet(
            symbol=symbol,
            as_of_date=dt,
            total_assets=100.0,
            cash_and_equivalents=30.0,
            short_term_debt=10.0,
            total_debt=25.0,
            stockholders_equity=60.0,
        )
        for dt in _quarter_dates(count)
    ]


def cash_rows(
    symbol: str,
    *,
    fcf: float = 20.0,
    ocf: float = 25.0,
    ni: float = 18.0,
    count: int = 4,
) -> list[CashFlowStatement]:
    return [
        CashFlowStatement(
            symbol=symbol,
            as_of_date=dt,
            operating_cash_flow=ocf,
            free_cash_flow=fcf,
            net_income=ni,
        )
        for dt in _quarter_dates(count)
    ]


def metrics_rows(symbol: str, *, pe: float = 24.0, ev_sales: float = 5.0) -> list[KeyMetrics]:
    return [
        KeyMetrics(
            symbol=symbol,
            as_of_date=date(2025, 3, 31),
            pe_ratio=pe,
            ev_to_sales=ev_sales,
        )
    ]


def quality_snapshot(symbol: str = "AAPL") -> PositionFundamentalsSnapshot:
    """Strong compounder fixture."""
    return PositionFundamentalsSnapshot(
        symbol=symbol,
        configured=True,
        data_quality="high",
        income_statements=income_rows(
            symbol,
            [100e9, 95e9, 90e9, 85e9, 80e9, 76e9, 72e9, 68e9, 64e9, 60e9, 56e9, 52e9, 48e9],
            eps_values=[6.0, 5.8, 5.5, 5.2, 4.9, 4.7, 4.5, 4.3, 4.0, 3.8, 3.5, 3.2, 3.0],
        ),
        balance_sheets=balance_rows(symbol, count=8),
        cash_flows=cash_rows(symbol, fcf=22e9, ocf=28e9, ni=20e9, count=8),
        ratios=ratio_rows(symbol, roe=0.22, roic=0.16, net_margin=0.24, pe=22.0, count=8),
        key_metrics=metrics_rows(symbol, pe=22.0, ev_sales=4.5),
        sector_peers=["MSFT", "GOOGL"],
    )


def weak_growth_snapshot(symbol: str = "VALUE") -> PositionFundamentalsSnapshot:
    """Low growth + low P/E for value-trap tests."""
    return PositionFundamentalsSnapshot(
        symbol=symbol,
        configured=True,
        data_quality="medium",
        income_statements=income_rows(
            symbol,
            [50e9, 49e9, 48e9, 47e9, 55e9, 54e9, 53e9, 52e9],
            eps_values=[2.0, 1.9, 1.8, 1.7, 2.5, 2.4, 2.3, 2.2],
        ),
        balance_sheets=balance_rows(symbol),
        cash_flows=cash_rows(symbol, fcf=5e9, ocf=6e9, ni=4e9),
        ratios=ratio_rows(symbol, roe=0.08, roic=0.06, net_margin=0.10, pe=10.0, count=8),
        key_metrics=metrics_rows(symbol, pe=10.0, ev_sales=2.0),
    )


def levered_snapshot(symbol: str = "RISK") -> PositionFundamentalsSnapshot:
    ratios = ratio_rows(symbol, count=4)
    ratios[0] = FinancialRatios(
        symbol=symbol,
        as_of_date=ratios[0].as_of_date,
        current_ratio=0.8,
        interest_coverage=1.1,
        debt_equity_ratio=3.5,
        net_profit_margin=0.05,
        return_on_equity=0.04,
    )
    return PositionFundamentalsSnapshot(
        symbol=symbol,
        configured=True,
        income_statements=income_rows(symbol, [10e9, 9.5e9, 9e9, 8.5e9, 10e9, 9.8e9, 9.6e9, 9.4e9]),
        balance_sheets=balance_rows(symbol),
        cash_flows=cash_rows(symbol, fcf=-1e9, ocf=1e9, ni=0.5e9),
        ratios=ratios,
        key_metrics=metrics_rows(symbol, pe=30.0),
    )
