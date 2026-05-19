"""Price cache for laggard engine (Chunk 3 — mocked Polygon/Redis)."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from stocvest.data.models import Bar, Timeframe
from stocvest.data import price_cache as pc
from stocvest.data.price_cache import (
    PriceCache,
    compute_1d_change_pct,
    compute_5d_change_pct,
    compute_vol_avg_20d,
)


def _bar(sym: str, close: float, volume: float, day: int) -> Bar:
    return Bar(
        symbol=sym,
        timestamp=datetime(2026, 1, day, tzinfo=timezone.utc),
        timeframe=Timeframe.DAY_1,
        open=close,
        high=close,
        low=close,
        close=close,
        volume=volume,
    )


def _closes(n: int, start: float = 100.0, step: float = 1.0) -> list[float]:
    return [start + i * step for i in range(n)]


class _FakeRedis:
    def __init__(self) -> None:
        self.data: dict[str, str] = {}
        self.setex_calls: list[tuple[str, int, str]] = []

    def get(self, key: str) -> str | None:
        return self.data.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.setex_calls.append((key, ttl, value))
        self.data[key] = value

    def pipeline(self) -> _FakeRedis:
        return self

    def execute(self) -> list[None]:
        return []


def test_5d_change_computed_correctly() -> None:
    closes = _closes(7, 100.0, 1.0)
    # last=106, five back=101 -> (106-101)/101*100
    pct = compute_5d_change_pct(closes)
    assert pct is not None
    assert abs(pct - (5.0 / 101.0 * 100.0)) < 1e-6


def test_vol_avg_20d_computed_correctly() -> None:
    vols = [float(i) for i in range(1, 21)]
    avg = compute_vol_avg_20d(vols)
    assert avg is not None
    assert abs(avg - 10.5) < 1e-6


def test_1d_change_from_close_history() -> None:
    closes = [100.0, 102.0]
    assert compute_1d_change_pct(closes) == 2.0


def test_is_cached_true_after_warm(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    fake.data["stocvest:price:NVDA:updated_at"] = "2026-05-18T12:00:00+00:00"
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    assert PriceCache().is_cached("nvda") is True


def test_is_cached_false_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pc, "get_sync_redis", lambda: _FakeRedis())
    assert PriceCache().is_cached("ZZZ") is False


def test_get_returns_none_not_cached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pc, "get_sync_redis", lambda: _FakeRedis())
    cache = PriceCache()
    assert cache.get_5d_change("AAPL") is None
    assert cache.get_vol_avg_20d("AAPL") is None
    assert cache.get_close_history("AAPL") is None


@pytest.mark.asyncio
async def test_warm_handles_polygon_error_gracefully(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()

    def _pipe(self: _FakeRedis) -> _FakeRedis:
        self.setex_calls = []

        def setex(key: str, ttl: int, value: str) -> None:
            self.setex_calls.append((key, ttl, value))
            self.data[key] = value

        self.setex = setex  # type: ignore[method-assign]
        return self

    _FakeRedis.pipeline = _pipe  # type: ignore[attr-defined]

    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    client = AsyncMock()
    client.get_bars = AsyncMock(side_effect=RuntimeError("polygon down"))
    out = await PriceCache().warm(["AAPL", "MSFT"], client, concurrency=2)
    assert out == {"cached": 0, "errors": 2}


@pytest.mark.asyncio
async def test_warm_respects_concurrency_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    in_flight = 0
    max_seen = 0
    lock = asyncio.Lock()

    async def slow_bars(sym: str, tf: Timeframe, *, limit: int = 200) -> list[Bar]:
        nonlocal in_flight, max_seen
        async with lock:
            in_flight += 1
            max_seen = max(max_seen, in_flight)
        await asyncio.sleep(0.02)
        async with lock:
            in_flight -= 1
        return [_bar(sym, 100.0, 1e6, 1) for _ in range(25)]

    client = AsyncMock()
    client.get_bars = slow_bars
    syms = [f"S{i}" for i in range(12)]
    await PriceCache().warm(syms, client, concurrency=10)
    assert max_seen <= 10


@pytest.mark.asyncio
async def test_close_history_returns_last_n(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = _FakeRedis()
    fake.data["stocvest:price:AMD:close_history"] = json.dumps([1.0, 2.0, 3.0, 4.0, 5.0])
    monkeypatch.setattr(pc, "get_sync_redis", lambda: fake)
    hist = PriceCache().get_close_history("AMD", n=3)
    assert hist == [3.0, 4.0, 5.0]


@pytest.mark.asyncio
async def test_warm_stores_metrics(monkeypatch: pytest.MonkeyPatch) -> None:
    store: dict[str, str] = {}

    class _R:
        def pipeline(self) -> _R:
            return self

        def setex(self, key: str, ttl: int, value: str) -> None:
            store[key] = value

        def execute(self) -> list[None]:
            return []

        def get(self, key: str) -> str | None:
            return store.get(key)

    monkeypatch.setattr(pc, "get_sync_redis", lambda: _R())

    closes = _closes(25, 100.0, 0.5)
    bars = [_bar("NVDA", c, 1_000_000.0, i + 1) for i, c in enumerate(closes)]

    client = AsyncMock()
    client.get_bars = AsyncMock(return_value=bars)

    out = await PriceCache().warm(["NVDA"], client)
    assert out["cached"] == 1
    assert out["errors"] == 0

    cache = PriceCache()
    assert cache.is_cached("NVDA")
    assert cache.get_5d_change("NVDA") is not None
    assert cache.get_vol_avg_20d("NVDA") == 1_000_000.0
    hist = cache.get_close_history("NVDA", n=10)
    assert hist is not None
    assert len(hist) == 10
