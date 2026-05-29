"""Earnings calendar → gap catalyst mapping."""

from __future__ import annotations

from datetime import date, timedelta

from stocvest.data.earnings_catalyst import (
    earnings_applies_to_gap_session,
    match_earnings_catalyst,
)
from stocvest.data.earnings_calendar_fetch import index_earnings_by_symbol
from stocvest.data.models import EarningsEvent


def test_amc_yesterday_applies_to_today_gap() -> None:
    today = date(2026, 5, 28)
    assert earnings_applies_to_gap_session(
        today - timedelta(days=1),
        "after_market",
        session_date=today,
    )


def test_bmo_today_applies() -> None:
    today = date(2026, 5, 28)
    assert earnings_applies_to_gap_session(today, "before_market", session_date=today)


def test_match_earnings_catalyst_payload() -> None:
    today = date(2026, 5, 28)
    ev = EarningsEvent(
        symbol="DELL",
        company_name="Dell",
        report_date=today - timedelta(days=1),
        report_time="after_market",
        actual_eps=1.2,
    )
    idx = index_earnings_by_symbol([ev])
    payload, matched = match_earnings_catalyst("DELL", idx, session_date=today)
    assert matched is not None
    assert payload is not None
    assert payload.get("category") == "earnings"
