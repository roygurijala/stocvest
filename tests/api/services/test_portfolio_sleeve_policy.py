"""Conviction-sleeve mapping and band scaling (personal portfolio review)."""

from __future__ import annotations

import pytest

from stocvest.api.services.portfolio_sleeve_policy import (
    SINGLE_NAME_MAX_PCT,
    PositionSleeve,
    SleevePolicy,
    resolve_position_sleeve,
    resolve_sleeve_policy,
    scale_sleeve_policies,
    sleeve_policy_for,
    weight_vs_sleeve,
)

pytestmark = pytest.mark.unit


def test_core_is_bullish_operating_company() -> None:
    assert (
        resolve_position_sleeve(verdict="bullish", stance="constructive")
        == PositionSleeve.CORE
    )


def test_bullish_hold_is_still_core() -> None:
    """Constructive gates adding, not the sleeve. A bullish Hold may sit at 10–15%."""
    assert resolve_position_sleeve(verdict="bullish", stance="caution") == PositionSleeve.CORE
    assert resolve_position_sleeve(verdict="bullish") == PositionSleeve.CORE


def test_vehicle_beats_core() -> None:
    assert (
        resolve_position_sleeve(
            is_fund_vehicle=True, verdict="bullish", stance="constructive"
        )
        == PositionSleeve.VEHICLE
    )


def test_bearish_defensive_is_exit_even_for_vehicle() -> None:
    assert (
        resolve_position_sleeve(
            is_fund_vehicle=True, verdict="bearish", stance="defensive"
        )
        == PositionSleeve.EXIT
    )


def test_structure_broken_operating_company_is_exit() -> None:
    assert (
        resolve_position_sleeve(
            verdict="neutral", stance="caution", structure_broken=True
        )
        == PositionSleeve.EXIT
    )


def test_structure_broken_vehicle_stays_vehicle() -> None:
    assert (
        resolve_position_sleeve(
            is_fund_vehicle=True,
            verdict="neutral",
            stance="defensive",
            structure_broken=True,
        )
        == PositionSleeve.VEHICLE
    )


def test_standard_is_the_fallback() -> None:
    assert resolve_position_sleeve(verdict="neutral", stance="caution") == PositionSleeve.STANDARD
    assert resolve_position_sleeve() == PositionSleeve.STANDARD


def test_bands_match_agreed_policy() -> None:
    assert sleeve_policy_for(PositionSleeve.CORE) == SleevePolicy(
        PositionSleeve.CORE, 10.0, 15.0
    )
    assert sleeve_policy_for(PositionSleeve.STANDARD) == SleevePolicy(
        PositionSleeve.STANDARD, 6.0, 9.0
    )
    assert sleeve_policy_for(PositionSleeve.VEHICLE) == SleevePolicy(
        PositionSleeve.VEHICLE, 4.0, 6.0
    )
    assert sleeve_policy_for(PositionSleeve.EXIT) == SleevePolicy(
        PositionSleeve.EXIT, 0.0, 3.0
    )
    assert sleeve_policy_for(PositionSleeve.CORE).high_pct <= SINGLE_NAME_MAX_PCT


def test_weight_inside_band_is_neither_over_nor_under() -> None:
    policy = resolve_sleeve_policy(verdict="bullish", stance="constructive")
    over, under = weight_vs_sleeve(11.0, policy)
    assert over is False and under is False


def test_weight_above_high_is_over() -> None:
    policy = resolve_sleeve_policy(is_fund_vehicle=True)
    over, under = weight_vs_sleeve(11.8, policy)
    assert over is True and under is False


def test_scale_is_noop_when_highs_fit() -> None:
    policies = [
        sleeve_policy_for(PositionSleeve.CORE),
        sleeve_policy_for(PositionSleeve.VEHICLE),
    ]
    assert scale_sleeve_policies(policies) == policies


def test_scale_compresses_when_highs_exceed_100() -> None:
    policies = [sleeve_policy_for(PositionSleeve.CORE) for _ in range(12)]
    scaled = scale_sleeve_policies(policies)
    assert sum(p.high_pct for p in scaled) == pytest.approx(100.0, abs=0.02)
    assert scaled[0].high_pct < 15.0
    assert scaled[0].low_pct < scaled[0].high_pct
    assert scaled[0].sleeve == PositionSleeve.CORE
