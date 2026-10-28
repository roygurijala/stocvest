"""Match Polygon split events to manual holdings that have not applied them."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Iterable

from stocvest.data.corporate_actions import SplitEvent
from stocvest.models.portfolio_holding import PortfolioHolding

HOLDING_SPLIT_LOOKBACK_DAYS = 400


@dataclass(frozen=True)
class PendingHoldingSplit:
    symbol: str
    execution_date: str
    split_from: float
    split_to: float
    ratio: float
    label: str
    is_reverse: bool

    def to_api(self) -> dict[str, object]:
        return {
            "symbol": self.symbol,
            "executionDate": self.execution_date,
            "splitFrom": self.split_from,
            "splitTo": self.split_to,
            "ratio": self.ratio,
            "label": self.label,
            "isReverse": self.is_reverse,
        }


def holding_split_window(*, as_of: date | None = None) -> tuple[date, date]:
    end = as_of or date.today()
    start = end - timedelta(days=HOLDING_SPLIT_LOOKBACK_DAYS)
    return start, end


def pending_splits_for_holdings(
    holdings: Iterable[PortfolioHolding],
    events: Iterable[SplitEvent],
    *,
    as_of: date | None = None,
) -> list[PendingHoldingSplit]:
    """Splits that hit a held name after purchase and have not been applied yet."""
    today = as_of or date.today()
    by_symbol = {h.symbol: h for h in holdings}
    pending: list[PendingHoldingSplit] = []
    seen: set[tuple[str, str]] = set()
    for ev in events:
        holding = by_symbol.get(ev.ticker)
        if holding is None:
            continue
        if ev.execution_date > today:
            continue
        day = ev.execution_date.isoformat()
        earliest = holding.earliest_purchase_date()
        if earliest and day < earliest:
            continue
        if day in holding.applied_split_dates:
            continue
        key = (ev.ticker, day)
        if key in seen:
            continue
        seen.add(key)
        pending.append(
            PendingHoldingSplit(
                symbol=ev.ticker,
                execution_date=day,
                split_from=ev.split_from,
                split_to=ev.split_to,
                ratio=ev.ratio,
                label=ev.label,
                is_reverse=ev.is_reverse,
            )
        )
    pending.sort(key=lambda row: (row.execution_date, row.symbol), reverse=True)
    return pending
