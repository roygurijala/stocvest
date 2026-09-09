"""Position universe hygiene filter (gem gate G8) — ADR-004 POS-D11."""

from __future__ import annotations

import pytest

from stocvest.signals.position_universe_filter import (
    REASON_ILLIQUID,
    REASON_LEVERAGED_INVERSE,
    REASON_MICRO_CAP,
    REASON_SPAC_SHELL,
    is_leveraged_or_inverse,
    is_spac_shell,
    passes_position_universe_filter,
    position_universe_exclusion_reason,
)

pytestmark = pytest.mark.unit


def test_plain_equity_passes() -> None:
    assert passes_position_universe_filter("AAPL") is True
    assert position_universe_exclusion_reason("AAPL") is None


@pytest.mark.parametrize("sym", ["SQQQ", "TQQQ", "NVDQ", "TSLL", "UVIX", "BOIL"])
def test_leveraged_inverse_symbols_excluded(sym: str) -> None:
    assert is_leveraged_or_inverse(sym) is True
    assert position_universe_exclusion_reason(sym) == REASON_LEVERAGED_INVERSE


def test_leveraged_inverse_by_name_marker() -> None:
    # Symbol unknown, but the fund name betrays a leveraged product.
    assert is_leveraged_or_inverse("XYZ", "Direxion Daily Semiconductor Bull 3X Shares") is True
    assert (
        position_universe_exclusion_reason("XYZ", company_name="ProShares UltraPro QQQ")
        == REASON_LEVERAGED_INVERSE
    )


def test_spac_shell_by_name() -> None:
    assert is_spac_shell("Churchill Capital Acquisition Corp") is True
    assert (
        position_universe_exclusion_reason("CCIV", company_name="Foo Acquisition Corp")
        == REASON_SPAC_SHELL
    )
    assert is_spac_shell("Apple Inc.") is False


def test_micro_cap_gate_applies_only_with_data() -> None:
    # No data -> graceful pass.
    assert position_universe_exclusion_reason("TINY", min_market_cap_usd=500_000_000, min_avg_dollar_volume_usd=0) is None
    # Below the cap floor -> excluded.
    assert (
        position_universe_exclusion_reason(
            "TINY",
            market_cap=100_000_000,
            min_market_cap_usd=500_000_000,
            min_avg_dollar_volume_usd=0,
        )
        == REASON_MICRO_CAP
    )
    # At/above the floor -> passes.
    assert (
        position_universe_exclusion_reason(
            "BIG",
            market_cap=800_000_000,
            min_market_cap_usd=500_000_000,
            min_avg_dollar_volume_usd=0,
        )
        is None
    )


def test_illiquidity_gate() -> None:
    assert (
        position_universe_exclusion_reason(
            "THIN",
            avg_dollar_volume=1_000_000,
            min_market_cap_usd=0,
            min_avg_dollar_volume_usd=20_000_000,
        )
        == REASON_ILLIQUID
    )
    assert (
        position_universe_exclusion_reason(
            "LIQ",
            avg_dollar_volume=50_000_000,
            min_market_cap_usd=0,
            min_avg_dollar_volume_usd=20_000_000,
        )
        is None
    )


def test_leveraged_takes_precedence_over_liquidity() -> None:
    # A leveraged ETF is excluded for the right reason even if it is huge/liquid.
    assert (
        position_universe_exclusion_reason(
            "SQQQ",
            market_cap=5_000_000_000,
            avg_dollar_volume=1_000_000_000,
        )
        == REASON_LEVERAGED_INVERSE
    )


def test_zero_threshold_disables_gate() -> None:
    assert (
        position_universe_exclusion_reason(
            "TINY",
            market_cap=1.0,
            min_market_cap_usd=0,
            min_avg_dollar_volume_usd=0,
        )
        is None
    )
