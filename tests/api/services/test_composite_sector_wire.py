from __future__ import annotations

from stocvest.api.services.composite_sector_wire import sector_layer_api_extras
from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_momentum import SectorMomentumScore
from stocvest.signals.sector_sic_fallback import SicMappingTier


def test_sector_layer_api_extras_includes_benchmark_when_momentum_missing() -> None:
    out = sector_layer_api_extras(
        momentum=None,
        resolution_state=SectorResolutionState.RESOLVED,
        sic_mapping_tier=SicMappingTier.EXACT,
        sector_etf="XRT",
        sector_display_name="Retail",
        sector_bucket="retail",
    )
    assert out["sector_etf"] == "XRT"
    assert out["sector_display_name"] == "Retail"
    assert out["sector_bucket"] == "retail"
    assert out["sector_data_available"] is False


def test_sector_layer_api_extras_merges_momentum_fields() -> None:
    mom = SectorMomentumScore(
        etf="XRT",
        sector_key="retail",
        display_name="Retail",
        rel_1d=0.5,
        rel_5d=1.0,
        persistence=0.6,
        acceleration=0.0,
        sessions_leading=3,
        total_sessions=5,
        rank_1d=0.7,
        rank_5d=0.6,
        score=62.0,
        trending="stable",
        verdict="bullish",
        interpretation_chip="Retail leads",
        data_available=True,
    )
    out = sector_layer_api_extras(
        momentum=mom,
        resolution_state=SectorResolutionState.RESOLVED,
        sector_etf="XRT",
        sector_display_name="Retail",
        sector_bucket="retail",
    )
    assert out["sector_data_available"] is True
    assert out["sector_interpretation"] == "Retail leads"
