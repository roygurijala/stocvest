"""Phase 4e broker endpoint handlers."""

from __future__ import annotations

import asyncio
import dataclasses
from typing import Any

from stocvest.api.broker_gateway_provider import (
    DEFAULT_BROKER_GATEWAY_PROVIDER,
    BrokerGatewayProvider,
)
from stocvest.api.response import (
    bad_request,
    forbidden,
    internal_error,
    json_response,
    not_found,
    ok,
    unauthorized,
)
from stocvest.api.shared import parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.brokers import (
    BrokerAdapterFactory,
    BrokerAuthError,
    BrokerNotFoundError,
    BrokerRateLimitError,
    BrokerRejectedError,
    BrokerUnavailableError,
    InsufficientFundsError,
    MarketClosedError,
    OrderQuantityLimitError,
    OrderRejectedError,
    PDTViolationError,
    PlaceOrderRequest,
    UnknownSymbolError,
)


def broker_health_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    broker, account_id = _extract_broker_context(event)
    if broker is None:
        return bad_request("Query param 'broker' is required.")
    try:
        connect_config = _connect_config_from_environment(event, broker, gateway_provider)
    except ValueError as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            health = await adapter.health_check()
            payload: dict[str, Any] = {"broker": broker, **health.model_dump(mode="json")}
            if account_id:
                payload["account_id"] = account_id
            return ok(payload)
        finally:
            await adapter.disconnect()

    return _run_with_broker_error_mapping(_run)


def broker_accounts_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    broker, _ = _extract_broker_context(event)
    if broker is None:
        return bad_request("Query param 'broker' is required.")
    try:
        connect_config = _connect_config_from_environment(event, broker, gateway_provider)
    except ValueError as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            accounts = await adapter.list_accounts()
            return ok([a.model_dump(mode="json") for a in accounts])
        finally:
            await adapter.disconnect()

    return _run_with_broker_error_mapping(_run)


def broker_overview_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    broker, _ = _extract_broker_context(event)
    if broker is None:
        return bad_request("Query param 'broker' is required.")
    try:
        connect_config = _connect_config_from_environment(event, broker, gateway_provider)
    except ValueError as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            health = await adapter.health_check()
            accounts = await adapter.list_accounts()
            positions_by_account: dict[str, list[dict[str, Any]]] = {}
            for account in accounts:
                positions = await adapter.get_positions(account.account_id)
                positions_by_account[account.account_id] = [p.model_dump(mode="json") for p in positions]
            return ok(
                {
                    "broker": broker,
                    "health": health.model_dump(mode="json"),
                    "accounts": [a.model_dump(mode="json") for a in accounts],
                    "positions_by_account": positions_by_account,
                }
            )
        finally:
            await adapter.disconnect()

    return _run_with_broker_error_mapping(_run)


def broker_positions_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    broker, account_id = _extract_broker_context(event)
    if broker is None:
        return bad_request("Query param 'broker' is required.")
    if not account_id:
        return bad_request("Query param 'account_id' is required.")
    try:
        connect_config = _connect_config_from_environment(event, broker, gateway_provider)
    except ValueError as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            positions = await adapter.get_positions(account_id)
            return ok([p.model_dump(mode="json") for p in positions])
        finally:
            await adapter.disconnect()

    return _run_with_broker_error_mapping(_run)


def broker_place_order_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    broker, account_id = _extract_broker_context(event)
    if broker is None:
        return bad_request("Query param 'broker' is required.")
    if not account_id:
        return bad_request("Query param 'account_id' is required.")
    try:
        connect_config = _connect_config_from_environment(event, broker, gateway_provider)
    except ValueError as exc:
        return bad_request(str(exc))

    try:
        payload = parse_json_body(event)
        _reject_caller_gateway_fields(payload)
        request = PlaceOrderRequest.model_validate(payload)
    except ValueError as exc:
        return bad_request(str(exc))
    except Exception as exc:
        return bad_request(f"Invalid order payload: {exc}")

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            ack = await adapter.place_order(account_id, request)
            return ok(ack.model_dump(mode="json"))
        finally:
            await adapter.disconnect()

    return _run_with_broker_error_mapping(_run)


def broker_get_order_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    query = _query_params(event)
    broker = _clean(query.get("broker"))
    account_id = _clean(query.get("account_id"))
    client_order_id = _clean(query.get("client_order_id"))
    if not broker:
        return bad_request("Query param 'broker' is required.")
    if not account_id:
        return bad_request("Query param 'account_id' is required.")
    if not client_order_id:
        return bad_request("Query param 'client_order_id' is required.")
    try:
        connect_config = _connect_config_from_environment(event, broker, gateway_provider)
    except ValueError as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            order = await adapter.get_order(account_id, client_order_id)
            return ok(order.model_dump(mode="json"))
        finally:
            await adapter.disconnect()

    return _run_with_broker_error_mapping(_run)


def broker_cancel_order_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    query = _query_params(event)
    broker = _clean(query.get("broker"))
    account_id = _clean(query.get("account_id"))
    client_order_id = _clean(query.get("client_order_id"))
    if not broker:
        return bad_request("Query param 'broker' is required.")
    if not account_id:
        return bad_request("Query param 'account_id' is required.")
    if not client_order_id:
        return bad_request("Query param 'client_order_id' is required.")
    try:
        connect_config = _connect_config_from_environment(event, broker, gateway_provider)
    except ValueError as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            await adapter.cancel_order(account_id, client_order_id)
            return ok({"cancelled": True, "client_order_id": client_order_id})
        finally:
            await adapter.disconnect()

    return _run_with_broker_error_mapping(_run)


def _run_with_broker_error_mapping(fn: Any) -> dict[str, Any]:
    try:
        return asyncio.run(fn())
    except BrokerAuthError as exc:
        return unauthorized(str(exc))
    except BrokerNotFoundError as exc:
        return not_found(str(exc))
    except BrokerRateLimitError as exc:
        return json_response(429, {"error": "rate_limited", "message": str(exc)})
    except PDTViolationError as exc:
        return json_response(403, {"error": "pdt_violation", "message": str(exc)})
    except InsufficientFundsError as exc:
        return json_response(403, {"error": "insufficient_funds", "message": str(exc)})
    except MarketClosedError as exc:
        return json_response(403, {"error": "market_closed", "message": str(exc)})
    except UnknownSymbolError as exc:
        return bad_request(str(exc))
    except OrderQuantityLimitError as exc:
        return bad_request(str(exc))
    except OrderRejectedError as exc:
        payload: dict[str, Any] = {"error": "order_rejected", "message": str(exc)}
        if exc.validation_result is not None and dataclasses.is_dataclass(exc.validation_result):
            payload["validation"] = dataclasses.asdict(exc.validation_result)
        return json_response(400, payload)
    except BrokerRejectedError as exc:
        return forbidden(str(exc))
    except BrokerUnavailableError as exc:
        return json_response(503, {"error": "unavailable", "message": str(exc)})
    except ValueError as exc:
        return bad_request(str(exc))
    except Exception as exc:
        return internal_error(str(exc))


def _extract_broker_context(event: LambdaEvent) -> tuple[str | None, str | None]:
    query = _query_params(event)
    broker = _clean(query.get("broker"))
    account_id = _clean(query.get("account_id"))
    return broker, account_id


def _connect_config_from_environment(
    event: LambdaEvent,
    broker: str,
    gateway_provider: BrokerGatewayProvider,
) -> dict[str, Any]:
    payload = _optional_body_payload(event)
    _reject_caller_gateway_fields(payload)
    return gateway_provider.build_connect_config(broker)


def _optional_body_payload(event: LambdaEvent) -> dict[str, Any]:
    body = event.get("body")
    if body is None or body == "":
        return {}
    try:
        parsed = parse_json_body(event)
    except ValueError:
        return {}
    return parsed


def _reject_caller_gateway_fields(payload: dict[str, Any]) -> None:
    if "gateway" in payload:
        raise ValueError("HTTP callers must not supply 'gateway'.")
    connect_config = payload.get("connect_config")
    if isinstance(connect_config, dict) and "gateway" in connect_config:
        raise ValueError("HTTP callers must not supply connect_config.gateway.")


def _query_params(event: LambdaEvent) -> dict[str, str]:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        return {}
    return query


def _clean(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None

