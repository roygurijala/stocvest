from __future__ import annotations

from datetime import date, datetime, timezone

import pytest

from stocvest.signals.pdt_tracker import (
    PDTAssessment,
    PDTBlockedError,
    PDTTracker,
    PDTUserState,
)


def dt_ny(y: int, m: int, d: int, hour: int = 12) -> datetime:
    """Noon UTC is always same calendar day in NY for equity session tests."""
    return datetime(y, m, d, hour, 0, tzinfo=timezone.utc)


@pytest.mark.unit
def test_assess_empty_allowed():
    state = PDTUserState(user_id="u1", day_trade_dates=(), pdt_exempt=False)
    a = PDTTracker().assess(state, as_of=date(2026, 4, 28))
    assert isinstance(a, PDTAssessment)
    assert a.day_trades_in_window == 0
    assert a.allow_next_day_trade is True
    assert a.warn_near_limit is False
    assert a.at_limit is False


@pytest.mark.unit
def test_warn_when_two_day_trades_in_window():
    # Tue 2026-04-28; window includes prior business days
    d1 = date(2026, 4, 23)
    d2 = date(2026, 4, 24)
    state = PDTUserState(user_id="u1", day_trade_dates=(d1, d2), pdt_exempt=False)
    a = PDTTracker().assess(state, as_of=date(2026, 4, 28))
    assert a.day_trades_in_window == 2
    assert a.warn_near_limit is True
    assert a.allow_next_day_trade is True
    assert a.at_limit is False


@pytest.mark.unit
def test_at_limit_blocks_additional_day_trade():
    d1, d2, d3 = date(2026, 4, 23), date(2026, 4, 24), date(2026, 4, 27)
    state = PDTUserState(user_id="u1", day_trade_dates=(d1, d2, d3), pdt_exempt=False)
    tracker = PDTTracker()
    a = tracker.assess(state, as_of=date(2026, 4, 28))
    assert a.day_trades_in_window == 3
    assert a.at_limit is True
    assert a.allow_next_day_trade is False

    with pytest.raises(PDTBlockedError):
        tracker.record_day_trade(state, trade_at=dt_ny(2026, 4, 28))


@pytest.mark.unit
def test_third_day_trade_allowed_when_two_in_window():
    d1, d2 = date(2026, 4, 23), date(2026, 4, 24)
    state = PDTUserState(user_id="u1", day_trade_dates=(d1, d2), pdt_exempt=False)
    tracker = PDTTracker()
    nxt = tracker.record_day_trade(state, trade_at=dt_ny(2026, 4, 27))
    assert len(nxt.day_trade_dates) == 3
    a = tracker.assess(nxt, as_of=date(2026, 4, 28))
    assert a.at_limit is True
    assert a.allow_next_day_trade is False


@pytest.mark.unit
def test_exempt_ignores_limit():
    d1, d2, d3 = date(2026, 4, 23), date(2026, 4, 24), date(2026, 4, 27)
    state = PDTUserState(user_id="u1", day_trade_dates=(d1, d2, d3), pdt_exempt=True)
    tracker = PDTTracker()
    nxt = tracker.record_day_trade(state, trade_at=dt_ny(2026, 4, 28))
    assert date(2026, 4, 28) in nxt.day_trade_dates
    a = tracker.assess(nxt, as_of=date(2026, 4, 28))
    assert a.allow_next_day_trade is True


@pytest.mark.unit
def test_old_trades_outside_window_do_not_count():
    old = date(2026, 4, 10)
    recent = (date(2026, 4, 23), date(2026, 4, 24))
    state = PDTUserState(user_id="u1", day_trade_dates=(old, *recent), pdt_exempt=False)
    a = PDTTracker().assess(state, as_of=date(2026, 4, 28))
    assert a.day_trades_in_window == 2


@pytest.mark.unit
def test_dynamo_roundtrip():
    state = PDTUserState(
        user_id="u42",
        day_trade_dates=(date(2026, 4, 1), date(2026, 4, 2)),
        pdt_exempt=False,
    )
    restored = PDTUserState.from_dynamo_item(state.to_dynamo_item())
    assert restored == state


@pytest.mark.unit
def test_pruned_drops_outside_window():
    state = PDTUserState(
        user_id="u1",
        day_trade_dates=(date(2026, 4, 10), date(2026, 4, 23)),
        pdt_exempt=False,
    )
    pruned = state.pruned_to_window(as_of=date(2026, 4, 28))
    assert date(2026, 4, 10) not in pruned.day_trade_dates
    assert date(2026, 4, 23) in pruned.day_trade_dates


@pytest.mark.unit
def test_weekend_as_of_rolls_to_friday():
    state = PDTUserState(
        user_id="u1",
        day_trade_dates=(date(2026, 4, 24),),  # Friday
        pdt_exempt=False,
    )
    # Saturday 2026-04-25
    a = PDTTracker().assess(state, as_of=date(2026, 4, 25))
    assert a.day_trades_in_window == 1
