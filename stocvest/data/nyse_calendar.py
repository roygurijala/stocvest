"""
NYSE regular-session calendar (full-day closures only).

Used for Product KPI coverage denominators. Early-close days still count as
trading days. Holidays outside the maintained year range fall back to
weekday-only counting in ``count_nyse_trading_days``.
"""

from __future__ import annotations

from datetime import date, timedelta

# Full NYSE closures (no regular session). Sourced from NYSE holiday schedules.
_NYSE_FULL_CLOSURES: frozenset[date] = frozenset(
    {
        # 2024
        date(2024, 1, 1),
        date(2024, 1, 15),
        date(2024, 2, 19),
        date(2024, 3, 29),
        date(2024, 5, 27),
        date(2024, 6, 19),
        date(2024, 7, 4),
        date(2024, 9, 2),
        date(2024, 11, 28),
        date(2024, 12, 25),
        # 2025
        date(2025, 1, 1),
        date(2025, 1, 20),
        date(2025, 2, 17),
        date(2025, 4, 18),
        date(2025, 5, 26),
        date(2025, 6, 19),
        date(2025, 7, 4),
        date(2025, 9, 1),
        date(2025, 11, 27),
        date(2025, 12, 25),
        # 2026
        date(2026, 1, 1),
        date(2026, 1, 19),
        date(2026, 2, 16),
        date(2026, 4, 3),
        date(2026, 5, 25),
        date(2026, 6, 19),
        date(2026, 7, 3),
        date(2026, 9, 7),
        date(2026, 11, 26),
        date(2026, 12, 25),
        # 2027
        date(2027, 1, 1),
        date(2027, 1, 18),
        date(2027, 2, 15),
        date(2027, 3, 26),
        date(2027, 5, 31),
        date(2027, 6, 18),
        date(2027, 7, 5),
        date(2027, 9, 6),
        date(2027, 11, 25),
        date(2027, 12, 24),
    }
)

_CALENDAR_YEAR_MIN = 2024
_CALENDAR_YEAR_MAX = 2027


def is_nyse_trading_day(d: date) -> bool:
    """True when NYSE would have a regular session on ``d`` (ET calendar date)."""

    if d.weekday() >= 5:
        return False
    if _CALENDAR_YEAR_MIN <= d.year <= _CALENDAR_YEAR_MAX:
        return d not in _NYSE_FULL_CLOSURES
    return True


def count_nyse_trading_days(start: date, end: date) -> int:
    """Count NYSE trading days in ``[start, end)`` (half-open, ET dates)."""

    if end <= start:
        return 1
    count = 0
    cur = start
    while cur < end:
        if is_nyse_trading_day(cur):
            count += 1
        cur += timedelta(days=1)
    return max(1, count)
