"""Root ``lambda_handler`` for deployed API Lambdas — dispatches by ``STOCVEST_LAMBDA_MODULE``."""

from __future__ import annotations

import os
from typing import Any, Callable

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import not_found
from stocvest.api.types import LambdaContext, LambdaEvent

_Handler = Callable[[LambdaEvent, LambdaContext], dict[str, Any]]


def _dispatch_http_routes(
    event: LambdaEvent,
    context: LambdaContext,
    routes: dict[str, _Handler],
) -> dict[str, Any]:
    route = http_route_descriptor(event)
    target = routes.get(route)
    if target is None:
        return not_found(f"Unknown route: {route or '(empty)'}.")
    return target(event, context)


def _websocket_route(event: LambdaEvent) -> str:
    rc = event.get("requestContext") or {}
    if not isinstance(rc, dict):
        return "$default"
    rk = rc.get("routeKey")
    if isinstance(rk, str) and rk.strip():
        return rk.strip()
    # Payload format 1.0 may expose eventType without routeKey in some tests.
    et = str(rc.get("eventType") or "").upper()
    if et == "CONNECT":
        return "$connect"
    if et == "DISCONNECT":
        return "$disconnect"
    return "$default"


def lambda_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    module = os.environ.get("STOCVEST_LAMBDA_MODULE", "").strip()
    if not module:
        return not_found("STOCVEST_LAMBDA_MODULE is not set.")

    if module == "health":
        from stocvest.api.handlers.health import handler as h

        return h(event, context)

    if module == "authorizer":
        from stocvest.api.handlers.authorizer import handler as h

        return h(event, context)

    if module == "market_data":
        from stocvest.api.handlers.market_data import (
            bars_handler,
            earnings_calendar_handler,
            market_status_handler,
            news_handler,
            options_chain_handler,
            snapshot_handler,
        )

        return _dispatch_http_routes(
            event,
            context,
            {
                "GET /v1/market/status": market_status_handler,
                "GET /v1/market/snapshot": snapshot_handler,
                "GET /v1/market/bars": bars_handler,
                "GET /v1/market/news": news_handler,
                "GET /v1/market/options": options_chain_handler,
                "GET /v1/market/earnings": earnings_calendar_handler,
            },
        )

    if module == "signals":
        from stocvest.api.handlers.signals import (
            day_briefing_handler,
            day_setups_handler,
            public_performance_summary_handler,
            public_recent_signals_handler,
            swing_composite_handler,
            swing_synthesis_parse_handler,
        )

        return _dispatch_http_routes(
            event,
            context,
            {
                "POST /v1/signals/swing/composite": swing_composite_handler,
                "POST /v1/signals/swing/synthesis/parse": swing_synthesis_parse_handler,
                "POST /v1/signals/day/setups": day_setups_handler,
                "POST /v1/signals/day/briefing": day_briefing_handler,
                "GET /v1/signals/recent": public_recent_signals_handler,
                "GET /v1/signals/performance/summary": public_performance_summary_handler,
            },
        )

    if module == "brokers":
        from stocvest.api.handlers.brokers import (
            broker_accounts_handler,
            broker_cancel_order_handler,
            broker_get_order_handler,
            broker_health_handler,
            broker_overview_handler,
            broker_place_order_handler,
            broker_positions_handler,
        )

        return _dispatch_http_routes(
            event,
            context,
            {
                "GET /v1/brokers/health": broker_health_handler,
                "GET /v1/brokers/accounts": broker_accounts_handler,
                "GET /v1/brokers/positions": broker_positions_handler,
                "GET /v1/brokers/overview": broker_overview_handler,
                "POST /v1/brokers/orders": broker_place_order_handler,
                "GET /v1/brokers/orders": broker_get_order_handler,
                "DELETE /v1/brokers/orders": broker_cancel_order_handler,
            },
        )

    if module == "portfolio":
        from stocvest.api.handlers.portfolio import (
            portfolio_allocation_handler,
            portfolio_holdings_handler,
            portfolio_summary_handler,
        )

        return _dispatch_http_routes(
            event,
            context,
            {
                "POST /v1/portfolio/holdings": portfolio_holdings_handler,
                "POST /v1/portfolio/summary": portfolio_summary_handler,
                "POST /v1/portfolio/allocation": portfolio_allocation_handler,
            },
        )

    if module == "journal":
        from stocvest.api.handlers.journal import journal_create_entry_handler, journal_list_entries_handler

        return _dispatch_http_routes(
            event,
            context,
            {
                "GET /v1/journal/entries": journal_list_entries_handler,
                "POST /v1/journal/entries": journal_create_entry_handler,
            },
        )

    if module == "pdt":
        from stocvest.api.handlers.pdt import pdt_status_handler

        return _dispatch_http_routes(event, context, {"GET /v1/pdt/status": pdt_status_handler})

    if module == "scanner":
        from stocvest.api.handlers.scanner import handler as scanner_handler

        return scanner_handler(event, context)

    if module == "websocket":
        from stocvest.api.handlers.websocket import (
            websocket_connect_handler,
            websocket_default_handler,
            websocket_disconnect_handler,
        )

        route = _websocket_route(event)
        if route == "$connect":
            return websocket_connect_handler(event, context)
        if route == "$disconnect":
            return websocket_disconnect_handler(event, context)
        return websocket_default_handler(event, context)

    return not_found(f"Unknown STOCVEST_LAMBDA_MODULE: {module}.")
