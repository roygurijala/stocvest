"""NYSE calendar helpers for Product KPI coverage."""

from __future__ import annotations

from datetime import date

from stocvest.data.nyse_calendar import count_nyse_trading_days, is_nyse_trading_day


def test_weekends_are_not_trading_days() -> None:
    assert not is_nyse_trading_day(date(2026, 2, 7))  # Saturday
    assert not is_nyse_trading_day(date(2026, 2, 8))  # Sunday


def test_known_holiday_is_not_trading_day() -> None:
    assert not is_nyse_trading_day(date(2026, 1, 1))
    assert is_nyse_trading_day(date(2026, 1, 2))


def test_count_excludes_holidays_in_range() -> None:
    # Mon 2025-06-30 through Tue 2025-07-08: one weekday is July 4 (NYSE closed).
    start = date(2025, 6, 30)
    end = date(2025, 7, 8)
    weekdays = 6
    assert count_nyse_trading_days(start, end) == weekdays - 1
