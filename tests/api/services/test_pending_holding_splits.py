"""Pending Polygon splits vs manual holdings."""

from __future__ import annotations

from datetime import date

import pytest

from stocvest.api.services.pending_holding_splits import pending_splits_for_holdings
from stocvest.data.corporate_actions import SplitEvent
from stocvest.models.portfolio_holding import PortfolioHolding

pytestmark = pytest.mark.unit


def _holding(symbol: str = "ETHA", purchase: str = "2025-06-01", applied: tuple[str, ...] = ()) -> PortfolioHolding:
    return PortfolioHolding.from_api(
        {
            "symbol": symbol,
            "lots": [
                {
                    "lotId": f"{symbol}-1",
                    "quantity": 300,
                    "costBasis": 20.0,
                    "purchaseDate": purchase,
                }
            ],
            "appliedSplitDates": list(applied),
        }
    )


def _etha() -> SplitEvent:
    return SplitEvent(
        ticker="ETHA",
        execution_date=date(2026, 10, 6),
        split_from=3.0,
        split_to=1.0,
    )


def test_etha_reverse_is_pending_when_bought_before_split() -> None:
    rows = pending_splits_for_holdings([_holding()], [_etha()], as_of=date(2026, 10, 22))
    assert len(rows) == 1
    assert rows[0].symbol == "ETHA"
    assert rows[0].ratio == pytest.approx(1 / 3)
    assert rows[0].label == "1-for-3 reverse"
    assert rows[0].is_reverse is True


def test_already_applied_split_is_not_pending() -> None:
    held = _holding(applied=("2026-10-06",))
    assert pending_splits_for_holdings([held], [_etha()], as_of=date(2026, 10, 22)) == []


def test_lot_bought_after_split_is_already_post_split() -> None:
    held = _holding(purchase="2026-10-10")
    assert pending_splits_for_holdings([held], [_etha()], as_of=date(2026, 10, 22)) == []


def test_future_split_is_not_pending() -> None:
    future = SplitEvent(ticker="ETHA", execution_date=date(2026, 11, 1), split_from=3.0, split_to=1.0)
    assert pending_splits_for_holdings([_holding()], [future], as_of=date(2026, 10, 22)) == []


def test_unheld_ticker_is_ignored() -> None:
    assert pending_splits_for_holdings([_holding("IBIT")], [_etha()], as_of=date(2026, 10, 22)) == []
