"""Unit tests for the POS-D15 Position scan universe builder."""

from __future__ import annotations

import pytest

from stocvest.api.services.position_scan import POSITION_SCAN_UNIVERSE_V1
from stocvest.api.services.position_universe import assemble_universe, build_scan_universe

pytestmark = pytest.mark.unit

MIN_CAP = 1_000_000_000.0
MIN_ADV = 20_000_000.0


def _row(sym, cap, price, vol, *, name="Some Co", is_etf=False, is_fund=False):
    return {
        "symbol": sym,
        "companyName": name,
        "marketCap": cap,
        "price": price,
        "volume": vol,
        "isEtf": is_etf,
        "isFund": is_fund,
    }


def test_assemble_filters_excludes_and_sorts_by_cap() -> None:
    rows = [
        _row("AAA", 3e9, 100.0, 1_000_000),  # $100M ADV, $3B cap → pass
        _row("BBB", 5e9, 50.0, 2_000_000),  # $100M ADV, $5B cap → pass (bigger cap sorts first)
        _row("ETFX", 9e9, 100.0, 5_000_000, is_etf=True),  # ETF wrapper → excluded
        _row("SMALL", 5e8, 100.0, 1_000_000),  # $500M cap < $1B → micro-cap excluded
        _row("ILQ", 3e9, 1.0, 1_000_000),  # $1M ADV < $20M → illiquid excluded
        _row("TQQQ", 9e9, 100.0, 9_000_000),  # leveraged blocklist → excluded
        _row("SHELL", 3e9, 100.0, 1_000_000, name="Foo Acquisition Corp"),  # SPAC name → excluded
    ]
    out = assemble_universe(
        rows, min_market_cap_usd=MIN_CAP, min_avg_dollar_volume_usd=MIN_ADV, max_size=10
    )
    assert out == ["BBB", "AAA"]


def test_assemble_caps_to_max_size() -> None:
    rows = [_row("BBB", 5e9, 50.0, 2_000_000), _row("AAA", 3e9, 100.0, 1_000_000)]
    out = assemble_universe(
        rows, min_market_cap_usd=MIN_CAP, min_avg_dollar_volume_usd=MIN_ADV, max_size=1
    )
    assert out == ["BBB"]


def test_assemble_dedups_symbols() -> None:
    rows = [_row("AAA", 3e9, 100.0, 1_000_000), _row("aaa", 3e9, 100.0, 1_000_000)]
    out = assemble_universe(
        rows, min_market_cap_usd=MIN_CAP, min_avg_dollar_volume_usd=MIN_ADV, max_size=10
    )
    assert out == ["AAA"]


def test_assemble_empty_falls_back_to_curated() -> None:
    out = assemble_universe(
        [], min_market_cap_usd=MIN_CAP, min_avg_dollar_volume_usd=MIN_ADV, max_size=500
    )
    assert out[:3] == ["AAPL", "MSFT", "GOOGL"]
    assert len(out) == len(POSITION_SCAN_UNIVERSE_V1)


def test_assemble_all_excluded_falls_back() -> None:
    rows = [_row("SMALL", 1e8, 100.0, 1_000_000)]  # micro-cap → nothing usable
    out = assemble_universe(
        rows, min_market_cap_usd=MIN_CAP, min_avg_dollar_volume_usd=MIN_ADV, max_size=500
    )
    assert out[:1] == ["AAPL"]  # curated fallback


@pytest.mark.asyncio
async def test_build_scan_universe_uses_fetch() -> None:
    async def _fetch(*, min_market_cap, limit):
        assert min_market_cap >= 0 and limit > 0
        return [_row("BBB", 5e9, 50.0, 2_000_000), _row("AAA", 3e9, 100.0, 1_000_000)]

    out = await build_scan_universe(max_size=10, fetch=_fetch)
    assert out == ["BBB", "AAA"]


@pytest.mark.asyncio
async def test_build_scan_universe_fallback_on_fetch_error() -> None:
    async def _boom(**_kw):
        raise RuntimeError("screener down")

    out = await build_scan_universe(fetch=_boom)
    assert out[:1] == ["AAPL"]  # curated fallback, never empty


@pytest.mark.asyncio
async def test_build_scan_universe_fallback_on_empty() -> None:
    async def _empty(**_kw):
        return []

    out = await build_scan_universe(fetch=_empty)
    assert out[:1] == ["AAPL"]
