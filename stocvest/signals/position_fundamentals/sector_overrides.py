"""Sector-specific pillar adjustments — stub for POS-AI-5."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SectorOverrideFlags:
    use_roa_not_roic: bool = False
    de_weight_valuation: bool = False
    sector_label: str | None = None


def resolve_sector_override_flags(sector_bucket: str | None) -> SectorOverrideFlags:
    bucket = (sector_bucket or "").strip().lower()
    if bucket in {"banks", "insurance", "consumer_finance", "investment_services"}:
        return SectorOverrideFlags(use_roa_not_roic=True, sector_label=bucket)
    if bucket in {"biotech", "pharma"}:
        return SectorOverrideFlags(de_weight_valuation=True, sector_label=bucket)
    return SectorOverrideFlags(sector_label=bucket or None)
