from unittest.mock import AsyncMock

import pytest

from stocvest.workers import sector_daily_cache as sdc
from stocvest.workers.sector_daily_cache import (
    DailyReturn,
    compute_daily_returns_for_etf,
    get_cached_sector_returns,
    update_sector_daily_cache,
)


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
