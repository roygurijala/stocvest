"""Unit tests for the POS-D15 Position scan universe builder."""

from __future__ import annotations

import pytest

from stocvest.api.services.position_scan import POSITION_SCAN_UNIVERSE_V1
from stocvest.api.services.position_universe import (
    DISCOVERY_FETCH_LIMIT,
    assemble_universe,
    build_live_scan_universe,
    build_scan_universe,
    merge_scan_universe,
)
from stocvest.signals.position_gem_gates import MEGA_CAP_USD

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


def test_assemble_discovery_excludes_mega_and_prefers_mid() -> None:
    rows = [
        _row("MEGA", 400e9, 100.0, 5_000_000),  # mega → dropped from the hunt
        _row("LARGE", 80e9, 100.0, 2_000_000),  # large-not-mega, after mid
        _row("MIDB", 8e9, 50.0, 2_000_000),
        _row("MIDA", 5e9, 100.0, 1_000_000),
    ]
    out = assemble_universe(
        rows,
        min_market_cap_usd=MIN_CAP,
        min_avg_dollar_volume_usd=MIN_ADV,
        max_size=10,
        exclude_mega=True,
        prefer_mid_cap=True,
    )
    assert out == ["MIDB", "MIDA", "LARGE"]


def test_assemble_discovery_empty_does_not_fall_back_to_mega_stub() -> None:
    out = assemble_universe(
        [],
        min_market_cap_usd=MIN_CAP,
        min_avg_dollar_volume_usd=MIN_ADV,
        max_size=10,
        exclude_mega=True,
    )
    assert out == []


def test_merge_scan_universe_discovery_then_curated() -> None:
    assert merge_scan_universe(["RKLB", "AAPL"])[:3] == ["RKLB", "AAPL", "MSFT"]


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


@pytest.mark.asyncio
async def test_build_scan_universe_discovery_fetches_non_mega_pool() -> None:
    seen: dict[str, object] = {}

    async def _fetch(*, min_market_cap, limit, max_market_cap=None):
        seen["min"] = min_market_cap
        seen["limit"] = limit
        seen["max"] = max_market_cap
        return [_row("RKLB", 8e9, 50.0, 2_000_000), _row("MEGA", 400e9, 100.0, 5_000_000)]

    out = await build_scan_universe(max_size=10, fetch=_fetch, discovery=True)
    assert seen["limit"] == DISCOVERY_FETCH_LIMIT
    assert seen["max"] == MEGA_CAP_USD
    assert out == ["RKLB"]


@pytest.mark.asyncio
async def test_build_live_scan_universe_discovery_then_curated() -> None:
    async def _fetch(*, min_market_cap, limit, max_market_cap=None):
        assert min_market_cap >= 0 and limit >= DISCOVERY_FETCH_LIMIT
        assert max_market_cap == MEGA_CAP_USD
        return [
            _row("MEGA", 400e9, 100.0, 5_000_000),
            _row("RKLB", 8e9, 50.0, 2_000_000),
        ]

    out = await build_live_scan_universe(fetch=_fetch)
    assert out[0] == "RKLB"
    assert "MEGA" not in out
    assert "AAPL" in out
