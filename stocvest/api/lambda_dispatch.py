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


def _with_cors_and_audit(*, event: LambdaEvent, response: dict[str, Any], module: str) -> dict[str, Any]:
    from stocvest.api.services.audit_capture import capture_http_audit_event

    try:
        capture_http_audit_event(event=event, response=response, module=module)
    except Exception:
        pass
    return apply_cors_to_http_proxy_response(response, event)


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

    records = event.get("Records") if isinstance(event, dict) else None
    if (
        module == "news_consumer"
        and isinstance(records, list)
        and records
        and isinstance(records[0], dict)
        and str(records[0].get("eventSource") or "").startswith("aws:sqs")
    ):
        from stocvest.workers.news_consumer_lambda import sqs_lambda_handler

        return sqs_lambda_handler(event, context)

    if module == "health":
        from stocvest.api.handlers.health import handler as h

        return _with_cors_and_audit(event=event, response=h(event, context), module=module)

    if module == "authorizer":
        from stocvest.api.handlers.authorizer import handler as h

        return h(event, context)

    if module == "market_data":
        from stocvest.api.handlers.market_data import (
            bars_batch_handler,
            bars_handler,
            earnings_calendar_handler,
            macro_context_handler,
            market_status_handler,
            news_handler,
            options_chain_handler,
            snapshot_handler,
            snapshots_batch_handler,
            tickers_search_handler,
        )

        return _with_cors_and_audit(
            event=event,
            module=module,
            response=_dispatch_http_routes(
                event,
                context,
                {
                    "GET /v1/market/status": market_status_handler,
                    "GET /v1/market/macro-context": macro_context_handler,
                    "GET /v1/market/snapshot": snapshot_handler,
                    "GET /v1/market/snapshots": snapshots_batch_handler,
                    "GET /v1/market/tickers-search": tickers_search_handler,
                    "GET /v1/market/bars": bars_handler,
                    "POST /v1/market/bars-batch": bars_batch_handler,
                    "GET /v1/market/news": news_handler,
                    "GET /v1/market/options": options_chain_handler,
                    "GET /v1/market/earnings": earnings_calendar_handler,
                },
            ),
        )

    if module == "signals":
        from stocvest.api.handlers.signals import signals_http_dispatch

        return _with_cors_and_audit(event=event, response=signals_http_dispatch(event, context), module=module)

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

            return _with_cors_and_audit(event=event, response=watchlists_dispatch_handler(event, context), module=module)
        if route.startswith("GET /v1/alerts") or route.startswith("PATCH /v1/alerts"):
            from stocvest.api.handlers.alerts import alerts_dispatch_handler

            return _with_cors_and_audit(event=event, response=alerts_dispatch_handler(event, context), module=module)

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
            admin_beta_access_patch_handler,
            admin_audit_session_events_handler,
            admin_audit_user_events_handler,
            orders_status_handler,
            orders_submit_handler,
            orders_validate_handler,
            profile_trading_mode_get_handler,
            profile_trading_mode_post_handler,
            users_me_get_handler,
            users_me_patch_handler,
        )

        return _with_cors_and_audit(
            event=event,
            module=module,
            response=_dispatch_http_routes(
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
                    "PATCH /v1/admin/users/{user_id}/beta-access": admin_beta_access_patch_handler,
                    "GET /v1/admin/audit/users/{user_id}": admin_audit_user_events_handler,
                    "GET /v1/admin/audit/sessions/{session_id}": admin_audit_session_events_handler,
                    "GET /v1/auth/etrade/start": etrade_oauth_start_handler,
                    "POST /v1/auth/etrade/callback": etrade_oauth_callback_handler,
                },
            ),
        )

    if module == "portfolio":
        from stocvest.api.handlers.portfolio import (
            portfolio_allocation_handler,
            portfolio_holdings_handler,
            portfolio_summary_handler,
        )

        return _with_cors_and_audit(
            event=event,
            module=module,
            response=_dispatch_http_routes(
                event,
                context,
                {
                    "POST /v1/portfolio/holdings": portfolio_holdings_handler,
                    "POST /v1/portfolio/summary": portfolio_summary_handler,
                    "POST /v1/portfolio/allocation": portfolio_allocation_handler,
                },
            ),
        )

    if module == "journal":
        from stocvest.api.handlers.journal import journal_dispatch_handler

        return _with_cors_and_audit(event=event, response=journal_dispatch_handler(event, context), module=module)

    if module == "pdt":
        from stocvest.api.handlers.pdt import pdt_status_handler

        return _with_cors_and_audit(
            event=event,
            module=module,
            response=_dispatch_http_routes(event, context, {"GET /v1/pdt/status": pdt_status_handler}),
        )

    if module == "scanner":
        from stocvest.api.handlers.scanner import handler as scanner_handler

        return _with_cors_and_audit(event=event, response=scanner_handler(event, context), module=module)

    if module == "signal_resolution":
        from stocvest.api.handlers.signal_resolution import signal_resolution_scheduled_handler

        return _with_cors_and_audit(event=event, response=signal_resolution_scheduled_handler(event, context), module=module)

    if module == "geo_themes":
        from stocvest.workers.geo_themes_updater import handler as geo_themes_job_handler

        return geo_themes_job_handler(event, context)

    if module == "orb_compute":
        from stocvest.workers.orb_compute_worker import handler as orb_compute_handler

        return orb_compute_handler(event, context)

    if module == "macro_warmer":
        from stocvest.workers.macro_cache_warmer import handler as macro_warmer_handler

        return macro_warmer_handler(event, context)

    if module == "sector_daily_cache":
        from stocvest.workers.sector_daily_cache import handler as sector_daily_job_handler

        return sector_daily_job_handler(event, context)

    if module == "market_pulse_refresher":
        from stocvest.workers.market_pulse_refresher import handler as market_pulse_refresher_handler

        return market_pulse_refresher_handler(event, context)

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
