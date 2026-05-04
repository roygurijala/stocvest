"""Root ``lambda_handler`` for deployed API Lambdas — dispatches by ``STOCVEST_LAMBDA_MODULE``."""

from __future__ import annotations

import os
from typing import Any, Callable

from stocvest.api.cors import apply_cors_to_http_proxy_response
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
        return apply_cors_to_http_proxy_response(not_found("STOCVEST_LAMBDA_MODULE is not set."), event)

    if module == "health":
        from stocvest.api.handlers.health import handler as h

        return apply_cors_to_http_proxy_response(h(event, context), event)

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

        return apply_cors_to_http_proxy_response(
            _dispatch_http_routes(
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
            ),
            event,
        )

    if module == "signals":
        from stocvest.api.handlers.signals import signals_http_dispatch

        return apply_cors_to_http_proxy_response(signals_http_dispatch(event, context), event)

    if module == "brokers":
        route = http_route_descriptor(event)
        if route.startswith(
            (
                "GET /v1/watchlists",
                "POST /v1/watchlists",
                "PATCH /v1/watchlists",
                "DELETE /v1/watchlists",
            )
        ):
            from stocvest.api.handlers.watchlists import watchlists_dispatch_handler

            return apply_cors_to_http_proxy_response(watchlists_dispatch_handler(event, context), event)
        if route.startswith("GET /v1/alerts") or route.startswith("PATCH /v1/alerts"):
            from stocvest.api.handlers.alerts import alerts_dispatch_handler

            return apply_cors_to_http_proxy_response(alerts_dispatch_handler(event, context), event)

        from stocvest.api.handlers.brokers import (
            broker_accounts_handler,
            broker_cancel_order_handler,
            broker_get_order_handler,
            broker_health_handler,
            broker_overview_handler,
            broker_place_order_handler,
            broker_positions_handler,
        )
        from stocvest.api.handlers.etrade_auth import (
            etrade_oauth_callback_handler,
            etrade_oauth_start_handler,
        )
        from stocvest.api.handlers.orders import (
            orders_status_handler,
            orders_submit_handler,
            orders_validate_handler,
            profile_trading_mode_get_handler,
            profile_trading_mode_post_handler,
            users_me_get_handler,
            users_me_patch_handler,
        )

        return apply_cors_to_http_proxy_response(
            _dispatch_http_routes(
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
                    "POST /v1/orders/validate": orders_validate_handler,
                    "POST /v1/orders/submit": orders_submit_handler,
                    "GET /v1/orders/{order_id}/status": orders_status_handler,
                    "GET /v1/profile/trading-mode": profile_trading_mode_get_handler,
                    "POST /v1/profile/trading-mode": profile_trading_mode_post_handler,
                    "GET /v1/users/me": users_me_get_handler,
                    "PATCH /v1/users/me": users_me_patch_handler,
                    "GET /v1/auth/etrade/start": etrade_oauth_start_handler,
                    "POST /v1/auth/etrade/callback": etrade_oauth_callback_handler,
                },
            ),
            event,
        )

    if module == "portfolio":
        from stocvest.api.handlers.portfolio import (
            portfolio_allocation_handler,
            portfolio_holdings_handler,
            portfolio_summary_handler,
        )

        return apply_cors_to_http_proxy_response(
            _dispatch_http_routes(
                event,
                context,
                {
                    "POST /v1/portfolio/holdings": portfolio_holdings_handler,
                    "POST /v1/portfolio/summary": portfolio_summary_handler,
                    "POST /v1/portfolio/allocation": portfolio_allocation_handler,
                },
            ),
            event,
        )

    if module == "journal":
        from stocvest.api.handlers.journal import journal_dispatch_handler

        return apply_cors_to_http_proxy_response(journal_dispatch_handler(event, context), event)

    if module == "pdt":
        from stocvest.api.handlers.pdt import pdt_status_handler

        return apply_cors_to_http_proxy_response(
            _dispatch_http_routes(event, context, {"GET /v1/pdt/status": pdt_status_handler}),
            event,
        )

    if module == "scanner":
        from stocvest.api.handlers.scanner import handler as scanner_handler

        return apply_cors_to_http_proxy_response(scanner_handler(event, context), event)

    if module == "signal_resolution":
        from stocvest.api.handlers.signal_resolution import signal_resolution_scheduled_handler

        return apply_cors_to_http_proxy_response(signal_resolution_scheduled_handler(event, context), event)

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

    return apply_cors_to_http_proxy_response(not_found(f"Unknown STOCVEST_LAMBDA_MODULE: {module}."), event)
