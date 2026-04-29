"""Phase 4f portfolio endpoint handlers."""

from __future__ import annotations

import asyncio
from typing import Any

from stocvest.api.response import bad_request, internal_error, json_response, not_found, ok, unauthorized
from stocvest.api.shared import parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.brokers import (
    BrokerAdapterFactory,
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerPosition,
    BrokerRateLimitError,
    BrokerUnavailableError,
)


def portfolio_holdings_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
) -> dict[str, Any]:
    _ = context
    broker, account_id, connect_config = _extract_context(event)
    if not broker:
        return bad_request("Query param 'broker' is required.")
    if not account_id:
        return bad_request("Query param 'account_id' is required.")

    prices = _extract_prices(event)

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            positions = await adapter.get_positions(account_id)
            holdings = [_holding_payload(p, prices.get(p.symbol.upper())) for p in positions]
            return ok({"broker": broker, "account_id": account_id, "holdings": holdings})
        finally:
            await adapter.disconnect()

    return _run_with_error_mapping(_run)


def portfolio_summary_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
) -> dict[str, Any]:
    _ = context
    broker, account_id, connect_config = _extract_context(event)
    if not broker:
        return bad_request("Query param 'broker' is required.")
    if not account_id:
        return bad_request("Query param 'account_id' is required.")

    prices = _extract_prices(event)

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            positions = await adapter.get_positions(account_id)
            summary = _portfolio_summary(positions, prices)
            return ok({"broker": broker, "account_id": account_id, **summary})
        finally:
            await adapter.disconnect()

    return _run_with_error_mapping(_run)


def portfolio_allocation_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
) -> dict[str, Any]:
    _ = context
    broker, account_id, connect_config = _extract_context(event)
    if not broker:
        return bad_request("Query param 'broker' is required.")
    if not account_id:
        return bad_request("Query param 'account_id' is required.")

    prices = _extract_prices(event)

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            positions = await adapter.get_positions(account_id)
            rows = _allocation_rows(positions, prices)
            return ok({"broker": broker, "account_id": account_id, "allocation": rows})
        finally:
            await adapter.disconnect()

    return _run_with_error_mapping(_run)


def _run_with_error_mapping(fn: Any) -> dict[str, Any]:
    try:
        return asyncio.run(fn())
    except BrokerAuthError as exc:
        return unauthorized(str(exc))
    except BrokerNotFoundError as exc:
        return not_found(str(exc))
    except BrokerRateLimitError as exc:
        return json_response(429, {"error": "rate_limited", "message": str(exc)})
    except BrokerUnavailableError as exc:
        return json_response(503, {"error": "unavailable", "message": str(exc)})
    except ValueError as exc:
        return bad_request(str(exc))
    except Exception as exc:
        return internal_error(str(exc))


def _extract_context(event: LambdaEvent) -> tuple[str | None, str | None, dict[str, Any]]:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        query = {}
    broker = _clean(query.get("broker"))
    account_id = _clean(query.get("account_id"))
    connect_config = _extract_connect_config(event)
    return broker, account_id, connect_config


def _extract_connect_config(event: LambdaEvent) -> dict[str, Any]:
    body = event.get("body")
    if body is None or body == "":
        return {}
    try:
        parsed = parse_json_body(event)
    except ValueError:
        return {}
    connect_config = parsed.get("connect_config", {})
    return connect_config if isinstance(connect_config, dict) else {}


def _extract_prices(event: LambdaEvent) -> dict[str, float]:
    body = event.get("body")
    if body is None or body == "":
        return {}
    try:
        payload = parse_json_body(event)
    except ValueError:
        return {}
    raw = payload.get("prices", {})
    if not isinstance(raw, dict):
        return {}
    prices: dict[str, float] = {}
    for symbol, value in raw.items():
        try:
            prices[str(symbol).upper()] = float(value)
        except (TypeError, ValueError):
            continue
    return prices


def _holding_payload(position: BrokerPosition, mark_price: float | None) -> dict[str, Any]:
    qty = float(position.quantity)
    avg = float(position.avg_cost) if position.avg_cost is not None else None
    market_value = (mark_price * qty) if mark_price is not None else None
    cost_basis = (avg * qty) if avg is not None else None
    unrealized_pnl = (
        market_value - cost_basis
        if market_value is not None and cost_basis is not None
        else None
    )
    return {
        "symbol": position.symbol.upper(),
        "quantity": qty,
        "avg_cost": avg,
        "mark_price": mark_price,
        "market_value": market_value,
        "cost_basis": cost_basis,
        "unrealized_pnl": unrealized_pnl,
    }


def _portfolio_summary(positions: list[BrokerPosition], prices: dict[str, float]) -> dict[str, Any]:
    total_market_value = 0.0
    total_cost_basis = 0.0
    gross_exposure = 0.0
    net_exposure = 0.0
    priced_count = 0

    for position in positions:
        qty = float(position.quantity)
        symbol = position.symbol.upper()
        price = prices.get(symbol)
        avg = float(position.avg_cost) if position.avg_cost is not None else None
        if price is not None:
            mv = price * qty
            total_market_value += mv
            gross_exposure += abs(mv)
            net_exposure += mv
            priced_count += 1
        if avg is not None:
            total_cost_basis += avg * qty

    return {
        "positions_count": len(positions),
        "priced_positions_count": priced_count,
        "total_market_value": round(total_market_value, 4),
        "total_cost_basis": round(total_cost_basis, 4),
        "gross_exposure": round(gross_exposure, 4),
        "net_exposure": round(net_exposure, 4),
        "unrealized_pnl": round(total_market_value - total_cost_basis, 4),
    }


def _allocation_rows(positions: list[BrokerPosition], prices: dict[str, float]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    values: list[float] = []
    for position in positions:
        price = prices.get(position.symbol.upper())
        if price is None:
            values.append(0.0)
        else:
            values.append(price * float(position.quantity))
    gross = sum(abs(v) for v in values) or 1.0

    for position, market_value in zip(positions, values):
        weight = abs(market_value) / gross
        rows.append(
            {
                "symbol": position.symbol.upper(),
                "quantity": float(position.quantity),
                "market_value": round(market_value, 4),
                "weight": round(weight, 6),
                "side": "long" if position.quantity >= 0 else "short",
            }
        )
    rows.sort(key=lambda r: abs(float(r["market_value"])), reverse=True)
    return rows


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None

