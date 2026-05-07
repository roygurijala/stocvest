"""Tests for :mod:`stocvest.data.fred_client`."""

from __future__ import annotations

import re

import httpx
import pytest
import respx

from stocvest.data.fred_client import FREDClient, FRED_RELEASES
from stocvest.signals.macro_event import MacroEventCategory


@pytest.fixture
def fred_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRED_API_KEY", "unit-test-fred-key")
    monkeypatch.setenv("STOCVEST_DISABLE_REDIS", "1")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _release_dates_payload(dates: list[str]) -> dict:
    return {"release_dates": [{"date": d} for d in dates]}


def _obs(value: str) -> dict:
    return {"observations": [{"date": "2026-05-06", "value": value}]}


@pytest.mark.asyncio
async def test_get_upcoming_events_returns_list(fred_api_key) -> None:
    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/release/dates\?.*")).mock(
            return_value=httpx.Response(200, json=_release_dates_payload([]))
        )
        client = FREDClient()
        events = await client.get_upcoming_events(days_ahead=14)
    assert isinstance(events, list)
    assert len(events) >= 1
    assert all(e.scheduled_time.tzinfo is not None for e in events)


@pytest.mark.asyncio
async def test_fomc_event_has_correct_time(fred_api_key) -> None:
    rid = FRED_RELEASES["fomc"]

    def side_effect(request: httpx.Request) -> httpx.Response:
        if f"release_id={rid}" in str(request.url):
            return httpx.Response(200, json=_release_dates_payload(["2026-06-17"]))
        return httpx.Response(200, json=_release_dates_payload([]))

    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/release/dates\?.*")).mock(side_effect=side_effect)
        client = FREDClient()
        events = await client.get_upcoming_events(days_ahead=60)
    fomc = [e for e in events if e.category == MacroEventCategory.FED]
    assert fomc
    assert fomc[0].scheduled_time.hour == 14
    assert fomc[0].scheduled_time.minute == 0


@pytest.mark.asyncio
async def test_cpi_event_has_correct_time(fred_api_key) -> None:
    rid = FRED_RELEASES["cpi"]

    def side_effect(request: httpx.Request) -> httpx.Response:
        if f"release_id={rid}" in str(request.url):
            return httpx.Response(200, json=_release_dates_payload(["2026-06-10"]))
        return httpx.Response(200, json=_release_dates_payload([]))

    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/release/dates\?.*")).mock(side_effect=side_effect)
        client = FREDClient()
        events = await client.get_upcoming_events(days_ahead=90)
    cpi = [e for e in events if e.category == MacroEventCategory.CPI]
    assert cpi
    assert cpi[0].scheduled_time.hour == 8
    assert cpi[0].scheduled_time.minute == 30


@pytest.mark.asyncio
async def test_yield_curve_spread_computed(fred_api_key) -> None:
    def obs_side_effect(request: httpx.Request) -> httpx.Response:
        u = str(request.url)
        if "DGS2" in u:
            return httpx.Response(200, json=_obs("4.2"))
        if "DGS10" in u:
            return httpx.Response(200, json=_obs("3.8"))
        return httpx.Response(200, json=_obs("."))

    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/series/observations\?.*")).mock(side_effect=obs_side_effect)
        client = FREDClient()
        yc = await client.get_yield_curve()
    assert yc is not None
    assert yc["spread"] == pytest.approx(-0.4)
    assert yc["regime"] == "inverted"
    assert "inverted" in yc["chip"].lower()


@pytest.mark.asyncio
async def test_yield_curve_normal(fred_api_key) -> None:
    def obs_side_effect(request: httpx.Request) -> httpx.Response:
        u = str(request.url)
        if "DGS2" in u:
            return httpx.Response(200, json=_obs("3.8"))
        if "DGS10" in u:
            return httpx.Response(200, json=_obs("4.5"))
        return httpx.Response(200, json=_obs("."))

    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/series/observations\?.*")).mock(side_effect=obs_side_effect)
        client = FREDClient()
        yc = await client.get_yield_curve()
    assert yc is not None
    assert yc["spread"] == pytest.approx(0.7)
    assert yc["regime"] == "normal"


@pytest.mark.asyncio
async def test_yield_curve_flat(fred_api_key) -> None:
    def obs_side_effect(request: httpx.Request) -> httpx.Response:
        u = str(request.url)
        if "DGS2" in u:
            return httpx.Response(200, json=_obs("4.0"))
        if "DGS10" in u:
            return httpx.Response(200, json=_obs("4.2"))
        return httpx.Response(200, json=_obs("."))

    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/series/observations\?.*")).mock(side_effect=obs_side_effect)
        client = FREDClient()
        yc = await client.get_yield_curve()
    assert yc is not None
    assert yc["spread"] == pytest.approx(0.2)
    assert yc["regime"] == "flat"


@pytest.mark.asyncio
async def test_fred_unavailable_returns_hardcoded(fred_api_key) -> None:
    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/.*")).mock(return_value=httpx.Response(500))
        client = FREDClient()
        events = await client.get_upcoming_events(days_ahead=400)
    assert events
    assert any("FOMC" in e.name for e in events)


@pytest.mark.asyncio
async def test_redis_cache_used_on_second_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FRED_API_KEY", "unit-test-fred-key")
    monkeypatch.setenv("STOCVEST_DISABLE_REDIS", "0")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    store: dict[str, str] = {}

    class _Fake:
        def get(self, k: str):
            return store.get(k)

        def setex(self, k: str, _ttl: int, v: str) -> None:
            store[k] = v

    fake = _Fake()
    monkeypatch.setattr("redis.Redis.from_url", lambda *a, **k: fake)

    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/release/dates\?.*")).mock(
            return_value=httpx.Response(200, json=_release_dates_payload([]))
        )
        client = FREDClient()
        await client.get_upcoming_events(days_ahead=7)
        n_first = len(respx.calls)

        await client.get_upcoming_events(days_ahead=7)
        n_second = len(respx.calls)

    assert n_second == n_first
    assert any(k.startswith("stocvest:fred:events:") for k in store)
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_dot_value_handled_as_none(fred_api_key) -> None:
    with respx.mock:
        respx.get(re.compile(r"https://api\.stlouisfed\.org/fred/series/observations\?.*")).mock(
            return_value=httpx.Response(200, json=_obs("."))
        )
        client = FREDClient()
        v = await client._fetch_latest_series("unit-test-fred-key", "DGS2")
    assert v is None
