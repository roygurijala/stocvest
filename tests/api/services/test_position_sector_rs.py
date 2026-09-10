"""Long-horizon sector relative-strength helper (ADR-004 POS-AI engine fix).

`_avg_weekly_pct_from_daily_bars` turns ~13 weeks of daily bars into an
*average weekly* % move, so the Position sector layer scores a quarter-long
relative strength instead of a 1d/5d momentum read.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from stocvest.api.services.position_composite_engine import (
    POSITION_SECTOR_RS_WEEKS,
    _avg_weekly_pct_from_daily_bars,
)
from stocvest.data.models import Bar, Timeframe


def _daily_bars(closes: list[float]) -> list[Bar]:
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return [
        Bar(
            symbol="X",
            timestamp=base + timedelta(days=i),
            timeframe=Timeframe.DAY_1,
            open=c,
            high=c,
            low=c,
            close=c,
            volume=1_000.0,
        )
        for i, c in enumerate(closes)
    ]


@pytest.mark.unit
def test_avg_weekly_pct_is_total_return_divided_by_weeks() -> None:
    sessions = POSITION_SECTOR_RS_WEEKS * 5  # 65
    closes = [100.0] * (sessions + 1)
    closes[-1] = 113.0  # +13% total over the 13-week window
    result = _avg_weekly_pct_from_daily_bars(_daily_bars(closes))
    # 13% total / 13 weeks = 1.0% average weekly.
    assert result == pytest.approx(1.0, abs=1e-6)


@pytest.mark.unit
def test_avg_weekly_pct_none_when_history_too_short() -> None:
    sessions = POSITION_SECTOR_RS_WEEKS * 5
    short = _daily_bars([100.0] * (sessions - 10))  # fewer than sessions + 1
    assert _avg_weekly_pct_from_daily_bars(short) is None


@pytest.mark.unit
def test_avg_weekly_pct_negative_for_laggard() -> None:
    sessions = POSITION_SECTOR_RS_WEEKS * 5
    closes = [100.0] * (sessions + 1)
    closes[-1] = 87.0  # -13% over the window → -1.0% avg weekly
    assert _avg_weekly_pct_from_daily_bars(_daily_bars(closes)) == pytest.approx(-1.0, abs=1e-6)
