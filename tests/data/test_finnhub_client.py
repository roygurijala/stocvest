"""Finnhub earnings client (HTTP mocked)."""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx

from stocvest.data.finnhub_client import get_earnings_calendar, get_market_earnings_calendar


@pytest.mark.asyncio
@respx.mock
async def test_get_earnings_calendar_parses_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINNHUB_API_KEY", "test-finnhub")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    respx.get("https://finnhub.io/api/v1/calendar/earnings").mock(
        return_value=httpx.Response(
            200,
            json={
                "earningsCalendar": [
                    {
                        "date": "2026-05-28",
                        "symbol": "DELL",
                        "hour": "amc",
                        "epsEstimate": 1.0,
                        "epsActual": 1.15,
                    }
                ]
            },
        )
    )

    rows = await get_earnings_calendar(
        ["DELL"],
        from_date=date(2026, 5, 27),
        to_date=date(2026, 5, 29),
    )
    assert len(rows) == 1
    assert rows[0].symbol == "DELL"
    assert rows[0].report_time == "after_market"
    assert rows[0].actual_eps == 1.15


@pytest.mark.asyncio
@respx.mock
async def test_get_market_earnings_calendar_returns_all_symbols(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINNHUB_API_KEY", "test-finnhub")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    respx.get("https://finnhub.io/api/v1/calendar/earnings").mock(
        return_value=httpx.Response(
            200,
            json={
                "earningsCalendar": [
                    {"date": "2026-06-03", "symbol": "CRWD", "hour": "amc", "epsEstimate": 1.09},
                    {"date": "2026-06-04", "symbol": "AVGO", "hour": "amc", "epsEstimate": 1.5},
                    {"date": "2026-06-02", "symbol": "ZS", "hour": "amc", "epsEstimate": 0.8},
                ]
            },
        )
    )

    rows = await get_market_earnings_calendar(
        from_date=date(2026, 6, 1),
        to_date=date(2026, 6, 5),
    )
    assert len(rows) == 3
    assert {r.symbol for r in rows} == {"CRWD", "AVGO", "ZS"}
