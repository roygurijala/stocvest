"""Append-only portfolio advice ledger — sales, buys, and review snapshots.

Measures whether STOCVEST's Hold / Buy-more / Trim / Sell guidance was the better
move: freeze the advice (and the user's follow-through), then score price 30 and 90
calendar days later. Informational tracking for the single operator — not a
recommendation and not a broker blotter.

Outcome labels reuse ``outcome_from_prices`` (same 0.1% neutral band as the signal
ledger). No new financial thresholds.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import uuid4

from stocvest.models.portfolio_holding import HoldingLot, PortfolioHolding

KIND_SALE = "sale"
KIND_BUY = "buy"
KIND_REVIEW = "review"
LEDGER_KINDS = frozenset({KIND_SALE, KIND_BUY, KIND_REVIEW})

OUTCOME_FAVORABLE = "favorable"
OUTCOME_UNFAVORABLE = "unfavorable"
OUTCOME_NEUTRAL = "neutral"
OUTCOME_PENDING = "pending"

FOLLOWED = "followed"
IGNORED = "ignored"
DIVERGED = "diverged"
FOLLOW_NA = "n/a"

_SELL_LIKE = frozenset({"sell", "trim"})
_BUY_LIKE = frozenset({"hold", "buy_more"})

_QTY_EPS = 1e-6


def _to_decimals(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    if isinstance(value, dict):
        return {k: _to_decimals(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_decimals(v) for v in value]
    return value


def _coerce_iso_date(raw: Any) -> str:
    if isinstance(raw, datetime):
        return raw.astimezone(timezone.utc).date().isoformat()
    if isinstance(raw, date):
        return raw.isoformat()
    s = str(raw or "").strip()
    if not s:
        raise ValueError("occurredAt / soldAt / purchaseDate is required.")
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s).date().isoformat()
    except ValueError:
        return date.fromisoformat(s[:10]).isoformat()


def new_event_id(*, occurred_at: str) -> str:
    """Sortable id: date first so a user-partition query is chronological."""
    return f"{occurred_at}#{uuid4().hex[:12]}"


def advice_outcome(action: str | None, price_at: float | None, price_after: float | None) -> str:
    """Directional advice quality: sell/trim want a later drop; hold/buy-more a rise.

    Maps the signal-ledger ``correct``/``incorrect``/``neutral`` labels so we do not
    invent a second band. Unknown / informational ``review`` actions stay neutral.
    """
    if price_at is None or price_at <= 0 or price_after is None:
        return OUTCOME_NEUTRAL
    act = (action or "").strip().lower()
    if act in _SELL_LIKE:
        direction = "bearish"
    elif act in _BUY_LIKE:
        direction = "bullish"
    else:
        return OUTCOME_NEUTRAL
    # Same band as the signal ledger — imported lazily to keep this module pure.
    from stocvest.api.services.signal_recorder import outcome_from_prices

    raw = outcome_from_prices(direction, price_at, price_after)
    if raw == "correct":
        return OUTCOME_FAVORABLE
    if raw == "incorrect":
        return OUTCOME_UNFAVORABLE
    return OUTCOME_NEUTRAL


@dataclass(frozen=True)
class SaleApplication:
    """Result of applying a FIFO sale to an open holding."""

    quantity_sold: float
    cost_basis_per_share: float
    remaining_quantity: float
    lot_ids: tuple[str, ...]
    remaining: PortfolioHolding | None


def apply_sale(holding: PortfolioHolding, quantity_sold: float) -> SaleApplication:
    """Reduce lots oldest-first (purchase date, then lot id). Pure; no advice.

    Oldest-first is standard lot relief, not a new threshold. Raises if the sale
    exceeds shares held.
    """
    if not isinstance(quantity_sold, (int, float)) or isinstance(quantity_sold, bool):
        raise ValueError("quantitySold must be a number.")
    qty = float(quantity_sold)
    if qty <= 0:
        raise ValueError("quantitySold must be > 0.")
    held = holding.total_quantity
    if qty - held > _QTY_EPS:
        raise ValueError("quantitySold exceeds shares held.")

    remaining = qty
    cost_taken = 0.0
    touched: list[str] = []
    kept: list[HoldingLot] = []
    for lot in sorted(holding.lots, key=lambda row: (row.purchase_date, row.lot_id)):
        if remaining <= _QTY_EPS:
            kept.append(lot)
            continue
        take = min(lot.quantity, remaining)
        cost_taken += take * lot.cost_basis
        remaining -= take
        touched.append(lot.lot_id)
        leftover = lot.quantity - take
        if leftover > _QTY_EPS:
            kept.append(
                HoldingLot(
                    lot_id=lot.lot_id,
                    quantity=round(leftover, 6),
                    cost_basis=lot.cost_basis,
                    purchase_date=lot.purchase_date,
                    note=lot.note,
                )
            )
    sold = qty
    avg_cost = round(cost_taken / sold, 6) if sold else 0.0
    leftover_qty = round(sum(lot.quantity for lot in kept), 6)
    leftover_holding = (
        PortfolioHolding(symbol=holding.symbol, lots=tuple(kept)) if kept else None
    )
    return SaleApplication(
        quantity_sold=sold,
        cost_basis_per_share=avg_cost,
        remaining_quantity=leftover_qty,
        lot_ids=tuple(touched),
        remaining=leftover_holding,
    )


def added_quantity(previous: PortfolioHolding | None, updated: PortfolioHolding) -> float:
    """Shares added on an upsert (new symbol or a quantity increase)."""
    prev_qty = previous.total_quantity if previous is not None else 0.0
    delta = round(updated.total_quantity - prev_qty, 6)
    return delta if delta > _QTY_EPS else 0.0


@dataclass(frozen=True)
class PortfolioLedgerEvent:
    event_id: str
    user_id: str
    kind: str
    symbol: str
    occurred_at: str  # ISO YYYY-MM-DD (UTC date)

    quantity: float | None = None
    price_per_share: float | None = None
    cost_basis_per_share: float | None = None
    realized_pl: float | None = None
    realized_pl_pct: float | None = None
    remaining_quantity: float | None = None
    lot_ids: tuple[str, ...] = field(default_factory=tuple)
    cash_credited: float | None = None

    advice_action: str | None = None
    advice_generated_at: str | None = None
    advice_review_source: str | None = None
    advice_verdict: str | None = None
    advice_suggested_add: float | None = None
    advice_suggested_reduce: float | None = None
    advice_sizing_reason: str | None = None
    advice_sleeve: str | None = None
    price_at_advice: float | None = None
    weight_pct: float | None = None
    advice_attribution_status: str | None = None  # stamped | no_review_snapshot
    advice_last_confirmed_at: str | None = None  # latest same-episode review date

    price_after_30d: float | None = None
    price_after_90d: float | None = None
    outcome_30d: str | None = None
    outcome_90d: str | None = None
    resolved_30d_at: str | None = None
    resolved_90d_at: str | None = None

    def to_api(self) -> dict[str, Any]:
        return {
            "eventId": self.event_id,
            "kind": self.kind,
            "symbol": self.symbol,
            "occurredAt": self.occurred_at,
            "quantity": self.quantity,
            "pricePerShare": self.price_per_share,
            "costBasisPerShare": self.cost_basis_per_share,
            "realizedPl": self.realized_pl,
            "realizedPlPct": self.realized_pl_pct,
            "remainingQuantity": self.remaining_quantity,
            "lotIds": list(self.lot_ids),
            "cashCredited": self.cash_credited,
            "adviceAction": self.advice_action,
            "adviceGeneratedAt": self.advice_generated_at,
            "adviceReviewSource": self.advice_review_source,
            "adviceVerdict": self.advice_verdict,
            "adviceSuggestedAddAmount": self.advice_suggested_add,
            "adviceSuggestedReduceAmount": self.advice_suggested_reduce,
            "adviceSizingReason": self.advice_sizing_reason,
            "adviceSleeve": self.advice_sleeve,
            "priceAtAdvice": self.price_at_advice,
            "weightPct": self.weight_pct,
            "adviceAttributionStatus": self.advice_attribution_status,
            "adviceLastConfirmedAt": self.advice_last_confirmed_at,
            "priceAfter30d": self.price_after_30d,
            "priceAfter90d": self.price_after_90d,
            "outcome30d": self.outcome_30d,
            "outcome90d": self.outcome_90d,
            "resolved30dAt": self.resolved_30d_at,
            "resolved90dAt": self.resolved_90d_at,
        }

    def to_dynamo_item(self) -> dict[str, Any]:
        item = {"userId": self.user_id, "eventId": self.event_id, **self.to_api()}
        return _to_decimals(item)

    def with_outcome(
        self,
        *,
        horizon: int,
        price_after: float | None,
        resolved_at: str,
    ) -> PortfolioLedgerEvent:
        action = self.advice_action
        if self.kind == KIND_SALE and not action:
            action = "sell"
        if self.kind == KIND_BUY and not action:
            action = "buy_more"
        price_at = self.price_at_advice if self.price_at_advice is not None else self.price_per_share
        label = advice_outcome(action, price_at, price_after)
        if horizon == 30:
            return dataclass_replace(
                self,
                price_after_30d=price_after,
                outcome_30d=label,
                resolved_30d_at=resolved_at,
            )
        if horizon == 90:
            return dataclass_replace(
                self,
                price_after_90d=price_after,
                outcome_90d=label,
                resolved_90d_at=resolved_at,
            )
        raise ValueError("horizon must be 30 or 90.")

    @classmethod
    def from_item(cls, item: dict[str, Any]) -> PortfolioLedgerEvent:
        kind = str(item.get("kind") or "").strip().lower()
        if kind not in LEDGER_KINDS:
            raise ValueError("kind must be sale, buy, or review.")
        lot_ids_raw = item.get("lotIds") or item.get("lot_ids") or []
        lot_ids = tuple(str(x) for x in lot_ids_raw) if isinstance(lot_ids_raw, list) else ()
        return cls(
            event_id=str(item.get("eventId") or item.get("event_id") or "").strip(),
            user_id=str(item.get("userId") or item.get("user_id") or "").strip(),
            kind=kind,
            symbol=str(item.get("symbol") or "").strip().upper(),
            occurred_at=_coerce_iso_date(item.get("occurredAt") or item.get("occurred_at")),
            quantity=_opt_float(item.get("quantity")),
            price_per_share=_opt_float(item.get("pricePerShare") or item.get("price_per_share")),
            cost_basis_per_share=_opt_float(
                item.get("costBasisPerShare") or item.get("cost_basis_per_share")
            ),
            realized_pl=_opt_float(item.get("realizedPl") or item.get("realized_pl")),
            realized_pl_pct=_opt_float(item.get("realizedPlPct") or item.get("realized_pl_pct")),
            remaining_quantity=_opt_float(
                item.get("remainingQuantity") or item.get("remaining_quantity")
            ),
            lot_ids=lot_ids,
            cash_credited=_opt_float(item.get("cashCredited") or item.get("cash_credited")),
            advice_action=_opt_str(item.get("adviceAction") or item.get("advice_action")),
            advice_generated_at=_opt_str(
                item.get("adviceGeneratedAt") or item.get("advice_generated_at")
            ),
            advice_review_source=_opt_str(
                item.get("adviceReviewSource") or item.get("advice_review_source")
            ),
            advice_verdict=_opt_str(item.get("adviceVerdict") or item.get("advice_verdict")),
            advice_suggested_add=_opt_float(
                item.get("adviceSuggestedAddAmount") or item.get("advice_suggested_add")
            ),
            advice_suggested_reduce=_opt_float(
                item.get("adviceSuggestedReduceAmount") or item.get("advice_suggested_reduce")
            ),
            advice_sizing_reason=_opt_str(
                item.get("adviceSizingReason") or item.get("advice_sizing_reason")
            ),
            advice_sleeve=_opt_str(item.get("adviceSleeve") or item.get("advice_sleeve")),
            price_at_advice=_opt_float(item.get("priceAtAdvice") or item.get("price_at_advice")),
            weight_pct=_opt_float(item.get("weightPct") or item.get("weight_pct")),
            advice_attribution_status=_opt_str(
                item.get("adviceAttributionStatus") or item.get("advice_attribution_status")
            ),
            advice_last_confirmed_at=_opt_str(
                item.get("adviceLastConfirmedAt") or item.get("advice_last_confirmed_at")
            ),
            price_after_30d=_opt_float(item.get("priceAfter30d") or item.get("price_after_30d")),
            price_after_90d=_opt_float(item.get("priceAfter90d") or item.get("price_after_90d")),
            outcome_30d=_opt_str(item.get("outcome30d") or item.get("outcome_30d")),
            outcome_90d=_opt_str(item.get("outcome90d") or item.get("outcome_90d")),
            resolved_30d_at=_opt_str(item.get("resolved30dAt") or item.get("resolved_30d_at")),
            resolved_90d_at=_opt_str(item.get("resolved90dAt") or item.get("resolved_90d_at")),
        )


def dataclass_replace(event: PortfolioLedgerEvent, **changes: Any) -> PortfolioLedgerEvent:
    data = event.__dict__.copy()
    data.update(changes)
    return PortfolioLedgerEvent(**data)


def _opt_float(raw: Any) -> float | None:
    if raw is None or raw == "":
        return None
    return float(raw)


def _opt_str(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip()
    return s or None


def advice_stamp_from_review_row(row: dict[str, Any] | None, *, cached_at: str | None) -> dict[str, Any]:
    """Copy the last review's attributable fields — never invent an action."""
    if not isinstance(row, dict):
        return {"advice_attribution_status": "no_review_snapshot"}
    action = _opt_str(row.get("action"))
    if not action:
        return {"advice_attribution_status": "no_review_snapshot"}
    return {
        "advice_action": action,
        "advice_generated_at": _opt_str(row.get("generatedAt")) or cached_at,
        "advice_verdict": _opt_str(row.get("verdict")),
        "advice_suggested_add": _opt_float(row.get("suggestedAddAmount")),
        "advice_suggested_reduce": _opt_float(row.get("suggestedReduceAmount")),
        "advice_sizing_reason": _opt_str(row.get("sizingReason")),
        "advice_sleeve": _opt_str(row.get("sleeve")),
        "price_at_advice": _opt_float(row.get("currentPrice")),
        "weight_pct": _opt_float(row.get("weightPct")),
        "advice_attribution_status": "stamped",
    }


def advice_episode_key(
    action: str | None,
    suggested_add: float | None = None,
    suggested_reduce: float | None = None,
) -> tuple[str, bool, bool]:
    """Identity of an advice episode — the call, not the label spelling.

    Hold+reduce and trim are the same reduce call. Hold+add and buy_more are
    the same add call. Amount size is ignored; crossing zero is a new episode.
    """
    kind = (action or "").strip().lower()
    add_on = bool(suggested_add is not None and suggested_add > 0)
    reduce_on = bool(suggested_reduce is not None and suggested_reduce > 0)
    if kind == "trim" or (kind == "hold" and reduce_on):
        return ("trim", False, True)
    if kind == "buy_more" or (kind == "hold" and add_on):
        return ("add", True, False)
    if kind == "hold":
        return ("hold", False, False)
    return (kind, add_on, reduce_on)


def _event_episode_key(event: PortfolioLedgerEvent) -> tuple[str, bool, bool]:
    return advice_episode_key(
        event.advice_action, event.advice_suggested_add, event.advice_suggested_reduce
    )


def _latest_review_for_symbol(
    events: tuple[PortfolioLedgerEvent, ...] | list[PortfolioLedgerEvent],
    symbol: str,
) -> PortfolioLedgerEvent | None:
    reviews = [e for e in events if e.kind == KIND_REVIEW and e.symbol == symbol]
    if not reviews:
        return None
    return max(reviews, key=lambda e: (e.occurred_at, e.event_id))


@dataclass(frozen=True)
class ReviewWritePlan:
    """New episodes to append; same-episode restamps only touch last-confirmed."""

    append: tuple[PortfolioLedgerEvent, ...]
    confirm: tuple[PortfolioLedgerEvent, ...]


def plan_review_writes(
    *,
    user_id: str,
    review: dict[str, Any],
    cached_at: str,
    source: str | None,
    existing: tuple[PortfolioLedgerEvent, ...] = (),
) -> ReviewWritePlan:
    """Write a review row only when the recommendation episode changes."""
    occurred = _coerce_iso_date(review.get("generatedAt") or cached_at)
    append: list[PortfolioLedgerEvent] = []
    confirm: list[PortfolioLedgerEvent] = []
    planned: list[PortfolioLedgerEvent] = list(existing)
    for raw in review.get("holdings") or []:
        if not isinstance(raw, dict):
            continue
        symbol = str(raw.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        stamp = advice_stamp_from_review_row(raw, cached_at=cached_at)
        action = stamp.get("advice_action")
        if not action:
            continue
        key = advice_episode_key(
            action, stamp.get("advice_suggested_add"), stamp.get("advice_suggested_reduce")
        )
        latest = _latest_review_for_symbol(planned, symbol)
        if latest is not None and _event_episode_key(latest) == key:
            if occurred <= (latest.advice_last_confirmed_at or latest.occurred_at):
                continue
            touched = dataclass_replace(latest, advice_last_confirmed_at=occurred)
            confirm.append(touched)
            planned = [touched if e.event_id == latest.event_id else e for e in planned]
            continue
        event = PortfolioLedgerEvent(
            event_id=new_event_id(occurred_at=occurred),
            user_id=user_id,
            kind=KIND_REVIEW,
            symbol=symbol,
            occurred_at=occurred,
            advice_review_source=source,
            advice_last_confirmed_at=occurred,
            **stamp,
        )
        append.append(event)
        planned.append(event)
    return ReviewWritePlan(append=tuple(append), confirm=tuple(confirm))


def review_events_from_payload(
    *,
    user_id: str,
    review: dict[str, Any],
    cached_at: str,
    source: str | None,
    existing: tuple[PortfolioLedgerEvent, ...] = (),
) -> list[PortfolioLedgerEvent]:
    """New review rows only — same-episode restamps are confirmations, not appends."""
    return list(
        plan_review_writes(
            user_id=user_id,
            review=review,
            cached_at=cached_at,
            source=source,
            existing=existing,
        ).append
    )


def collapse_review_episodes(
    events: tuple[PortfolioLedgerEvent, ...] | list[PortfolioLedgerEvent],
) -> list[PortfolioLedgerEvent]:
    """One representative per consecutive same-episode run (first day + last confirmed)."""
    reviews = sorted(
        (e for e in events if e.kind == KIND_REVIEW),
        key=lambda e: (e.symbol, e.occurred_at, e.event_id),
    )
    out: list[PortfolioLedgerEvent] = []
    first: PortfolioLedgerEvent | None = None
    last: PortfolioLedgerEvent | None = None
    key: tuple[str, bool, bool] | None = None
    symbol: str | None = None

    def flush() -> None:
        if first is None or last is None:
            return
        confirmed = last.advice_last_confirmed_at or last.occurred_at
        out.append(dataclass_replace(first, advice_last_confirmed_at=confirmed))

    for event in reviews:
        event_key = _event_episode_key(event)
        if first is None or event.symbol != symbol or event_key != key:
            flush()
            first = event
            last = event
            key = event_key
            symbol = event.symbol
            continue
        last = event
    flush()
    return out


def _is_reduce_advice(event: PortfolioLedgerEvent) -> bool:
    """Sell/trim, or Hold that already asked for a reduce (overweight sleeve)."""
    action = (event.advice_action or "").lower()
    if action in _SELL_LIKE:
        return True
    reduce = event.advice_suggested_reduce
    return action == "hold" and reduce is not None and reduce > 0


def _episode_start(
    review: PortfolioLedgerEvent,
    same_symbol: tuple[PortfolioLedgerEvent, ...] | list[PortfolioLedgerEvent],
) -> str:
    """Earliest consecutive reduce-advice review for this symbol (inclusive).

    A next-day Sell snapshot after the user already sold must not reset the
    follow-through window to "no sale yet."
    """
    reviews = sorted(
        (e for e in same_symbol if e.kind == KIND_REVIEW),
        key=lambda e: (e.occurred_at, e.event_id),
    )
    start = review.occurred_at
    for event in reversed(reviews):
        if (event.occurred_at, event.event_id) > (review.occurred_at, review.event_id):
            continue
        if event.event_id == review.event_id or _is_reduce_advice(event):
            start = event.occurred_at
            continue
        break
    return start


def follow_through(
    review: PortfolioLedgerEvent,
    later: tuple[PortfolioLedgerEvent, ...] | list[PortfolioLedgerEvent],
) -> str:
    """Did a later sale/buy match the frozen review action? Computed at read time.

    Sell/trim (and Hold that already suggested a reduce) credit any sale on or
    after the start of the consecutive same-advice episode — so a 9/14 sale still
    counts as followed for a 9/15 Sell restamp. Plain Hold still diverges only on
    a sale on/after that review date.
    """
    if review.kind != KIND_REVIEW:
        return FOLLOW_NA
    action = (review.advice_action or "").lower()
    same = [e for e in later if e.symbol == review.symbol and e.event_id != review.event_id]
    if action in _SELL_LIKE or _is_reduce_advice(review):
        start = _episode_start(review, later)
        sales = any(e.kind == KIND_SALE and e.occurred_at >= start for e in same)
        return FOLLOWED if sales else IGNORED
    after = [e for e in same if e.occurred_at >= review.occurred_at]
    sales = any(e.kind == KIND_SALE for e in after)
    buys = any(e.kind == KIND_BUY for e in after)
    if action == "buy_more":
        return FOLLOWED if buys else IGNORED
    if action == "hold":
        return DIVERGED if sales else FOLLOWED
    return FOLLOW_NA


def ledger_summary(events: tuple[PortfolioLedgerEvent, ...] | list[PortfolioLedgerEvent]) -> dict[str, Any]:
    sales = [e for e in events if e.kind == KIND_SALE]
    reviews = collapse_review_episodes(events)
    realized = round(sum(e.realized_pl or 0.0 for e in sales), 2)

    def _bucket(attr: str) -> dict[str, int]:
        counts = {OUTCOME_FAVORABLE: 0, OUTCOME_UNFAVORABLE: 0, OUTCOME_NEUTRAL: 0, OUTCOME_PENDING: 0}
        scored = [
            e
            for e in (*sales, *(e for e in events if e.kind == KIND_BUY), *reviews)
            if not (e.kind == KIND_REVIEW and (e.advice_action or "") == "review")
        ]
        for e in scored:
            val = getattr(e, attr)
            if val in counts:
                counts[val] += 1
            else:
                counts[OUTCOME_PENDING] += 1
        return counts

    followed = ignored = diverged = 0
    for rev in reviews:
        ft = follow_through(rev, events)
        if ft == FOLLOWED:
            followed += 1
        elif ft == IGNORED:
            ignored += 1
        elif ft == DIVERGED:
            diverged += 1

    return {
        "salesCount": len(sales),
        "realizedPl": realized,
        "outcome30d": _bucket("outcome_30d"),
        "outcome90d": _bucket("outcome_90d"),
        "followThrough": {"followed": followed, "ignored": ignored, "diverged": diverged},
    }
