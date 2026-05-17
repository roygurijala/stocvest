"""FMP client — optional fundamentals (revenue trend + earnings calendar)."""

from __future__ import annotations

from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from stocvest.data.fmp_client import get_revenue_trend, get_upcoming_earnings_date


@pytest.mark.asyncio
async def test_get_revenue_trend_unknown_without_api_key() -> None:
    with patch("stocvest.data.fmp_client._api_key", return_value=""):
        assert await get_revenue_trend("AAPL") == "unknown"


@pytest.mark.asyncio
async def test_get_revenue_trend_growing_yoy() -> None:
    rows = [
        {"date": "2025-03-31", "revenue": 110_000_000},
        {"date": "2024-12-31", "revenue": 105_000_000},
        {"date": "2024-03-31", "revenue": 90_000_000},
        {"date": "2023-12-31", "revenue": 88_000_000},
    ]

    class FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return rows

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get(self, *a, **k):
            return FakeResp()

    with (
        patch("stocvest.data.fmp_client._api_key", return_value="test-key"),
        patch("stocvest.data.fmp_client._cache_get", return_value=None),
        patch("stocvest.data.fmp_client._cache_set"),
        patch("stocvest.data.fmp_client.httpx.AsyncClient", FakeClient),
    ):
        assert await get_revenue_trend("AAPL") == "growing"


@pytest.mark.asyncio
async def test_get_upcoming_earnings_date_from_calendar() -> None:
    target = date(2026, 5, 22)

    class FakeResp:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return [{"date": target.isoformat(), "symbol": "MSFT"}]

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get(self, *a, **k):
            return FakeResp()

    with (
        patch("stocvest.data.fmp_client._api_key", return_value="test-key"),
        patch("stocvest.data.fmp_client._cache_get", return_value=None),
        patch("stocvest.data.fmp_client._cache_set"),
        patch("stocvest.data.fmp_client.httpx.AsyncClient", FakeClient),
        patch("stocvest.data.fmp_client.datetime") as dt_mock,
    ):
        dt_mock.now.return_value.date.return_value = date(2026, 5, 16)
        got = await get_upcoming_earnings_date("MSFT", window_days=30)
    assert got == target


@pytest.mark.asyncio
async def test_get_revenue_trend_never_raises_on_http_error() -> None:
    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return None

        async def get(self, *a, **k):
            raise RuntimeError("network down")

    with (
        patch("stocvest.data.fmp_client._api_key", return_value="test-key"),
        patch("stocvest.data.fmp_client._cache_get", return_value=None),
        patch("stocvest.data.fmp_client._cache_set"),
        patch("stocvest.data.fmp_client.httpx.AsyncClient", FakeClient),
    ):
        assert await get_revenue_trend("ZZZ") == "unknown"
