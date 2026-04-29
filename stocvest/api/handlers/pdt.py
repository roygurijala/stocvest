"""Phase 5f PDT status endpoint handlers."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from stocvest.api.response import ok, unauthorized
from stocvest.api.services.pdt_store import get_pdt_state_store
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.signals.pdt_tracker import PDTTracker, PDTUserState


def pdt_status_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")

    query = event.get("queryStringParameters") or {}
    pdt_exempt_raw = str(query.get("pdt_exempt", "false")).lower() if isinstance(query, dict) else "false"
    pdt_exempt = pdt_exempt_raw in {"1", "true", "yes", "y"}
    as_of = _parse_as_of(query if isinstance(query, dict) else {})

    base_state = get_pdt_state_store().get_state(request_context.user_id)
    state = PDTUserState(
        user_id=base_state.user_id,
        day_trade_dates=base_state.day_trade_dates,
        pdt_exempt=pdt_exempt or base_state.pdt_exempt,
    )
    assessment = PDTTracker().assess(state, as_of=as_of)
    in_window = _dates_in_window(state.day_trade_dates, as_of)
    days_until_reset = _days_until_reset(in_window, as_of)
    return ok(
        {
            "user_id": request_context.user_id,
            "assessment": {
                "pdt_exempt": assessment.pdt_exempt,
                "day_trades_in_window": assessment.day_trades_in_window,
                "current_day_trade_count": assessment.day_trades_in_window,
                "max_non_exempt": assessment.max_non_exempt,
                "rolling_business_days": assessment.rolling_business_days,
                "allow_next_day_trade": assessment.allow_next_day_trade,
                "warn_near_limit": assessment.warn_near_limit,
                "at_limit": assessment.at_limit,
                "days_until_reset": days_until_reset,
            },
        }
    )


def _parse_as_of(query: dict[str, Any]) -> date:
    raw = str(query.get("as_of") or "").strip()
    if not raw:
        return date.today()
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return date.today()


def _effective_as_of(as_of: date) -> date:
    cur = as_of
    while cur.weekday() >= 5:
        cur -= timedelta(days=1)
    return cur


def _weekdays_before(end: date, n: int) -> date:
    cur = end
    moved = 0
    while moved < n:
        cur -= timedelta(days=1)
        if cur.weekday() < 5:
            moved += 1
    return cur


def _window_start(as_of: date) -> date:
    end = _effective_as_of(as_of)
    return _weekdays_before(end, 4)


def _dates_in_window(day_trade_dates: tuple[date, ...], as_of: date) -> tuple[date, ...]:
    start = _window_start(as_of)
    end = _effective_as_of(as_of)
    return tuple(d for d in day_trade_dates if start <= d <= end)


def _add_business_days(start: date, days: int) -> date:
    cur = start
    moved = 0
    while moved < days:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            moved += 1
    return cur


def _business_days_between(start: date, end: date) -> int:
    if end <= start:
        return 0
    cur = start
    count = 0
    while cur < end:
        cur += timedelta(days=1)
        if cur.weekday() < 5:
            count += 1
    return count


def _days_until_reset(in_window_dates: tuple[date, ...], as_of: date) -> int:
    if not in_window_dates:
        return 0
    effective = _effective_as_of(as_of)
    reset_days = [
        _business_days_between(effective, _add_business_days(trade_date, 5))
        for trade_date in in_window_dates
    ]
    return min(reset_days) if reset_days else 0
