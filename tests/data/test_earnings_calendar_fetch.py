"""Unified earnings fetch (Finnhub-first)."""

from __future__ import annotations

from datetime import date, timedelta

import httpx
import pytest
import respx

from stocvest.data.earnings_calendar_fetch import fetch_earnings_payload


@pytest.mark.asyncio
@respx.mock
async def test_fetch_earnings_payload_uses_finnhub(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FINNHUB_API_KEY", "test-finnhub")
    from stocvest.utils.config import get_settings

    get_settings.cache_clear()

    report_day = (date.today() + timedelta(days=2)).isoformat()
    respx.get("https://finnhub.io/api/v1/calendar/earnings").mock(
        return_value=httpx.Response(
            200,
            json={
                "earningsCalendar": [
                    {
                        "date": report_day,
                        "symbol": "DELL",
                        "hour": "amc",
                        "epsEstimate": 2.0,
                        "epsActual": None,
                    }
                ]
            },
        )
    )

    payload = await fetch_earnings_payload(["DELL"], days=14, polygon_client=None)
    assert payload["source"] == "finnhub"
    assert len(payload["upcoming"]) >= 1
    assert payload["upcoming"][0]["symbol"] == "DELL"
    assert payload["notice"] is None
