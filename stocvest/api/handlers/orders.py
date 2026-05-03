"""Order validation, submission with safety gates, status, and trading-mode profile."""

from __future__ import annotations

import asyncio
import dataclasses
import uuid
from typing import Any

from stocvest.api.broker_gateway_provider import DEFAULT_BROKER_GATEWAY_PROVIDER, BrokerGatewayProvider
from stocvest.api.response import bad_request, json_response, ok, unauthorized
from stocvest.api.services.journal_order_hooks import apply_journal_after_order_submit
from stocvest.api.services.order_safety import OrderAccountState, OrderSafetyGate
from stocvest.api.services.pdt_store import get_pdt_state_store
from stocvest.api.services.user_profile_store import get_user_profile_store
from stocvest.api.shared import build_request_context, parse_json_body
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
from stocvest.data import PolygonClient
from stocvest.data.models import TradingMode
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _query_params(event: LambdaEvent) -> dict[str, str]:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        return {}
    return {str(k): str(v) for k, v in query.items() if v is not None}


def _path_params(event: LambdaEvent) -> dict[str, str]:
    raw = event.get("pathParameters") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items() if v is not None}


def _validation_dict(result: Any) -> dict[str, Any]:
    if dataclasses.is_dataclass(result):
        return dataclasses.asdict(result)
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    return {}


def _run_order_op(fn: Any) -> dict[str, Any]:
    try:
        return asyncio.run(fn())
    except PDTViolationError as exc:
        return json_response(403, {"error": "pdt_violation", "message": str(exc)})
    except InsufficientFundsError as exc:
        return json_response(403, {"error": "insufficient_funds", "message": str(exc)})
    except MarketClosedError as exc:
        return json_response(403, {"error": "market_closed", "message": str(exc)})
    except UnknownSymbolError as exc:
        return json_response(400, {"error": "unknown_symbol", "message": str(exc)})
    except OrderQuantityLimitError as exc:
        return json_response(400, {"error": "quantity_limit", "message": str(exc)})
    except OrderRejectedError as exc:
        payload: dict[str, Any] = {"error": "order_rejected", "message": str(exc)}
        if exc.validation_result is not None:
            payload["validation"] = _validation_dict(exc.validation_result)
        return json_response(400, payload)
    except BrokerAuthError as exc:
        return json_response(401, {"error": "unauthorized", "message": str(exc)})
    except BrokerNotFoundError as exc:
        return json_response(404, {"error": "not_found", "message": str(exc)})
    except BrokerRateLimitError as exc:
        return json_response(429, {"error": "rate_limited", "message": str(exc)})
    except BrokerRejectedError as exc:
        return json_response(403, {"error": "forbidden", "message": str(exc)})
    except BrokerUnavailableError as exc:
        return json_response(503, {"error": "unavailable", "message": str(exc)})
    except ValueError as exc:
        return bad_request(str(exc))
    except Exception as exc:
        return json_response(500, {"error": "internal_error", "message": str(exc)})


def orders_validate_handler(
    event: LambdaEvent,
    context: LambdaContext,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    _ = gateway_provider
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
        request = _parse_order_body(body)
        account_state = _account_state_from_body(body, user_id=request_context.user_id)
    except Exception as exc:
        return bad_request(str(exc))

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            gate = OrderSafetyGate(client)
            result = await gate.validate_order(request_context.user_id, request, account_state)
        return ok(_validation_dict(result))

    return _run_order_op(_run)


def orders_submit_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
        if body.get("confirmed") is not True:
            return bad_request("confirmed must be true to submit an order.")
        signal_context = {
            k: body.get(k)
            for k in ("signal_id", "signal_strength", "confluence_score", "pattern", "signal_direction")
            if body.get(k) is not None
        }
        request = _parse_order_body(body)
        broker = str(body.get("broker") or "mock").strip().lower()
        account_id = str(body.get("account_id") or "").strip()
        if broker not in {"mock", "ibkr", "etrade"}:
            return bad_request("broker must be mock, ibkr, or etrade.")
        if not account_id:
            return bad_request("account_id is required.")
        account_state = _account_state_from_body(body, user_id=request_context.user_id)
    except Exception as exc:
        return bad_request(str(exc))

    profile = get_user_profile_store().get_profile(request_context.user_id)
    paper = profile.trading_mode == TradingMode.PAPER
    if paper:
        broker = "mock"

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            gate = OrderSafetyGate(client)
            connect_config = gateway_provider.build_connect_config(broker)
            connect_config["order_safety_gate"] = gate
            connect_config["order_safety_user_id"] = request_context.user_id
            connect_config["order_safety_account_state"] = account_state
            adapter = factory.create(broker)
            try:
                await adapter.connect(connect_config)
                ack = await adapter.place_order(account_id, request)
                await apply_journal_after_order_submit(
                    user_id=request_context.user_id,
                    broker=broker,
                    account_id=account_id,
                    request=request,
                    ack=ack,
                    adapter=adapter,
                    signal_context=signal_context or None,
                    is_day_trade=account_state.is_day_trade,
                )
            finally:
                await adapter.disconnect()
        _LOG.info(
            "order_submit_ok user=%s symbol=%s side=%s qty=%s mode=%s",
            request_context.user_id,
            request.symbol,
            request.side.value,
            request.quantity,
            "paper" if paper else "live",
        )
        return ok(ack.model_dump(mode="json"))

    return _run_order_op(_run)


def orders_status_handler(
    event: LambdaEvent,
    context: LambdaContext,
    factory: type[BrokerAdapterFactory] = BrokerAdapterFactory,
    gateway_provider: BrokerGatewayProvider = DEFAULT_BROKER_GATEWAY_PROVIDER,
) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    path = _path_params(event)
    order_id = str(path.get("order_id") or "").strip()
    if not order_id:
        return bad_request("order_id path parameter is required.")
    query = _query_params(event)
    broker = str(query.get("broker") or "").strip().lower()
    account_id = str(query.get("account_id") or "").strip()
    if broker not in {"mock", "ibkr", "etrade"}:
        return bad_request("Query param broker is required.")
    if not account_id:
        return bad_request("Query param account_id is required.")

    async def _run() -> dict[str, Any]:
        connect_config = gateway_provider.build_connect_config(broker)
        adapter = factory.create(broker)
        try:
            await adapter.connect(connect_config)
            status = await adapter.get_order(account_id, order_id)
        finally:
            await adapter.disconnect()
        return ok(status.model_dump(mode="json"))

    return _run_order_op(_run)


def profile_trading_mode_get_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    profile = get_user_profile_store().get_profile(request_context.user_id)
    return ok({"user_id": profile.user_id, "trading_mode": profile.trading_mode.value})


def profile_trading_mode_post_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    request_context = build_request_context(event)
    if not request_context.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
        raw = str(body.get("trading_mode") or "").strip().lower()
        mode = TradingMode(raw)
    except ValueError:
        return bad_request("trading_mode must be 'paper' or 'live'.")
    get_user_profile_store().set_trading_mode(request_context.user_id, mode)
    return ok({"trading_mode": mode.value})


def _parse_order_body(body: dict[str, Any]) -> PlaceOrderRequest:
    data = dict(body)
    cid = data.get("client_order_id")
    if not cid or not str(cid).strip():
        data["client_order_id"] = f"ord-{uuid.uuid4().hex[:16]}"
    return PlaceOrderRequest.model_validate(data)


def _account_state_from_body(body: dict[str, Any], *, user_id: str) -> OrderAccountState:
    profile = get_user_profile_store().get_profile(user_id)
    paper = profile.trading_mode == TradingMode.PAPER
    cash_raw = body.get("available_cash")
    if cash_raw is None:
        available_cash = float("inf") if paper else 0.0
    else:
        available_cash = float(cash_raw)
    is_day_trade = bool(body.get("is_day_trade", True))
    pdt_state = get_pdt_state_store().get_state(user_id)
    return OrderAccountState(
        trading_mode_is_paper=paper,
        available_cash=available_cash,
        is_day_trade=is_day_trade,
        pdt_state=pdt_state,
    )
