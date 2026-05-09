"""
Coarse SIC → internal sector bucket when Polygon returns a SIC not in the exact ``SIC_TO_SECTOR`` table.

Order of resolution:
  1. Exact 4-digit match in ``exact_map`` (from ``sector_mapper.SIC_TO_SECTOR``).
  2. Curated 3-digit prefix map (major groups).
  3. 2-digit division proxy (OSHA / SEC SIC structure) for broad market coverage — tagged ``coarse`` (provisional).
  4. ``default`` + ``fallback_spy`` tier (caller maps to SPY; honest broad market when unknown).

Non-classifiable / placeholder SICs (e.g. 9999) intentionally skip coarse inference.
"""

from __future__ import annotations

from enum import Enum
from typing import Mapping


class SicMappingTier(str, Enum):
    """How the internal sector bucket was derived from SIC (for debugging / analytics, not user copy)."""

    EXACT = "exact"
    PREFIX = "prefix"
    COARSE = "coarse"
    FALLBACK_SPY = "fallback_spy"

# SEC “nonclassifiable” and similar — do not invent a sector ETF.
_SIC_EXCLUDE_FROM_PREFIX: frozenset[str] = frozenset({"9999", "9998", "0000", "9990"})

# Major-group style prefixes (first 3 digits) when not covered by exact SIC_TO_SECTOR.
SIC_THREE_DIGIT_FALLBACK: dict[str, str] = {
    "481": "communication_services",
    "482": "communication_services",
    "483": "communication_services",
    "484": "communication_services",
    "489": "communication_services",
    "621": "investment_services",
    "622": "investment_services",
    "628": "investment_services",
    "631": "insurance",
    "632": "insurance",
    "633": "insurance",
    "641": "insurance",
    "671": "investment_services",
    "672": "investment_services",
    "873": "biotech",
    "874": "industrials",
    "871": "industrials",
    "872": "industrials",
    "737": "technology",
    "738": "technology",
    "739": "technology",
    "357": "hardware",
    "366": "hardware",
    "367": "technology",
    "283": "pharma",
    "284": "chemicals",
    "285": "chemicals",
    "286": "chemicals",
    "287": "chemicals",
    "289": "chemicals",
    "291": "energy",
    "131": "energy",
    "138": "energy",
    "104": "mining",
    "109": "mining",
    "355": "industrials",
    "353": "industrials",
    "351": "industrials",
    "382": "medical_devices",
    "384": "medical_devices",
    "800": "health_services",
    "801": "health_services",
    "806": "health_services",
    "809": "health_services",
    "371": "auto",
    "551": "auto",
    "581": "restaurants",
    "531": "retail",
    "565": "retail",
    "594": "retail",
    "596": "retail",
    "591": "food_beverage",
    "541": "food_beverage",
    "602": "banks",
    "603": "banks",
    "614": "consumer_finance",
    "615": "consumer_finance",
    "451": "airlines",
    "452": "airlines",
    "421": "transport",
    "401": "transport",
    "491": "utilities",
    "492": "utilities",
    "494": "utilities",
    "650": "real_estate",
    "651": "real_estate",
    "655": "real_estate",
    "679": "real_estate",
}


def _build_two_digit_sector_fallback() -> dict[str, str]:
    """First two digits of SIC → coarse bucket (OSHA division–level proxy)."""
    d: dict[str, str] = {}

    def span(lo: int, hi: int, bucket: str) -> None:
        for i in range(lo, hi + 1):
            d[f"{i:02d}"] = bucket

    span(1, 9, "consumer_staples")  # Agriculture, forestry, fishing (food / staples tilt)
    span(10, 12, "materials")
    d["13"] = "energy"
    d["14"] = "materials"
    span(15, 17, "industrials")
    span(20, 39, "industrials")  # Manufacturing — 3-digit table refines chemicals / pharma / tech where needed
    span(40, 41, "transport")
    span(42, 44, "transport")
    d["45"] = "airlines"
    span(46, 47, "transport")
    d["48"] = "communication_services"
    d["49"] = "utilities"
    span(50, 51, "industrials")
    span(52, 59, "retail")
    span(60, 64, "financials")
    d["65"] = "real_estate"
    d["66"] = "financials"
    d["67"] = "financials"
    span(70, 72, "consumer_discretionary")
    span(73, 74, "technology")
    span(75, 77, "industrials")
    d["78"] = "communication_services"
    d["79"] = "consumer_discretionary"
    d["80"] = "healthcare"
    span(81, 86, "industrials")
    d["87"] = "industrials"
    d["88"] = "healthcare"
    d["89"] = "industrials"
    span(90, 98, "industrials")
    d["99"] = "default"  # Nonclassifiable — no coarse sector
    return d


SIC_TWO_DIGIT_FALLBACK: dict[str, str] = _build_two_digit_sector_fallback()


def normalize_sic_digits(raw: object) -> str:
    """Extract up to 4 SEC-style SIC digits from Polygon / cache payloads."""
    s = "".join(c for c in str(raw or "") if c.isdigit())
    if not s:
        return ""
    if len(s) > 4:
        s = s[-4:]
    return s


def resolve_sector_bucket_from_sic(sic_raw: object, exact_map: Mapping[str, str]) -> tuple[str, SicMappingTier]:
    """
    Return ``(internal sector bucket, mapping_tier)``.

    Uses exact SIC table first, then 3-digit, then 2-digit fallbacks. Returns ``("default", FALLBACK_SPY)``
    when unknown, excluded, or non-classifiable — callers map ``default`` to SPY.
    """
    sic = normalize_sic_digits(sic_raw)
    if not sic:
        return "default", SicMappingTier.FALLBACK_SPY
    if sic in _SIC_EXCLUDE_FROM_PREFIX:
        return "default", SicMappingTier.FALLBACK_SPY
    if sic in exact_map:
        return exact_map[sic], SicMappingTier.EXACT
    if len(sic) >= 3:
        p3 = sic[:3]
        if p3 in SIC_THREE_DIGIT_FALLBACK:
            return SIC_THREE_DIGIT_FALLBACK[p3], SicMappingTier.PREFIX
    if len(sic) >= 2:
        p2 = sic[:2]
        if p2 in SIC_TWO_DIGIT_FALLBACK:
            b = SIC_TWO_DIGIT_FALLBACK[p2]
            if b == "default":
                return "default", SicMappingTier.FALLBACK_SPY
            return b, SicMappingTier.COARSE
    return "default", SicMappingTier.FALLBACK_SPY
