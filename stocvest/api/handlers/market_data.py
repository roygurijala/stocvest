"""Phase 4c market-data endpoint handlers."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

from stocvest.api.response import bad_request, internal_error, ok
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data import PolygonClient, PolygonError, Timeframe
from stocvest.utils.config import get_settings


def market_status_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    _ = event
    _ = context

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            status = await client.get_market_status()
        return ok(status.model_dump(mode="json"))

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def snapshot_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    _ = context
    query = _query_params(event)
    symbol = str(query.get("symbol") or "").strip().upper()
    if not symbol:
        return bad_request("Query param 'symbol' is required.")

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            snapshot = await client.get_snapshot(symbol)
        return ok(snapshot.model_dump(mode="json"))

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def bars_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    _ = context
    query = _query_params(event)
    symbol = str(query.get("symbol") or "").strip().upper()
    if not symbol:
        return bad_request("Query param 'symbol' is required.")

    timeframe_raw = str(query.get("timeframe") or Timeframe.DAY_1.value)
    try:
        timeframe = Timeframe(timeframe_raw)
    except ValueError:
        return bad_request("Invalid timeframe.")

    try:
        limit = int(query.get("limit") or 200)
    except ValueError:
        return bad_request("Invalid limit.")
    if limit < 1 or limit > 50000:
        return bad_request("Limit must be between 1 and 50000.")

    from_date = query.get("from")
    to_date = query.get("to")

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            bars = await client.get_bars(
                symbol=symbol,
                timeframe=timeframe,
                from_date=str(from_date) if from_date else None,
                to_date=str(to_date) if to_date else None,
                limit=limit,
            )
        return ok([bar.model_dump(mode="json") for bar in bars])

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def news_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    _ = context
    query = _query_params(event)
    symbol_raw = str(query.get("symbol") or "").strip()
    symbol = symbol_raw.upper() if symbol_raw else None
    try:
        limit = int(query.get("limit") or 20)
    except ValueError:
        return bad_request("Invalid limit.")
    if limit < 1 or limit > 1000:
        return bad_request("Limit must be between 1 and 1000.")

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            news = await client.get_news(symbol=symbol, limit=limit)
        return ok([article.model_dump(mode="json") for article in news])

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def _query_params(event: LambdaEvent) -> dict[str, str]:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        return {}
    return query

