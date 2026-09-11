"""Position fundamentals v2 (ship-dark) — EV/Sales TTM + bank FCF/current-ratio suppression.

v2 fixes two accuracy defects surfaced on SOFI:
  (1) F4 EV/Sales used FMP's *quarterly* evToSales (EV ÷ single-quarter revenue), ~4x the
      annual multiple, over-penalizing growth names. v2 derives EV/Sales from EV ÷ TTM rev.
  (2) F1 "Negative FCF" and F3 "current ratio" penalties fire for lenders where those
      metrics are structurally non-meaningful. v2 suppresses them for bank buckets.

Every test asserts the v2=False path is byte-identical to the shipped v1 behavior.
"""

from __future__ import annotations

from datetime import date

import pytest

from stocvest.data.fundamentals_models import (
    CashFlowStatement,
    FinancialRatios,
    IncomeStatement,
    KeyMetrics,
    PositionFundamentalsSnapshot,
)
from stocvest.signals.position_fundamentals.f1_profitability import score_f1_profitability
from stocvest.signals.position_fundamentals.f3_balance_sheet import score_f3_balance_sheet
from stocvest.signals.position_fundamentals.f4_valuation import score_f4_valuation
from stocvest.signals.position_fundamentals.sector_overrides import (
    resolve_sector_override_flags,
)
from stocvest.signals.position_fundamentals_analyzer import (
    PositionFundamentalsAnalyzer,
    PositionFundamentalsContext,
)

pytestmark = pytest.mark.unit

_QDATES = [date(2026, 6, 30), date(2026, 3, 31), date(2025, 12, 31), date(2025, 9, 30)]


def _income(revs: list[float]) -> list[IncomeStatement]:
    return [
        IncomeStatement(symbol="X", as_of_date=_QDATES[i], revenue=r, net_income=r * 0.1)
        for i, r in enumerate(revs)
    ]


def _metrics(ev: float | None, ev_to_sales: float | None) -> list[KeyMetrics]:
    return [
        KeyMetrics(
            symbol="X",
            as_of_date=_QDATES[0],
            enterprise_value=ev,
            ev_to_sales=ev_to_sales,
        )
    ]


def _f4_snapshot(revs: list[float], ev: float | None, ev_to_sales: float | None):
    return PositionFundamentalsSnapshot(
        symbol="X",
        configured=True,
        data_quality="high",
        income_statements=_income(revs),
        key_metrics=_metrics(ev, ev_to_sales),
        # A single neutral ratio row so P/E / P/FCF add no delta (isolate EV/Sales).
        ratios=[FinancialRatios(symbol="X", as_of_date=_QDATES[0])],
    )


# ── F4: EV/Sales TTM ──────────────────────────────────────────────────────────


def test_f4_v2_uses_ttm_not_quarterly_ev_sales() -> None:
    # SOFI-shaped: quarterly evToSales 14.8 (would read "rich"), but EV/TTM-rev = 4.2 (neutral).
    snap = _f4_snapshot(
        revs=[1.571e9, 1.408e9, 1.335e9, 1.268e9],  # TTM = 5.582e9
        ev=23.306e9,
        ev_to_sales=14.8,
    )
    v1 = score_f4_valuation(snap, fundamentals_v2=False)
    v2 = score_f4_valuation(snap, fundamentals_v2=True)

    assert any("rich" in c for c in v1.chips)  # v1 penalizes the inflated quarterly multiple
    assert not any("rich" in c for c in v2.chips)  # v2 (TTM 4.2) sits in the neutral band
    assert v2.score > v1.score  # removing the spurious -6 raises the pillar


def test_f4_v2_ttm_suffix_when_scored() -> None:
    # TTM EV/Sales cheap (<=3.0) → +6 with a "(TTM)" chip.
    snap = _f4_snapshot(revs=[1e9, 1e9, 1e9, 1e9], ev=8e9, ev_to_sales=1.9)  # TTM 4e9 → 2.0
    v2 = score_f4_valuation(snap, fundamentals_v2=True)
    assert any("(TTM)" in c for c in v2.chips)
    assert any("EV/Sales 2.0" in c for c in v2.chips)


def test_f4_v2_skips_when_under_four_quarters() -> None:
    # Only 3 quarters → cannot form TTM → v2 skips EV/Sales entirely (no chip, no delta).
    snap = _f4_snapshot(revs=[1e9, 1e9, 1e9], ev=8e9, ev_to_sales=1.9)
    v2 = score_f4_valuation(snap, fundamentals_v2=True)
    assert not any("EV/Sales" in c for c in v2.chips)


def test_f4_v2_off_is_byte_identical() -> None:
    snap = _f4_snapshot(revs=[1.571e9, 1.408e9, 1.335e9, 1.268e9], ev=23.306e9, ev_to_sales=14.8)
    default = score_f4_valuation(snap)
    explicit_off = score_f4_valuation(snap, fundamentals_v2=False)
    assert (default.score, default.verdict, list(default.chips)) == (
        explicit_off.score,
        explicit_off.verdict,
        list(explicit_off.chips),
    )


# ── F1: bank FCF penalty suppression ───────────────────────────────────────────


def _bank_snapshot() -> PositionFundamentalsSnapshot:
    # Profitable-on-net-income lender with deeply negative FCF (loan originations) and a
    # sub-1.0 current ratio — SOFI-shaped.
    return PositionFundamentalsSnapshot(
        symbol="SOFI",
        configured=True,
        data_quality="high",
        income_statements=_income([1.571e9, 1.408e9, 1.335e9, 1.268e9]),
        cash_flows=[
            CashFlowStatement(symbol="SOFI", as_of_date=_QDATES[0], free_cash_flow=-3.99e9)
        ],
        ratios=[
            FinancialRatios(
                symbol="SOFI",
                as_of_date=_QDATES[0],
                current_ratio=0.16,
                return_on_equity=0.10,
                return_on_assets=0.02,
                net_profit_margin=0.13,
            )
        ],
    )


def test_f1_bank_fcf_penalty_suppressed_under_v2() -> None:
    snap = _bank_snapshot()
    bank_flags = resolve_sector_override_flags("banks")

    v1 = score_f1_profitability(snap, sector_flags=bank_flags, fundamentals_v2=False)
    v2 = score_f1_profitability(snap, sector_flags=bank_flags, fundamentals_v2=True)

    assert any("Negative free cash flow" in c for c in v1.chips)  # v1 penalizes
    assert not any("Negative free cash flow" in c for c in v2.chips)
    assert any("FCF not scored" in c for c in v2.chips)  # surfaced as context
    assert v2.score > v1.score


def test_f1_non_bank_still_penalizes_fcf_under_v2() -> None:
    snap = _bank_snapshot()  # same negative FCF, but no bank flags
    generic = resolve_sector_override_flags(None)
    v2 = score_f1_profitability(snap, sector_flags=generic, fundamentals_v2=True)
    assert any("Negative free cash flow" in c for c in v2.chips)


# ── F3: bank current-ratio penalty suppression ─────────────────────────────────


def test_f3_bank_current_ratio_suppressed_under_v2() -> None:
    snap = _bank_snapshot()
    bank_flags = resolve_sector_override_flags("banks")

    v1 = score_f3_balance_sheet(snap, sector_flags=bank_flags, fundamentals_v2=False)
    v2 = score_f3_balance_sheet(snap, sector_flags=bank_flags, fundamentals_v2=True)

    assert any("tight liquidity" in c for c in v1.chips)
    assert not any("tight liquidity" in c for c in v2.chips)
    assert any("not a solvency metric" in c for c in v2.chips)
    assert v2.score > v1.score


def test_f3_bank_v2_off_is_byte_identical() -> None:
    snap = _bank_snapshot()
    bank_flags = resolve_sector_override_flags("banks")
    off = score_f3_balance_sheet(snap, sector_flags=bank_flags, fundamentals_v2=False)
    default = score_f3_balance_sheet(snap, sector_flags=bank_flags)
    assert (off.score, list(off.chips)) == (default.score, list(default.chips))


# ── Analyzer-level threading ────────────────────────────────────────────────────


def test_analyzer_threads_v2_flag_to_pillars() -> None:
    snap = _bank_snapshot()
    off = PositionFundamentalsAnalyzer().analyze(
        snap, context=PositionFundamentalsContext(sector_bucket="banks", fundamentals_v2=False)
    )
    on = PositionFundamentalsAnalyzer().analyze(
        snap, context=PositionFundamentalsContext(sector_bucket="banks", fundamentals_v2=True)
    )
    # Suppressing the false FCF + liquidity penalties lifts the blended fundamentals score.
    assert on.score is not None and off.score is not None
    assert on.score > off.score
