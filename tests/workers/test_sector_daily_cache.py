from unittest.mock import AsyncMock

import pytest

from stocvest.config.sector_etf_defaults import DEFAULT_SECTOR_TO_ETF
from stocvest.signals.sector_momentum import ETF_DISPLAY_NAMES
from stocvest.workers import sector_daily_cache as sdc
from stocvest.workers.sector_daily_cache import (
    SECTOR_ETFS_TO_TRACK,
    DailyReturn,
    compute_daily_returns_for_etf,
    get_cached_sector_returns,
    update_sector_daily_cache,
)


def test_every_benchmark_etf_is_warmed() -> None:
    """Every ETF the composite sector layer can resolve to (``DEFAULT_SECTOR_TO_ETF``)
    MUST be warmed by the daily cache — otherwise that sector silently degrades to
    the single-day live-snapshot fallback instead of multi-day persistence momentum.

    This is the regression guard for the P66 ETF-coverage gap: biotech/pharma/
    retail/airlines/defense/transport/mining/medical-devices benchmarks were mapped
    but never warmed.
    """
    warmed = set(SECTOR_ETFS_TO_TRACK)
    mapped = set(DEFAULT_SECTOR_TO_ETF.values())
    missing = mapped - warmed
    assert not missing, f"benchmark ETFs mapped but not warmed by sector_daily_cache: {sorted(missing)}"


def test_no_duplicate_tracked_etfs() -> None:
    assert len(SECTOR_ETFS_TO_TRACK) == len(set(SECTOR_ETFS_TO_TRACK))


def test_warmed_etfs_have_display_names() -> None:
    """Non-SPY warmed ETFs should have a human-readable momentum display name so the
    sector layer/UI never shows a bare ticker for a benchmark we actively track."""
    missing = [e for e in SECTOR_ETFS_TO_TRACK if e != "SPY" and e not in ETF_DISPLAY_NAMES]
    assert not missing, f"warmed ETFs missing a display name: {missing}"


@pytest.mark.asyncio
async def test_compute_daily_returns_for_etf_spread(monkeypatch: pytest.MonkeyPatch) -> None:
    # compute_daily_returns_for_etf needs >=2 overlapping dates between SPY bars and ETF fetch.
    spy_rows = [
        {"date": "2024-01-04", "o": 100.0, "c": 100.0, "v": 1e9, "vw": 100.0},
        {"date": "2024-01-05", "o": 100.0, "c": 101.0, "v": 1e9, "vw": 100.5},
    ]
    etf_rows = [
        {"date": "2024-01-04", "o": 100.0, "c": 100.0, "v": 1e9, "vw": 100.0},
        {"date": "2024-01-05", "o": 100.0, "c": 102.0, "v": 1e9, "vw": 101.0},
    ]

    async def fb(ticker: str, *_a, **_k):
        if str(ticker).upper() == "XLE":
            return etf_rows
        return []

    monkeypatch.setattr(sdc, "fetch_etf_daily_bars", fb)
    out = await compute_daily_returns_for_etf("XLE", spy_rows, AsyncMock())
    assert len(out) >= 1
    last = out[-1]
    assert abs(last.etf_pct - 2.0) < 1e-6
    assert abs(last.spy_pct - 1.0) < 1e-6
    assert abs(last.relative - 1.0) < 1e-6
    assert last.outperformed is True


def test_returns_sorted_oldest_to_newest() -> None:
    a = DailyReturn("2024-01-03", 0, 0, 1.0, True, 1)
    b = DailyReturn("2024-01-04", 0, 0, 2.0, True, 1)
    assert a.date < b.date


@pytest.mark.asyncio
async def test_update_sector_daily_cache_writes_redis(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, int, bytes]] = []

    class _R:
        def setex(self, k, ttl, payload):
            calls.append((k.decode() if isinstance(k, bytes) else str(k), ttl, payload))

        def get(self, _k):
            return None

    monkeypatch.setattr(sdc, "get_sync_redis", lambda: _R())
    spy_rows = [
        {"date": "2024-01-04", "o": 100.0, "c": 100.0, "v": 1e9, "vw": 100.0},
        {"date": "2024-01-05", "o": 100.0, "c": 101.0, "v": 1e9, "vw": 100.5},
    ]
    etf_like = [
        {"date": "2024-01-04", "o": 100.0, "c": 100.0, "v": 1e9, "vw": 100.0},
        {"date": "2024-01-05", "o": 100.0, "c": 102.0, "v": 1e9, "vw": 101.0},
    ]

    async def fake_fetch(ticker, _client, sessions=7):
        t = str(ticker).upper()
        if t == "SPY":
            return spy_rows
        return list(etf_like)

    monkeypatch.setattr(sdc, "fetch_etf_daily_bars", fake_fetch)
    await update_sector_daily_cache(polygon_client=AsyncMock())
    assert len(calls) >= 1


def test_get_cached_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sdc, "get_sync_redis", lambda: None)
    monkeypatch.setattr(sdc, "_read_sector_daily_dynamo", lambda _etf: None)
    assert get_cached_sector_returns("XLE") is None
