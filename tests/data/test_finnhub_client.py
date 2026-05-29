"""Finnhub earnings client (HTTP mocked)."""

from __future__ import annotations

from datetime import date

import httpx
import pytest
import respx

from stocvest.data.finnhub_client import get_earnings_calendar


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
