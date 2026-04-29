"""
Phase 2.5g: Pattern Day Trade (PDT) rule tracker (per user, DynamoDB-friendly).

FINRA / broker rule of thumb for accounts under ~$25k: avoid more than three
day trades within any rolling five NYSE business-day window. This module
enforces the project policy from docs/CONTEXT.md:

  - Warn when two day trades already count in the window (one slot left).
  - Block an additional day trade when three already count, unless the user
    is marked PDT-exempt (verified equity ≥ $25k).

Rolling window uses Mon–Fri business days only (no NYSE holiday calendar).
For production, plug in an exchange calendar for broker-identical windows.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

_NY = ZoneInfo("America/New_York")
_MAX_NON_EXEMPT_DAY_TRADES = 3
_ROLLING_BUSINESS_DAYS = 5


class PDTBlockedError(Exception):
    """Raised when recording a day trade would violate the non-exempt PDT cap."""


def _ny_trade_date(trade_at: datetime) -> date:
    if trade_at.tzinfo is None:
        trade_at = trade_at.replace(tzinfo=timezone.utc)
    return trade_at.astimezone(_NY).date()


def _effective_as_of(as_of: date) -> date:
    """Use last weekday if as_of falls on a weekend (evaluation 'session' date)."""
    cur = as_of
    while cur.weekday() >= 5:
        cur -= timedelta(days=1)
    return cur


def _weekdays_before(end: date, n: int) -> date:
    """Move ``n`` weekdays backward from ``end`` (``end`` is a weekday)."""
    cur = end
    moved = 0
    while moved < n:
        cur -= timedelta(days=1)
        if cur.weekday() < 5:
            moved += 1
    return cur


def _window_start(as_of: date) -> date:
    """First calendar date in the inclusive 5-business-day window ending at as_of."""
    end = _effective_as_of(as_of)
    return _weekdays_before(end, _ROLLING_BUSINESS_DAYS - 1)


def _dates_in_window(day_trade_dates: tuple[date, ...], as_of: date) -> tuple[date, ...]:
    start = _window_start(as_of)
    end = _effective_as_of(as_of)
    return tuple(d for d in day_trade_dates if start <= d <= end)


@dataclass(frozen=True)
class PDTUserState:
    """Serializable user state (e.g. DynamoDB item)."""

    user_id: str
    day_trade_dates: tuple[date, ...]
    pdt_exempt: bool

    def to_dynamo_item(self) -> dict[str, Any]:
        return {
            "userId": self.user_id,
            "dayTradeDates": [d.isoformat() for d in self.day_trade_dates],
            "pdtExempt": self.pdt_exempt,
        }

    @staticmethod
    def from_dynamo_item(item: dict[str, Any]) -> PDTUserState:
        raw_dates = item.get("dayTradeDates") or []
        dates = tuple(date.fromisoformat(str(x)) for x in raw_dates)
        return PDTUserState(
            user_id=str(item["userId"]),
            day_trade_dates=dates,
            pdt_exempt=bool(item.get("pdtExempt", False)),
        )

    def pruned_to_window(self, as_of: date) -> PDTUserState:
        """Drop day trades outside the rolling window (smaller DynamoDB items)."""
        kept = _dates_in_window(self.day_trade_dates, as_of)
        return PDTUserState(
            user_id=self.user_id,
            day_trade_dates=kept,
            pdt_exempt=self.pdt_exempt,
        )


@dataclass(frozen=True)
class PDTAssessment:
    pdt_exempt: bool
    day_trades_in_window: int
    max_non_exempt: int
    rolling_business_days: int
    allow_next_day_trade: bool
    warn_near_limit: bool
    at_limit: bool


class PDTTracker:
    """
    Evaluate and update PDT state. Stateless service; pass ``PDTUserState`` each time.
    """

    def assess(self, state: PDTUserState, *, as_of: date) -> PDTAssessment:
        in_window = _dates_in_window(state.day_trade_dates, as_of)
        count = len(in_window)
        if state.pdt_exempt:
            return PDTAssessment(
                pdt_exempt=True,
                day_trades_in_window=count,
                max_non_exempt=_MAX_NON_EXEMPT_DAY_TRADES,
                rolling_business_days=_ROLLING_BUSINESS_DAYS,
                allow_next_day_trade=True,
                warn_near_limit=False,
                at_limit=False,
            )

        at_limit = count >= _MAX_NON_EXEMPT_DAY_TRADES
        allow = count < _MAX_NON_EXEMPT_DAY_TRADES
        warn = count == _MAX_NON_EXEMPT_DAY_TRADES - 1
        return PDTAssessment(
            pdt_exempt=False,
            day_trades_in_window=count,
            max_non_exempt=_MAX_NON_EXEMPT_DAY_TRADES,
            rolling_business_days=_ROLLING_BUSINESS_DAYS,
            allow_next_day_trade=allow,
            warn_near_limit=warn,
            at_limit=at_limit,
        )

    def record_day_trade(
        self,
        state: PDTUserState,
        *,
        trade_at: datetime,
    ) -> PDTUserState:
        """
        Append one day trade (use NY session date of ``trade_at``).

        Raises:
            PDTBlockedError: if the user is not exempt and already at the cap
                for the rolling window containing ``trade_at``.
        """
        trade_date = _ny_trade_date(trade_at)
        preview = PDTUserState(
            user_id=state.user_id,
            day_trade_dates=state.day_trade_dates + (trade_date,),
            pdt_exempt=state.pdt_exempt,
        )
        if not state.pdt_exempt:
            before = self.assess(state, as_of=trade_date)
            if not before.allow_next_day_trade:
                raise PDTBlockedError(
                    "PDT limit reached: no additional day trades allowed in this "
                    f"{_ROLLING_BUSINESS_DAYS}-business-day window without exemption."
                )
        return preview
