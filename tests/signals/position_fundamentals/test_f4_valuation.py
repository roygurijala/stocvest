"""F4 valuation pillar + value-trap guard tests."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.f4_valuation import (
    apply_value_trap_guard,
    score_f4_valuation,
)
from stocvest.signals.position_fundamentals.sector_overrides import SectorOverrideFlags
from stocvest.signals.position_fundamentals.types import PositionPillarResult
from tests.signals.position_fundamentals.conftest import (
    income_rows,
    metrics_rows,
    quality_snapshot,
    ratio_rows,
    weak_growth_snapshot,
)
from stocvest.data.fundamentals_models import PositionFundamentalsSnapshot


def _peg_snapshot(
    *,
    pe: float,
    eps_newest_first: list[float],
    ev_sales: float,
    symbol: str = "PEGCO",
) -> PositionFundamentalsSnapshot:
    """Controlled snapshot: fixes latest P/E, TTM-EPS growth (via 8 quarterly EPS,
    newest-first), and EV/Sales so F4 deltas can be isolated. P/FCF is flat (18x) → 0."""
    n = len(eps_newest_first)
    return PositionFundamentalsSnapshot(
        symbol=symbol,
        configured=True,
        data_quality="high",
        income_statements=income_rows(
            symbol,
            [100e9] * n,
            eps_values=eps_newest_first,
        ),
        ratios=ratio_rows(symbol, pe=pe, count=8),
        key_metrics=metrics_rows(symbol, pe=pe, ev_sales=ev_sales),
    )


@pytest.mark.unit
class TestF4Valuation:
    def test_unavailable_without_data(self) -> None:
        assert score_f4_valuation(PositionFundamentalsSnapshot(symbol="X", configured=True)).status == "unavailable"

    def test_reasonable_valuation_active(self) -> None:
        result = score_f4_valuation(quality_snapshot(), f2_verdict="bullish", f2_score=70)
        assert result.status == "active"
        assert result.score is not None

    def test_value_trap_guard_caps_bullish(self) -> None:
        raw = score_f4_valuation(
            weak_growth_snapshot(),
            f2_verdict="bearish",
            f2_score=35,
        )
        assert raw.score is not None
        assert raw.score <= 55
        assert raw.verdict != "bullish"
        assert any("Value-trap guard" in c for c in raw.chips)

    def test_value_trap_guard_helper(self) -> None:
        pillar = PositionPillarResult(
            pillar_id="F4",
            label="Valuation",
            weight=15,
            status="active",
            score=75,
            verdict="bullish",
            reasoning="test",
            chips=[],
        )
        guarded = apply_value_trap_guard(
            pillar,
            f2_verdict="bearish",
            f2_score=30,
            pe_ratio=12.0,
        )
        assert guarded.score is not None
        assert guarded.score <= 55
        assert guarded.verdict == "neutral"

    def test_value_trap_not_applied_when_growth_strong(self) -> None:
        pillar = PositionPillarResult(
            pillar_id="F4",
            label="Valuation",
            weight=15,
            status="active",
            score=75,
            verdict="bullish",
            reasoning="test",
            chips=[],
        )
        guarded = apply_value_trap_guard(
            pillar,
            f2_verdict="bullish",
            f2_score=70,
            pe_ratio=12.0,
        )
        assert guarded.score == 75
        assert guarded.verdict == "bullish"

    def test_biotech_de_weights_valuation(self) -> None:
        result = score_f4_valuation(
            quality_snapshot(),
            sector_flags=SectorOverrideFlags(de_weight_valuation=True),
            f2_verdict="bullish",
            f2_score=70,
        )
        assert any("de-weighted" in c for c in result.chips)


# EPS series (newest-first, 8 quarters) with TTM-EPS YoY = last-4 sum / prior-4 sum − 1.
_EPS_GROWTH_5PCT = [2.1, 2.1, 2.1, 2.1, 2.0, 2.0, 2.0, 2.0]  # 8.4 / 8.0 → +5%
_EPS_GROWTH_30PCT = [2.6, 2.6, 2.6, 2.6, 2.0, 2.0, 2.0, 2.0]  # 10.4 / 8.0 → +30%
_EPS_DECLINING = [1.8, 1.8, 1.8, 1.8, 2.0, 2.0, 2.0, 2.0]  # 7.2 / 8.0 → −10%
_EPS_GROWTH_200PCT = [6.0, 6.0, 6.0, 6.0, 2.0, 2.0, 2.0, 2.0]  # 24 / 8 → +200%


@pytest.mark.unit
class TestF4PegValuation:
    """PEG-aware P/E + graded EV/Sales (valuation_peg flag)."""

    def test_peg_expensive_penalizes_and_replaces_own_history_pe(self) -> None:
        # P/E 40, +5% growth → PEG 8.0 → −10. EV/Sales 7.0 (6–8 band) → 0. P/FCF flat → 0.
        snap = _peg_snapshot(pe=40.0, eps_newest_first=_EPS_GROWTH_5PCT, ev_sales=7.0)
        result = score_f4_valuation(snap, valuation_peg=True)
        assert result.score == 40
        assert any("PEG" in c and "expensive" in c for c in result.chips)
        # PEG replaces the own-8Q-median P/E read — no double-count.
        assert not any(c.startswith("P/E") for c in result.chips)

    def test_peg_cheap_rewards(self) -> None:
        # P/E 20, +30% growth → PEG 0.67 → +10.
        snap = _peg_snapshot(pe=20.0, eps_newest_first=_EPS_GROWTH_30PCT, ev_sales=7.0)
        result = score_f4_valuation(snap, valuation_peg=True)
        assert result.score == 60
        assert any("PEG" in c and "cheap" in c for c in result.chips)

    def test_peg_growth_cap_binds(self) -> None:
        # P/E 60, +200% growth capped to 50% → PEG 1.2 (reasonable, +5), not 0.3 (+10).
        snap = _peg_snapshot(pe=60.0, eps_newest_first=_EPS_GROWTH_200PCT, ev_sales=7.0)
        result = score_f4_valuation(snap, valuation_peg=True)
        assert result.score == 55
        assert any("PEG 1.2" in c for c in result.chips)

    def test_peg_falls_back_to_own_history_when_growth_non_positive(self) -> None:
        # Declining EPS → PEG unusable → own-8Q-median P/E read used instead.
        snap = _peg_snapshot(pe=40.0, eps_newest_first=_EPS_DECLINING, ev_sales=7.0)
        result = score_f4_valuation(snap, valuation_peg=True)
        assert not any("PEG" in c for c in result.chips)
        assert any(c.startswith("P/E") for c in result.chips)

    def test_graded_ev_sales_differentiates_rich_names(self) -> None:
        # Declining EPS isolates EV/Sales (PEG falls back, own P/E ~near median → 0).
        rich = _peg_snapshot(pe=40.0, eps_newest_first=_EPS_DECLINING, ev_sales=9.0)
        richer = _peg_snapshot(pe=40.0, eps_newest_first=_EPS_DECLINING, ev_sales=13.0)
        s_rich = score_f4_valuation(rich, valuation_peg=True)
        s_richer = score_f4_valuation(richer, valuation_peg=True)
        assert s_rich.score == 48  # 9x → −2
        assert s_richer.score == 46  # 13x → −4
        # The old cliff collapsed both onto −6 (44); graded now separates them.
        assert s_rich.score != s_richer.score

    def test_flag_off_is_unchanged_no_peg(self) -> None:
        snap = _peg_snapshot(pe=40.0, eps_newest_first=_EPS_GROWTH_5PCT, ev_sales=9.0)
        off = score_f4_valuation(snap, valuation_peg=False)
        assert not any("PEG" in c for c in off.chips)
        # Old EV/Sales cliff: 9x ≥ 8 → −6, own-history P/E near median → 0 → 44.
        assert off.score == 44
