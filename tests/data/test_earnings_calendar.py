"""Upcoming earnings horizon resolver (Phase A fundamentals context)."""

from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from stocvest.data.earnings_calendar import (
    EarningsHorizon,
    classify_earnings_risk,
    clear_earnings_horizon_cache,
    earnings_horizon_to_api_fields,
    resolve_upcoming_earnings_horizon,
)
from stocvest.data.models import EarningsEvent


@pytest.mark.parametrize(
    ("days", "risk", "has_chip"),
    [
        (0, "imminent", True),
        (1, "imminent", True),
        (2, "elevated", True),
        (3, "elevated", True),
        (5, "watch", True),
        (7, "watch", True),
        (14, "normal", False),
    ],
)
def test_classify_earnings_risk(days: int, risk: str, has_chip: bool) -> None:
    level, chip = classify_earnings_risk(days)
    assert level == risk
    assert (chip is not None) is has_chip


def test_earnings_horizon_to_api_fields() -> None:
    h = EarningsHorizon(
        report_date=date(2026, 5, 20),
        days_away=3,
        risk="elevated",
        report_time="after_market",
        chip="⚠️ Earnings in 3 days",
    )
    fields = earnings_horizon_to_api_fields(h)
    assert fields["upcoming_earnings_date"] == "2026-05-20"
    assert fields["earnings_days_away"] == 3
    assert fields["earnings_risk"] == "elevated"
    assert fields["earnings_report_time"] == "after_market"
    assert fields["earnings_chip"] == "⚠️ Earnings in 3 days"


@pytest.mark.asyncio
async def test_resolve_prefers_benzinga_then_polygon() -> None:
    clear_earnings_horizon_cache()
    today = date(2026, 5, 16)
    bz_date = today + timedelta(days=2)
    poly_event = EarningsEvent(
        symbol="AAPL",
        company_name="Apple",
        report_date=today + timedelta(days=10),
        report_time="before_market",
    )

    class FakePoly:
        get_earnings_calendar = AsyncMock(return_value=[poly_event])

    with (
        patch("stocvest.data.earnings_calendar.datetime") as dt_mock,
        patch(
            "stocvest.data.earnings_calendar._from_benzinga",
            new=AsyncMock(return_value=bz_date),
        ),
    ):
        dt_mock.now.return_value.date.return_value = today
        h = await resolve_upcoming_earnings_horizon("AAPL", polygon_client=FakePoly())  # type: ignore[arg-type]

    assert h is not None
    assert h.report_date == bz_date
    assert h.days_away == 2
    assert h.risk == "elevated"


@pytest.mark.asyncio
async def test_resolve_polygon_fallback_when_benzinga_empty() -> None:
    clear_earnings_horizon_cache("MSFT")
    today = date(2026, 5, 16)
    poly_event = EarningsEvent(
        symbol="MSFT",
        company_name="Microsoft",
        report_date=today + timedelta(days=4),
        report_time="after_market",
    )

    class FakePoly:
        get_earnings_calendar = AsyncMock(return_value=[poly_event])

    with (
        patch("stocvest.data.earnings_calendar.datetime") as dt_mock,
        patch("stocvest.data.earnings_calendar._from_benzinga", new=AsyncMock(return_value=None)),
    ):
        dt_mock.now.return_value.date.return_value = today
        h = await resolve_upcoming_earnings_horizon("MSFT", polygon_client=FakePoly())  # type: ignore[arg-type]

    assert h is not None
    assert h.days_away == 4
    assert h.report_time == "after_market"
    assert h.risk == "watch"


@pytest.mark.asyncio
async def test_resolve_fmp_fallback_when_benzinga_and_polygon_empty() -> None:
    clear_earnings_horizon_cache("MSFT")
    today = date(2026, 5, 16)
    fmp_date = today + timedelta(days=5)

    class FakePoly:
        get_earnings_calendar = AsyncMock(return_value=[])

    with (
        patch("stocvest.data.earnings_calendar.datetime") as dt_mock,
        patch("stocvest.data.earnings_calendar._from_benzinga", new=AsyncMock(return_value=None)),
        patch(
            "stocvest.data.fmp_client.get_upcoming_earnings_date",
            new=AsyncMock(return_value=fmp_date),
        ),
    ):
        dt_mock.now.return_value.date.return_value = today
        h = await resolve_upcoming_earnings_horizon("MSFT", polygon_client=FakePoly())  # type: ignore[arg-type]

    assert h is not None
    assert h.report_date == fmp_date
    assert h.days_away == 5


@pytest.mark.asyncio
async def test_resolve_never_raises_on_provider_errors() -> None:
    clear_earnings_horizon_cache("ZZZ")

    class FakePoly:
        get_earnings_calendar = AsyncMock(side_effect=RuntimeError("down"))

    with (
        patch("stocvest.data.earnings_calendar.datetime") as dt_mock,
        patch("stocvest.data.earnings_calendar._from_benzinga", new=AsyncMock(side_effect=RuntimeError("bz"))),
    ):
        dt_mock.now.return_value.date.return_value = date(2026, 5, 16)
        h = await resolve_upcoming_earnings_horizon("ZZZ", polygon_client=FakePoly())  # type: ignore[arg-type]

    assert h is None
