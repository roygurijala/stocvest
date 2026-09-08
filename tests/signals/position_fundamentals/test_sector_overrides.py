"""Sector override stub tests."""

from __future__ import annotations

import pytest

from stocvest.signals.position_fundamentals.sector_overrides import resolve_sector_override_flags


@pytest.mark.unit
def test_banks_use_roa() -> None:
    flags = resolve_sector_override_flags("banks")
    assert flags.use_roa_not_roic is True


@pytest.mark.unit
def test_biotech_de_weights_valuation() -> None:
    flags = resolve_sector_override_flags("biotech")
    assert flags.de_weight_valuation is True


@pytest.mark.unit
def test_default_sector_no_flags() -> None:
    flags = resolve_sector_override_flags("technology")
    assert flags.use_roa_not_roic is False
    assert flags.de_weight_valuation is False
