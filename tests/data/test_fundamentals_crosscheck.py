"""Unit tests for the SEC-XBRL ↔ provider fundamentals cross-check (ADR-004 POS-AI-10 v2)."""

from __future__ import annotations

from datetime import date

import pytest

from stocvest.data.fundamentals_crosscheck import build_fundamentals_crosscheck
from stocvest.data.fundamentals_models import IncomeStatement
from stocvest.data.sec_xbrl import CompanyFacts, XbrlFact

pytestmark = pytest.mark.unit


def _fact(key: str, label: str, value: float, unit: str = "USD", fy: int | None = 2024) -> XbrlFact:
    return XbrlFact(
        key=key,
        label=label,
        value=value,
        unit=unit,
        fiscal_year=fy,
        period_end="2024-09-28",
        form="10-K",
        filed="2024-11-01",
    )


def _facts(*facts: XbrlFact) -> CompanyFacts:
    return CompanyFacts(symbol="AAPL", entity_name="Apple Inc.", facts=list(facts), source_url="u")


def _stmt(year: int, *, revenue=None, net_income=None, eps_diluted=None, period="FY") -> IncomeStatement:
    return IncomeStatement(
        symbol="AAPL",
        as_of_date=date(year, 9, 28),
        period=period,
        calendar_year=year,
        revenue=revenue,
        net_income=net_income,
        eps_diluted=eps_diluted,
    )


def test_none_without_sec_facts() -> None:
    assert build_fundamentals_crosscheck(None, []) is None
    assert build_fundamentals_crosscheck(_facts(), [_stmt(2024, revenue=1.0)]) is None


def test_agreement_within_tolerance() -> None:
    cc = build_fundamentals_crosscheck(
        _facts(_fact("revenue", "Revenue", 383_000_000_000.0)),
        [_stmt(2024, revenue=381_000_000_000.0)],  # ~0.5% off
    )
    assert cc is not None
    row = cc.rows[0]
    assert row.agrees is True
    assert row.rel_diff is not None and row.rel_diff < 0.05
    assert cc.disagreements == 0 and cc.comparable == 1
    assert cc.to_api_dict()["scored"] is False


def test_disagreement_above_tolerance() -> None:
    cc = build_fundamentals_crosscheck(
        _facts(_fact("revenue", "Revenue", 383_000_000_000.0)),
        [_stmt(2024, revenue=300_000_000_000.0)],
    )
    assert cc is not None
    row = cc.rows[0]
    assert row.agrees is False
    assert cc.disagreements == 1
    assert "differs" in row.note


def test_fiscal_year_mismatch_is_not_comparable() -> None:
    # SEC reports FY2024; provider only has FY2023 → cannot compare, not a disagreement.
    cc = build_fundamentals_crosscheck(
        _facts(_fact("revenue", "Revenue", 383_000_000_000.0, fy=2024)),
        [_stmt(2023, revenue=300_000_000_000.0)],
    )
    assert cc is not None
    row = cc.rows[0]
    assert row.agrees is None
    assert row.provider_value is None
    assert cc.disagreements == 0 and cc.comparable == 0
    assert "FY2024" in row.note


def test_provider_missing_line_is_not_comparable() -> None:
    cc = build_fundamentals_crosscheck(
        _facts(_fact("net_income", "Net income", 95_000_000_000.0)),
        [_stmt(2024, revenue=383_000_000_000.0)],  # revenue present, net_income None
    )
    assert cc is not None
    row = cc.rows[0]
    assert row.key == "net_income"
    assert row.agrees is None
    assert "missing this line" in row.note


def test_sec_fiscal_year_unknown_is_not_comparable() -> None:
    cc = build_fundamentals_crosscheck(
        _facts(_fact("revenue", "Revenue", 100.0, fy=None)),
        [_stmt(2024, revenue=100.0)],
    )
    assert cc is not None
    assert cc.rows[0].agrees is None
    assert "fiscal year unknown" in cc.rows[0].note


def test_eps_and_multiple_rows() -> None:
    cc = build_fundamentals_crosscheck(
        _facts(
            _fact("revenue", "Revenue", 383_000_000_000.0),
            _fact("net_income", "Net income", 95_000_000_000.0),
            _fact("diluted_eps", "Diluted EPS", 6.08, unit="USD/shares"),
        ),
        [_stmt(2024, revenue=383_100_000_000.0, net_income=94_000_000_000.0, eps_diluted=6.05)],
    )
    assert cc is not None
    by_key = {r.key: r for r in cc.rows}
    assert by_key["revenue"].agrees is True  # ~0.03%
    assert by_key["net_income"].agrees is True  # ~1%
    assert by_key["diluted_eps"].agrees is True  # ~0.5%
    assert cc.comparable == 3 and cc.disagreements == 0


def test_quarterly_rows_are_ignored() -> None:
    # Only FY rows should be indexed; a stray quarter must not be picked as the annual.
    cc = build_fundamentals_crosscheck(
        _facts(_fact("revenue", "Revenue", 383_000_000_000.0, fy=2024)),
        [
            _stmt(2024, revenue=100_000_000_000.0, period="Q4"),
            _stmt(2024, revenue=383_000_000_000.0, period="FY"),
        ],
    )
    assert cc is not None
    assert cc.rows[0].agrees is True
    assert cc.rows[0].provider_value == 383_000_000_000.0


def test_both_zero_agrees() -> None:
    cc = build_fundamentals_crosscheck(
        _facts(_fact("net_income", "Net income", 0.0)),
        [_stmt(2024, net_income=0.0)],
    )
    assert cc is not None
    assert cc.rows[0].agrees is True
    assert cc.rows[0].rel_diff == 0.0
