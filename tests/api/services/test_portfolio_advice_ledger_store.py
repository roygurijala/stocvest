from __future__ import annotations

from datetime import date

import pytest

from stocvest.api.services.portfolio_advice_ledger import (
    InMemoryPortfolioAdviceLedgerStore,
    due_horizons,
    ledger_to_api,
    record_review_snapshots,
    resolve_due_outcomes,
)
from stocvest.models.portfolio_advice_ledger import (
    KIND_REVIEW,
    OUTCOME_FAVORABLE,
    PortfolioLedgerEvent,
)

pytestmark = pytest.mark.unit


def test_record_review_snapshots_and_resolve_30d() -> None:
    store = InMemoryPortfolioAdviceLedgerStore()
    review = {
        "generatedAt": "2026-06-01T20:00:00+00:00",
        "holdings": [
            {
                "symbol": "WMT",
                "action": "sell",
                "currentPrice": 100.0,
                "verdict": "bearish",
            }
        ],
    }
    n = record_review_snapshots(
        "u1", review, "2026-06-01T20:00:00+00:00", source="fp1", store=store
    )
    assert n == 1
    event = store.list_events("u1")[0]
    assert event.kind == KIND_REVIEW
    assert due_horizons(event, today=date(2026, 6, 15)) == []
    assert due_horizons(event, today=date(2026, 7, 5)) == [30]

    prices = {("WMT", date(2026, 7, 1)): 90.0}

    def _price(symbol: str, target: date) -> float | None:
        return prices.get((symbol, target))

    filled = resolve_due_outcomes(
        "u1", store=store, price_fn=_price, today=date(2026, 7, 5), limit=10
    )
    assert filled == 1
    updated = store.list_events("u1")[0]
    assert updated.price_after_30d == 90.0
    assert updated.outcome_30d == OUTCOME_FAVORABLE
    assert updated.outcome_90d is None

    api = ledger_to_api("u1", store=store)
    assert api["count"] == 1
    assert api["summary"]["outcome30d"]["favorable"] == 1


def test_due_horizons_90d() -> None:
    event = PortfolioLedgerEvent(
        event_id="e1",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="AAPL",
        occurred_at="2026-01-01",
        advice_action="hold",
        resolved_30d_at="2026-02-01T00:00:00+00:00",
    )
    assert due_horizons(event, today=date(2026, 3, 1)) == []
    assert due_horizons(event, today=date(2026, 4, 2)) == [90]
