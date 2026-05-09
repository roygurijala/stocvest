"""Tests for coarse SIC → sector bucket resolution."""

from stocvest.signals.sector_mapper import SIC_TO_SECTOR
from stocvest.signals.sector_sic_fallback import (
    SicMappingTier,
    normalize_sic_digits,
    resolve_sector_bucket_from_sic,
)


def test_normalize_sic_strips_non_digits() -> None:
    assert normalize_sic_digits("SIC 8742") == "8742"
    assert normalize_sic_digits("US08742") == "8742"


def test_resolve_exact_precedes_prefix() -> None:
    b, t = resolve_sector_bucket_from_sic("7372", SIC_TO_SECTOR)
    assert b == "software"
    assert t == SicMappingTier.EXACT


def test_resolve_three_digit_consulting() -> None:
    b, t = resolve_sector_bucket_from_sic("8749", SIC_TO_SECTOR)
    assert b == "industrials"
    assert t == SicMappingTier.PREFIX


def test_resolve_two_digit_manufacturing() -> None:
    b, t = resolve_sector_bucket_from_sic("2099", SIC_TO_SECTOR)
    assert b == "industrials"
    assert t == SicMappingTier.COARSE


def test_resolve_9999_stays_default() -> None:
    b, t = resolve_sector_bucket_from_sic("9999", SIC_TO_SECTOR)
    assert b == "default"
    assert t == SicMappingTier.FALLBACK_SPY


def test_resolve_empty_default() -> None:
    b, t = resolve_sector_bucket_from_sic("", SIC_TO_SECTOR)
    assert b == "default" and t == SicMappingTier.FALLBACK_SPY
    b2, t2 = resolve_sector_bucket_from_sic(None, SIC_TO_SECTOR)
    assert b2 == "default" and t2 == SicMappingTier.FALLBACK_SPY
