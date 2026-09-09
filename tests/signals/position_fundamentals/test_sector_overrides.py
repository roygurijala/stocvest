"""Sector override table + per-sector pillar wiring (ADR-004 POS-AI-5)."""

from __future__ import annotations

import pytest

from stocvest.data.fundamentals_models import FinancialRatios, PositionFundamentalsSnapshot
from stocvest.signals.position_fundamentals.f3_balance_sheet import score_f3_balance_sheet
from stocvest.signals.position_fundamentals.f4_valuation import score_f4_valuation
from stocvest.signals.position_fundamentals.sector_overrides import (
    SectorOverrideFlags,
    resolve_sector_override_flags,
)
from stocvest.signals.position_fundamentals_analyzer import (
    PositionFundamentalsAnalyzer,
    PositionFundamentalsContext,
)
from tests.signals.position_fundamentals.conftest import (
    balance_rows,
    cash_rows,
    income_rows,
    metrics_rows,
    quality_snapshot,
    ratio_rows,
)


def _high_leverage_but_covered(symbol: str) -> PositionFundamentalsSnapshot:
    """High D/E (would trip the generic red flag) but healthy interest coverage — isolates
    the leverage rule so a structural-leverage sector should NOT fire 'Elevated leverage'."""
    ratios = ratio_rows(symbol, count=8)
    ratios[0] = FinancialRatios(
        symbol=symbol,
        as_of_date=ratios[0].as_of_date,
        current_ratio=1.6,
        interest_coverage=6.0,
        debt_equity_ratio=3.5,
        net_profit_margin=0.20,
        return_on_equity=0.16,
        return_on_assets=0.11,
        price_earnings_ratio=18.0,
    )
    return PositionFundamentalsSnapshot(
        symbol=symbol,
        configured=True,
        data_quality="high",
        income_statements=income_rows(symbol, [10e9, 9.5e9, 9e9, 8.5e9, 8e9, 7.5e9, 7e9, 6.5e9]),
        balance_sheets=balance_rows(symbol, count=8),
        cash_flows=cash_rows(symbol, fcf=2e9, ocf=3e9, ni=2e9, count=8),
        ratios=ratios,
        key_metrics=metrics_rows(symbol, pe=18.0, ev_sales=4.0),
    )


# --------------------------------------------------------------------------- override table


@pytest.mark.unit
def test_banks_use_roa_and_structural_leverage() -> None:
    flags = resolve_sector_override_flags("banks")
    assert flags.use_roa_not_roic is True
    assert flags.structural_high_leverage is True
    assert flags.de_weight_valuation is False


@pytest.mark.unit
def test_biotech_de_weights_valuation_only() -> None:
    flags = resolve_sector_override_flags("biotech")
    assert flags.de_weight_valuation is True
    assert flags.structural_high_leverage is False
    assert flags.valuation_note is None


@pytest.mark.unit
def test_reit_real_estate_bucket_gets_structural_and_valuation_note() -> None:
    """The SectorMapper bucket for REITs is 'real_estate' — it must resolve to overrides."""
    flags = resolve_sector_override_flags("real_estate")
    assert flags.structural_high_leverage is True
    assert flags.de_weight_valuation is True
    assert flags.valuation_note == "REIT — judge valuation on P/FFO, not P/E"


@pytest.mark.unit
def test_reits_alias_matches_real_estate_behavior() -> None:
    """The 'reits' alias resolves to the same behavioral overrides as 'real_estate'
    (only the echoed sector_label differs)."""
    reits = resolve_sector_override_flags("reits")
    real_estate = resolve_sector_override_flags("real_estate")
    assert (reits.structural_high_leverage, reits.de_weight_valuation, reits.valuation_note) == (
        real_estate.structural_high_leverage,
        real_estate.de_weight_valuation,
        real_estate.valuation_note,
    )


@pytest.mark.unit
def test_bucket_lookup_is_case_insensitive() -> None:
    assert resolve_sector_override_flags("BANKS").use_roa_not_roic is True


@pytest.mark.unit
def test_default_sector_no_flags_but_echoes_label() -> None:
    flags = resolve_sector_override_flags("technology")
    assert flags.use_roa_not_roic is False
    assert flags.de_weight_valuation is False
    assert flags.structural_high_leverage is False
    assert flags.sector_label == "technology"


@pytest.mark.unit
def test_empty_bucket_is_all_default() -> None:
    assert resolve_sector_override_flags(None) == SectorOverrideFlags()
    assert resolve_sector_override_flags("  ") == SectorOverrideFlags()


# --------------------------------------------------------------------------- F3 leverage wiring


@pytest.mark.unit
def test_f3_generic_high_leverage_fires_red_flag() -> None:
    result = score_f3_balance_sheet(_high_leverage_but_covered("XYZ"))
    assert any("Elevated leverage" in c for c in result.chips)


@pytest.mark.unit
def test_f3_structural_sector_suppresses_leverage_red_flag() -> None:
    snap = _high_leverage_but_covered("JPM")
    flags = resolve_sector_override_flags("banks")
    result = score_f3_balance_sheet(snap, sector_flags=flags)
    assert not any("Elevated leverage" in c for c in result.chips)
    assert any("structural for sector" in c for c in result.chips)


@pytest.mark.unit
def test_f3_structural_sector_scores_at_least_as_high() -> None:
    """Suppressing an inappropriate red flag must not lower the sector score."""
    snap = _high_leverage_but_covered("O")
    generic = score_f3_balance_sheet(snap)
    reit = score_f3_balance_sheet(snap, sector_flags=resolve_sector_override_flags("real_estate"))
    assert generic.score is not None and reit.score is not None
    assert reit.score >= generic.score


# --------------------------------------------------------------------------- F4 valuation note


@pytest.mark.unit
def test_f4_reit_note_replaces_default_de_weight_chip() -> None:
    flags = resolve_sector_override_flags("real_estate")
    result = score_f4_valuation(quality_snapshot("O"), sector_flags=flags)
    assert any("P/FFO" in c for c in result.chips)
    assert not any("Pre-profit sector" in c for c in result.chips)


@pytest.mark.unit
def test_f4_biotech_keeps_default_de_weight_chip() -> None:
    flags = resolve_sector_override_flags("biotech")
    result = score_f4_valuation(quality_snapshot("XBI"), sector_flags=flags)
    assert any("valuation de-weighted" in c for c in result.chips)


# --------------------------------------------------------------------------- analyzer end-to-end


@pytest.mark.unit
def test_analyzer_reit_context_suppresses_leverage_red_flag() -> None:
    snap = _high_leverage_but_covered("SPG")
    result = PositionFundamentalsAnalyzer().analyze(
        snap, context=PositionFundamentalsContext(sector_bucket="real_estate")
    )
    f3 = next(p for p in result.pillars if p.pillar_id == "F3")
    assert not any("Elevated leverage" in c for c in f3.chips)
    assert any("structural for sector" in c for c in f3.chips)
