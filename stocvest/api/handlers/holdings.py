"""Manual portfolio holdings endpoints — user-scoped, per-lot cost basis.

Backs the STOCVEST-managed personal portfolio (distinct from the paused broker
`portfolio.py`). Routes under ``/v1/holdings``:

- ``GET  /v1/holdings``              → list all holdings (with derived qty/avg-cost)
- ``PUT  /v1/holdings``              → upsert one symbol's holding (its full lot set)
- ``PUT  /v1/holdings/sync``         → replace the whole portfolio in one call
- ``DELETE /v1/holdings/{symbol}``   → remove a symbol
- ``GET  /v1/holdings/settings``     → portfolio settings (cash, target sizing, benchmark)
- ``PUT  /v1/holdings/settings``     → update portfolio settings
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, not_found, ok, unauthorized
from stocvest.api.services.holdings_store import get_holdings_store
from stocvest.api.services.portfolio_advice_ledger import (
    get_portfolio_advice_ledger_store,
    ledger_to_api,
)
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.text_sanitize import sanitize_optional_free_text
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.models.portfolio_advice_ledger import (
    KIND_BUY,
    KIND_SALE,
    PortfolioLedgerEvent,
    added_quantity,
    advice_stamp_from_review_row,
    apply_sale,
    new_event_id,
)
from stocvest.models.portfolio_advice_ledger import _coerce_iso_date as _ledger_date
from stocvest.models.portfolio_holding import (
    MAX_HOLDINGS_PER_USER,
    HoldingLot,
    PortfolioHolding,
    PortfolioSettings,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _symbol_from_event(event: LambdaEvent) -> str | None:
    pp = event.get("pathParameters") or {}
    raw = pp.get("symbol")
    if raw and not str(raw).startswith("{"):
        return str(raw).strip().upper()
    rk = http_route_descriptor(event)
    for prefix in ("DELETE /v1/holdings/", "PUT /v1/holdings/", "POST /v1/holdings/"):
        if rk.startswith(prefix):
            rest = rk[len(prefix) :].split("?")[0].strip()
            # Strip a trailing action segment (e.g. ".../split").
            rest = rest.split("/")[0]
            if rest and not rest.startswith("{") and rest not in ("sync", "settings", "ledger"):
                return rest.upper()
    return None


def _parse_holding(payload: dict[str, Any]) -> PortfolioHolding:
    if payload.get("userId") is not None or payload.get("user_id") is not None:
        raise ValueError("Do not submit user id; identity is taken from your session.")
    holding = PortfolioHolding.from_api(payload)
    # Sanitize any free-text lot notes before persistence (privacy rule).
    clean_lots = tuple(
        HoldingLot(
            lot_id=lot.lot_id,
            quantity=lot.quantity,
            cost_basis=lot.cost_basis,
            purchase_date=lot.purchase_date,
            note=sanitize_optional_free_text(lot.note, max_len=256) if lot.note else None,
        )
        for lot in holding.lots
    )
    return PortfolioHolding(symbol=holding.symbol, lots=clean_lots)


def holdings_list_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    holdings = get_holdings_store().list_holdings(request_context.user_id)
    return ok([h.to_api() for h in holdings])


def _review_row_for_symbol(user_id: str, symbol: str) -> tuple[dict[str, Any] | None, str | None]:
    review, cached_at = get_holdings_store().get_cached_review(user_id)
    if not isinstance(review, dict):
        return None, cached_at
    for row in review.get("holdings") or []:
        if isinstance(row, dict) and str(row.get("symbol") or "").upper() == symbol:
            return row, cached_at
    return None, cached_at


def _record_buy_if_added(
    user_id: str,
    previous: PortfolioHolding | None,
    holding: PortfolioHolding,
    *,
    stamp: dict[str, Any] | None = None,
) -> None:
    delta = added_quantity(previous, holding)
    if delta <= 0:
        return
    occurred = holding.earliest_purchase_date() or ""
    if previous is not None:
        # Prefer the newest lot date as the add date when quantity increased.
        occurred = max(lot.purchase_date for lot in holding.lots)
    if stamp is None:
        row, cached_at = _review_row_for_symbol(user_id, holding.symbol)
        stamp = advice_stamp_from_review_row(row, cached_at=cached_at)
    event = PortfolioLedgerEvent(
        event_id=new_event_id(occurred_at=occurred),
        user_id=user_id,
        kind=KIND_BUY,
        symbol=holding.symbol,
        occurred_at=occurred,
        quantity=delta,
        price_per_share=holding.average_cost,
        cost_basis_per_share=holding.average_cost,
        remaining_quantity=holding.total_quantity,
        **stamp,
    )
    get_portfolio_advice_ledger_store().append(event)


def holdings_upsert_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        holding = _parse_holding(payload)
        store = get_holdings_store()
        previous = next(
            (h for h in store.list_holdings(request_context.user_id) if h.symbol == holding.symbol),
            None,
        )
        # Stamp before upsert — writes wipe reviewCache.
        row, cached_at = _review_row_for_symbol(request_context.user_id, holding.symbol)
        stamp = advice_stamp_from_review_row(row, cached_at=cached_at)
        store.upsert_holding(request_context.user_id, holding)
        _record_buy_if_added(request_context.user_id, previous, holding, stamp=stamp)
        return ok(holding.to_api())
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid holding: {exc}")


def holdings_sync_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        raw = payload.get("holdings")
        if not isinstance(raw, list):
            return bad_request("holdings must be an array.")
        if len(raw) > MAX_HOLDINGS_PER_USER:
            return bad_request(f"At most {MAX_HOLDINGS_PER_USER} holdings allowed.")
        parsed: list[PortfolioHolding] = []
        for row in raw:
            if not isinstance(row, dict):
                return bad_request("Each holding must be an object.")
            parsed.append(_parse_holding(row))
        store = get_holdings_store()
        store.replace_all(request_context.user_id, tuple(parsed))
        return ok([h.to_api() for h in store.list_holdings(request_context.user_id)])
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid holdings sync: {exc}")


def holdings_settings_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    settings = get_holdings_store().get_settings(request_context.user_id)
    return ok(settings.to_api())


def holdings_settings_put_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        if payload.get("userId") is not None or payload.get("user_id") is not None:
            raise ValueError("Do not submit user id; identity is taken from your session.")
        settings = PortfolioSettings.from_api(payload)
        get_holdings_store().save_settings(request_context.user_id, settings)
        return ok(settings.to_api())
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid portfolio settings: {exc}")


def _split_ratio_from_body(payload: dict[str, Any]) -> float:
    """Resolve a split ratio from either ``{ratio}`` or ``{numerator, denominator}``.

    ``ratio`` is new-shares-per-old-share (2:1 forward = 2.0, 1:10 reverse = 0.1). When
    given as a fraction, ``ratio = numerator / denominator`` (2:1 → num 2, den 1).
    """
    if payload.get("userId") is not None or payload.get("user_id") is not None:
        raise ValueError("Do not submit user id; identity is taken from your session.")
    ratio_raw = payload.get("ratio")
    if ratio_raw is not None:
        ratio = float(ratio_raw)
    else:
        num = payload.get("numerator")
        den = payload.get("denominator")
        if num is None or den is None:
            raise ValueError("Provide either 'ratio' or both 'numerator' and 'denominator'.")
        num_f = float(num)
        den_f = float(den)
        if num_f <= 0 or den_f <= 0:
            raise ValueError("numerator and denominator must be > 0.")
        ratio = num_f / den_f
    if ratio <= 0:
        raise ValueError("split ratio must be > 0.")
    return ratio


def holdings_split_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    symbol = _symbol_from_event(event)
    if not symbol:
        return bad_request("symbol is required.")
    try:
        payload = parse_json_body(event)
        ratio = _split_ratio_from_body(payload)
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid split: {exc}")
    updated = get_holdings_store().apply_split(request_context.user_id, symbol, ratio)
    if updated is None:
        return not_found("Holding not found.")
    return ok(updated.to_api())


def holdings_sale_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """Record a sale: FIFO lot reduce, optional cash credit, advice stamp from last review."""
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    symbol = _symbol_from_event(event)
    if not symbol:
        return bad_request("symbol is required.")
    try:
        payload = parse_json_body(event)
        if payload.get("userId") is not None or payload.get("user_id") is not None:
            raise ValueError("Do not submit user id; identity is taken from your session.")
        qty = float(payload.get("quantity") or payload.get("quantitySold") or 0)
        price = float(payload.get("salePrice") or payload.get("salePricePerShare") or 0)
        if price < 0:
            raise ValueError("salePrice must be >= 0.")
        sold_at = str(payload.get("soldAt") or payload.get("occurredAt") or "").strip()
        credit_cash = payload.get("creditCash", True)
        if isinstance(credit_cash, str):
            credit_cash = credit_cash.strip().lower() not in ("0", "false", "no")
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid sale: {exc}")

    store = get_holdings_store()
    uid = request_context.user_id
    held = next((h for h in store.list_holdings(uid) if h.symbol == symbol), None)
    if held is None:
        return not_found("Holding not found.")
    row, cached_at = _review_row_for_symbol(uid, symbol)
    stamp = advice_stamp_from_review_row(row, cached_at=cached_at)
    try:
        applied = apply_sale(held, qty)
    except ValueError as exc:
        return bad_request(str(exc))

    if applied.remaining is None:
        store.remove_holding(uid, symbol)
    else:
        store.upsert_holding(uid, applied.remaining)

    proceeds = round(applied.quantity_sold * price, 2)
    cash_credited = None
    if credit_cash:
        settings = store.get_settings(uid)
        store.save_settings(
            uid,
            PortfolioSettings(
                cash_balance=round(settings.cash_balance + proceeds, 2),
                target_position_pct=settings.target_position_pct,
                benchmark_symbol=settings.benchmark_symbol,
            ),
        )
        cash_credited = proceeds

    realized = round((price - applied.cost_basis_per_share) * applied.quantity_sold, 2)
    realized_pct = (
        round(((price - applied.cost_basis_per_share) / applied.cost_basis_per_share) * 100.0, 2)
        if applied.cost_basis_per_share
        else None
    )
    try:
        occurred = _ledger_date(sold_at) if sold_at else _ledger_date(datetime.now(timezone.utc))
    except ValueError as exc:
        return bad_request(f"Invalid sale date: {exc}")

    if stamp.get("price_at_advice") is None:
        stamp = {**stamp, "price_at_advice": price}

    event = PortfolioLedgerEvent(
        event_id=new_event_id(occurred_at=occurred),
        user_id=uid,
        kind=KIND_SALE,
        symbol=symbol,
        occurred_at=occurred,
        quantity=applied.quantity_sold,
        price_per_share=price,
        cost_basis_per_share=applied.cost_basis_per_share,
        realized_pl=realized,
        realized_pl_pct=realized_pct,
        remaining_quantity=applied.remaining_quantity,
        lot_ids=applied.lot_ids,
        cash_credited=cash_credited,
        **stamp,
    )
    get_portfolio_advice_ledger_store().append(event)
    remaining_api = applied.remaining.to_api() if applied.remaining is not None else None
    return ok({"sale": event.to_api(), "holding": remaining_api})


def holdings_ledger_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    import os

    # Live Lambda: fill due 30/90d closes. Tests / local stay offline.
    resolve = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
    body = ledger_to_api(request_context.user_id, resolve=resolve)
    return ok(body)


def holdings_delete_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    symbol = _symbol_from_event(event)
    if not symbol:
        return bad_request("symbol is required.")
    removed = get_holdings_store().remove_holding(request_context.user_id, symbol)
    if not removed:
        return not_found("Holding not found.")
    return ok({"deleted": True, "symbol": symbol})


def holdings_dispatch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    rk = http_route_descriptor(event)
    if rk == "GET /v1/holdings/settings" or rk.startswith("GET /v1/holdings/settings?"):
        return holdings_settings_get_handler(event, context)
    if rk == "PUT /v1/holdings/settings":
        return holdings_settings_put_handler(event, context)
    if rk == "GET /v1/holdings/ledger" or rk.startswith("GET /v1/holdings/ledger?"):
        return holdings_ledger_handler(event, context)
    if rk == "GET /v1/holdings" or rk.startswith("GET /v1/holdings?"):
        return holdings_list_handler(event, context)
    if rk == "PUT /v1/holdings/sync":
        return holdings_sync_handler(event, context)
    if rk == "PUT /v1/holdings":
        return holdings_upsert_handler(event, context)
    if rk.upper().startswith("POST") and rk.rstrip("/").endswith("/sale"):
        return holdings_sale_handler(event, context)
    if rk.upper().startswith("POST") and rk.rstrip("/").endswith("/split"):
        return holdings_split_handler(event, context)
    if rk.upper().startswith("DELETE"):
        return holdings_delete_handler(event, context)
    _LOG.warning("holdings_dispatch unknown route: %s", rk)
    return not_found(f"Unknown holdings route: {rk or '(empty)'}")
