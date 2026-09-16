from __future__ import annotations

import pytest

from stocvest.models.portfolio_advice_ledger import (
    KIND_REVIEW,
    KIND_SALE,
    OUTCOME_FAVORABLE,
    OUTCOME_UNFAVORABLE,
    OUTCOME_NEUTRAL,
    FOLLOWED,
    DIVERGED,
    IGNORED,
    PortfolioLedgerEvent,
    advice_outcome,
    apply_sale,
    added_quantity,
    collapse_review_episodes,
    follow_through,
    ledger_summary,
    plan_review_writes,
    review_events_from_payload,
)
from stocvest.models.portfolio_holding import HoldingLot, PortfolioHolding

pytestmark = pytest.mark.unit


def _holding(*lots: tuple[str, float, float, str]) -> PortfolioHolding:
    return PortfolioHolding(
        symbol="WMT",
        lots=tuple(
            HoldingLot(lot_id=lid, quantity=qty, cost_basis=cost, purchase_date=day)
            for lid, qty, cost, day in lots
        ),
    )


def test_apply_sale_fifo_partial_then_full() -> None:
    held = _holding(("old", 10, 50.0, "2023-01-01"), ("new", 10, 80.0, "2025-01-01"))
    first = apply_sale(held, 6)
    assert first.lot_ids == ("old",)
    assert first.cost_basis_per_share == 50.0
    assert first.remaining_quantity == 14
    assert first.remaining is not None
    assert first.remaining.lots[0].quantity == 4

    second = apply_sale(first.remaining, 14)
    assert second.remaining is None
    assert second.remaining_quantity == 0
    # 4 @ 50 + 10 @ 80 = 1000 / 14
    assert second.cost_basis_per_share == pytest.approx(1000 / 14)


def test_apply_sale_rejects_over_quantity() -> None:
    held = _holding(("a", 5, 10.0, "2024-01-01"))
    with pytest.raises(ValueError, match="exceeds"):
        apply_sale(held, 6)


def test_advice_outcome_reuses_signal_band() -> None:
    # Sell + later drop → favorable (avoided the drop).
    assert advice_outcome("sell", 100.0, 90.0) == OUTCOME_FAVORABLE
    assert advice_outcome("trim", 100.0, 110.0) == OUTCOME_UNFAVORABLE
    # Hold / buy-more + later rise → favorable.
    assert advice_outcome("hold", 100.0, 110.0) == OUTCOME_FAVORABLE
    assert advice_outcome("buy_more", 100.0, 90.0) == OUTCOME_UNFAVORABLE
    # Same 0.1% band as the signal ledger.
    assert advice_outcome("sell", 100.0, 100.05) == OUTCOME_NEUTRAL
    assert advice_outcome("review", 100.0, 80.0) == OUTCOME_NEUTRAL


def test_added_quantity_detects_new_and_increase() -> None:
    held = _holding(("a", 10, 20.0, "2024-01-01"))
    more = _holding(("a", 10, 20.0, "2024-01-01"), ("b", 5, 22.0, "2026-01-01"))
    assert added_quantity(None, held) == 10
    assert added_quantity(held, more) == 5
    assert added_quantity(held, held) == 0


def test_review_snapshots_skip_same_day_duplicate() -> None:
    review = {
        "generatedAt": "2026-09-14T16:00:00+00:00",
        "holdings": [
            {"symbol": "WMT", "action": "sell", "currentPrice": 80.0, "verdict": "bearish"}
        ],
    }
    first = review_events_from_payload(
        user_id="u1", review=review, cached_at="2026-09-14T16:00:00+00:00", source="abc"
    )
    assert len(first) == 1
    assert first[0].kind == KIND_REVIEW
    assert first[0].advice_action == "sell"
    again = review_events_from_payload(
        user_id="u1",
        review=review,
        cached_at="2026-09-14T18:00:00+00:00",
        source="abc",
        existing=tuple(first),
    )
    assert again == []


def test_follow_through_and_summary() -> None:
    review = PortfolioLedgerEvent(
        event_id="2026-09-01#rev",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="WMT",
        occurred_at="2026-09-01",
        advice_action="sell",
        price_at_advice=80.0,
        outcome_30d=OUTCOME_FAVORABLE,
    )
    sale = PortfolioLedgerEvent(
        event_id="2026-09-02#sale",
        user_id="u1",
        kind=KIND_SALE,
        symbol="WMT",
        occurred_at="2026-09-02",
        quantity=10,
        price_per_share=79.0,
        cost_basis_per_share=70.0,
        realized_pl=90.0,
        outcome_30d=OUTCOME_FAVORABLE,
    )
    hold_rev = PortfolioLedgerEvent(
        event_id="2026-09-01#hold",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="AAPL",
        occurred_at="2026-09-01",
        advice_action="hold",
        price_at_advice=200.0,
        outcome_30d=OUTCOME_UNFAVORABLE,
    )
    events = (review, sale, hold_rev)
    assert follow_through(review, events) == FOLLOWED
    assert follow_through(hold_rev, events) == FOLLOWED
    sold_hold = PortfolioLedgerEvent(
        event_id="2026-09-03#sale2",
        user_id="u1",
        kind=KIND_SALE,
        symbol="AAPL",
        occurred_at="2026-09-03",
        quantity=1,
        realized_pl=5.0,
    )
    assert follow_through(hold_rev, (*events, sold_hold)) == DIVERGED
    ignored = PortfolioLedgerEvent(
        event_id="2026-09-01#buyadv",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="MSFT",
        occurred_at="2026-09-01",
        advice_action="buy_more",
    )
    assert follow_through(ignored, events) == IGNORED
    summary = ledger_summary((*events, sold_hold))
    assert summary["salesCount"] == 2
    assert summary["realizedPl"] == 95.0
    assert summary["followThrough"]["followed"] == 1  # WMT sell followed; AAPL hold diverged
    assert summary["followThrough"]["diverged"] == 1


def test_follow_through_sell_episode_credits_prior_day_sale() -> None:
    """A 9/14 sale still follows a 9/15 Sell restamp of the same advice."""
    first = PortfolioLedgerEvent(
        event_id="2026-09-14#rev",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="ARKQ",
        occurred_at="2026-09-14",
        advice_action="sell",
    )
    sale = PortfolioLedgerEvent(
        event_id="2026-09-14#sale",
        user_id="u1",
        kind=KIND_SALE,
        symbol="ARKQ",
        occurred_at="2026-09-14",
        quantity=1,
    )
    restamp = PortfolioLedgerEvent(
        event_id="2026-09-15#rev",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="ARKQ",
        occurred_at="2026-09-15",
        advice_action="sell",
    )
    events = (first, sale, restamp)
    assert follow_through(first, events) == FOLLOWED
    assert follow_through(restamp, events) == FOLLOWED


def test_follow_through_hold_with_reduce_is_followed_by_sale() -> None:
    """Hold that already asked to trim (overweight sleeve) is followed by a sale."""
    review = PortfolioLedgerEvent(
        event_id="2026-09-14#xovr",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="XOVR",
        occurred_at="2026-09-14",
        advice_action="hold",
        advice_suggested_reduce=40.0,
    )
    sale = PortfolioLedgerEvent(
        event_id="2026-09-14#sale",
        user_id="u1",
        kind=KIND_SALE,
        symbol="XOVR",
        occurred_at="2026-09-14",
        quantity=2,
    )
    assert follow_through(review, (review, sale)) == FOLLOWED


def test_plan_review_writes_confirms_same_episode_next_day() -> None:
    review = {
        "generatedAt": "2026-09-14T16:00:00+00:00",
        "holdings": [
            {"symbol": "NVDA", "action": "hold", "currentPrice": 212.0, "suggestedReduceAmount": 0}
        ],
    }
    first = review_events_from_payload(
        user_id="u1", review=review, cached_at="2026-09-14T16:00:00+00:00", source="a"
    )
    assert len(first) == 1
    nxt = {
        "generatedAt": "2026-09-15T16:00:00+00:00",
        "holdings": [
            {"symbol": "NVDA", "action": "hold", "currentPrice": 200.0, "suggestedReduceAmount": 0}
        ],
    }
    plan = plan_review_writes(
        user_id="u1",
        review=nxt,
        cached_at="2026-09-15T16:00:00+00:00",
        source="b",
        existing=tuple(first),
    )
    assert plan.append == ()
    assert len(plan.confirm) == 1
    assert plan.confirm[0].event_id == first[0].event_id
    assert plan.confirm[0].advice_last_confirmed_at == "2026-09-15"
    assert plan.confirm[0].price_at_advice == 212.0


def test_plan_review_writes_new_row_when_reduce_turns_on() -> None:
    hold = {
        "generatedAt": "2026-09-14T16:00:00+00:00",
        "holdings": [{"symbol": "MSFT", "action": "hold", "currentPrice": 500.0}],
    }
    first = review_events_from_payload(
        user_id="u1", review=hold, cached_at="2026-09-14T16:00:00+00:00", source="a"
    )
    trim_like = {
        "generatedAt": "2026-09-15T16:00:00+00:00",
        "holdings": [
            {
                "symbol": "MSFT",
                "action": "hold",
                "currentPrice": 505.0,
                "suggestedReduceAmount": 40.0,
            }
        ],
    }
    plan = plan_review_writes(
        user_id="u1",
        review=trim_like,
        cached_at="2026-09-15T16:00:00+00:00",
        source="b",
        existing=tuple(first),
    )
    assert len(plan.append) == 1
    assert plan.confirm == ()
    assert plan.append[0].advice_suggested_reduce == 40.0


def test_collapse_review_episodes_and_summary_count_once() -> None:
    first = PortfolioLedgerEvent(
        event_id="2026-09-14#nvda",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="NVDA",
        occurred_at="2026-09-14",
        advice_action="hold",
        price_at_advice=212.0,
    )
    restamp = PortfolioLedgerEvent(
        event_id="2026-09-15#nvda",
        user_id="u1",
        kind=KIND_REVIEW,
        symbol="NVDA",
        occurred_at="2026-09-15",
        advice_action="hold",
        price_at_advice=200.0,
    )
    collapsed = collapse_review_episodes((first, restamp))
    assert len(collapsed) == 1
    assert collapsed[0].occurred_at == "2026-09-14"
    assert collapsed[0].advice_last_confirmed_at == "2026-09-15"
    summary = ledger_summary((first, restamp))
    assert summary["followThrough"]["followed"] == 1
    assert summary["outcome30d"]["pending"] == 1
