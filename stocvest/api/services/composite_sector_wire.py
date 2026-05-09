"""Shared composite response helpers for sector momentum + resolution wire format."""

from __future__ import annotations

from typing import Any

from stocvest.signals.sector_mapper import SectorResolutionState
from stocvest.signals.sector_sic_fallback import SicMappingTier
from stocvest.signals.sector_momentum import SectorMomentumScore


def sector_layer_api_extras(
    *,
    momentum: SectorMomentumScore | None,
    resolution_state: SectorResolutionState | None,
    daily_sessions: list[dict[str, Any]] | None = None,
    sic_mapping_tier: SicMappingTier | None = None,
) -> dict[str, Any]:
    """Additive fields for ``layers[]`` sector row (spec Part 6)."""
    out: dict[str, Any] = {}
    if resolution_state is not None:
        out["sector_resolution_state"] = resolution_state.value
    if sic_mapping_tier is not None:
        out["sic_mapping_tier"] = sic_mapping_tier.value
    if momentum is None:
        out["sector_data_available"] = False
        return out
    out["sector_persistence"] = momentum.persistence
    out["sector_sessions_leading"] = momentum.sessions_leading
    out["sector_total_sessions"] = momentum.total_sessions
    out["sector_trending"] = momentum.trending
    out["sector_rank_1d"] = momentum.rank_1d
    out["sector_rank_5d"] = momentum.rank_5d
    out["sector_interpretation"] = momentum.interpretation_chip
    out["sector_data_available"] = momentum.data_available
    if daily_sessions is not None:
        out["sector_daily_sessions"] = daily_sessions
    return out
