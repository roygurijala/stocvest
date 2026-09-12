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

from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, not_found, ok, unauthorized
from stocvest.api.services.holdings_store import get_holdings_store
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.text_sanitize import sanitize_optional_free_text
from stocvest.api.types import LambdaContext, LambdaEvent
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
    for prefix in ("DELETE /v1/holdings/", "PUT /v1/holdings/"):
        if rk.startswith(prefix):
            rest = rk[len(prefix) :].split("?")[0].strip()
            if rest and not rest.startswith("{") and rest not in ("sync", "settings"):
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


def holdings_upsert_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        payload = parse_json_body(event)
        holding = _parse_holding(payload)
        get_holdings_store().upsert_holding(request_context.user_id, holding)
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
    if rk == "GET /v1/holdings" or rk.startswith("GET /v1/holdings?"):
        return holdings_list_handler(event, context)
    if rk == "PUT /v1/holdings/sync":
        return holdings_sync_handler(event, context)
    if rk == "PUT /v1/holdings":
        return holdings_upsert_handler(event, context)
    if rk.upper().startswith("DELETE"):
        return holdings_delete_handler(event, context)
    _LOG.warning("holdings_dispatch unknown route: %s", rk)
    return not_found(f"Unknown holdings route: {rk or '(empty)'}")
