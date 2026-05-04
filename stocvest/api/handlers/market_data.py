"""Phase 4c market-data endpoint handlers."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from typing import Any

from stocvest.api.response import bad_request, internal_error, ok
from stocvest.api.services.news_impact_analyzer import analyze_news_impact, generate_impact_summary
from stocvest.api.services.news_quality_filter import get_publisher_tier, is_quality_article
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data import PolygonClient, PolygonError, Timeframe
from stocvest.data.polygon_client import LIQUID_NEWS_TICKERS
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.utils.config import get_settings


def _published_utc_sort_key(article: dict[str, Any]) -> str:
    return str(article.get("published_utc") or "")


def _publisher_diversity_ranked(articles: list[dict[str, Any]], *, max_per_publisher: int = 2) -> list[dict[str, Any]]:
    """
    Rank by publisher diversity first, then recency:
    - cap each publisher to ``max_per_publisher``
    - round-robin newest-per-publisher so no single source dominates top slots
    """
    by_pub: dict[str, deque[dict[str, Any]]] = defaultdict(deque)
    for article in sorted(articles, key=_published_utc_sort_key, reverse=True):
        publisher = str(((article.get("publisher") or {}).get("name") or "unknown")).strip().lower()
        bucket = by_pub[publisher]
        if len(bucket) < max_per_publisher:
            bucket.append(article)
    ordered: list[dict[str, Any]] = []
    pubs = sorted(
        by_pub.keys(),
        key=lambda p: _published_utc_sort_key(by_pub[p][0]) if by_pub[p] else "",
        reverse=True,
    )
    while pubs:
        next_round: list[str] = []
        for pub in pubs:
            bucket = by_pub[pub]
            if bucket:
                ordered.append(bucket.popleft())
            if bucket:
                next_round.append(pub)
        pubs = next_round
    return ordered


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


def snapshots_batch_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    """GET ``symbols=A,B,C`` — one Polygon session; caps at 40 tickers (dashboard / scanner batching)."""
    _ = context
    query = _query_params(event)
    raw = str(query.get("symbols") or "").strip()
    if not raw:
        return bad_request("Query param 'symbols' is required (comma-separated).")
    symbols = []
    seen: set[str] = set()
    for part in raw.split(","):
        s = str(part).strip().upper()
        if s and s not in seen and len(s) <= 10:
            seen.add(s)
            symbols.append(s)
    if not symbols:
        return bad_request("No valid symbols in 'symbols'.")
    if len(symbols) > 40:
        symbols = symbols[:40]

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            snaps = await client.get_snapshots_many(symbols, chunk_size=50)
        return ok({"snapshots": [snap.model_dump(mode="json") for snap in snaps]})

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def bars_batch_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    """POST JSON ``{ "requests": [ {"symbol","timeframe","limit"}, ... ] }`` — max 24 rows, one Polygon session."""
    _ = context
    body = parse_json_body(event)
    if not isinstance(body, dict):
        return bad_request("JSON body object required.")
    raw_reqs = body.get("requests")
    if not isinstance(raw_reqs, list) or not raw_reqs:
        return bad_request("Field 'requests' must be a non-empty array.")

    parsed: list[tuple[str, Timeframe, int]] = []
    for i, row in enumerate(raw_reqs[:24]):
        if not isinstance(row, dict):
            return bad_request(f"requests[{i}] must be an object.")
        sym = str(row.get("symbol") or "").strip().upper()
        if not sym:
            return bad_request(f"requests[{i}].symbol is required.")
        tf_raw = str(row.get("timeframe") or Timeframe.DAY_1.value)
        try:
            tf = Timeframe(tf_raw)
        except ValueError:
            return bad_request(f"requests[{i}].invalid timeframe.")
        try:
            lim = int(row.get("limit") or 200)
        except (TypeError, ValueError):
            return bad_request(f"requests[{i}].invalid limit.")
        if lim < 1 or lim > 50000:
            return bad_request(f"requests[{i}].limit out of range.")
        parsed.append((sym, tf, lim))

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        out: dict[str, list[dict[str, Any]]] = {}

        async with client_factory(api_key=settings.polygon_api_key) as client:

            async def inner(sym: str, tf: Timeframe, lim: int) -> tuple[str, list[dict[str, Any]]]:
                bars = await client.get_bars(
                    symbol=sym,
                    timeframe=tf,
                    from_date=None,
                    to_date=None,
                    limit=lim,
                )
                return sym, [b.model_dump(mode="json") for b in bars]

            pairs = await asyncio.gather(*[inner(s, tf, lim) for s, tf, lim in parsed])
        for sym, rows in pairs:
            out[sym] = rows
        return ok({"bars_by_symbol": out})

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
    try:
        limit = int(query.get("limit") or 20)
    except ValueError:
        return bad_request("Invalid limit.")
    if limit < 1 or limit > 1000:
        return bad_request("Limit must be between 1 and 1000.")
    symbol_raw = str(query.get("symbol") or "").strip()
    symbol = symbol_raw.upper() if symbol_raw else None
    rc = build_request_context(event)

    merged_tickers: list[str] = []
    seen: set[str] = set()
    for sym in LIQUID_NEWS_TICKERS:
        if sym not in seen:
            seen.add(sym)
            merged_tickers.append(sym)
    if symbol and symbol not in seen:
        seen.add(symbol)
        merged_tickers.append(symbol)
    watchlist_symbols: list[str] = []
    if rc.user_id:
        default = get_watchlist_store().get_default_watchlist(rc.user_id)
        if default:
            watchlist_symbols = [str(s).strip().upper() for s in default.symbols if str(s).strip()]
            for sym in watchlist_symbols:
                if sym not in seen and len(merged_tickers) < 30:
                    seen.add(sym)
                    merged_tickers.append(sym)
    merged_tickers = merged_tickers[:30]

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        since = datetime.now(timezone.utc) - timedelta(hours=4)
        async with client_factory(api_key=settings.polygon_api_key) as client:
            raw_articles = await client.get_market_news(
                tickers=merged_tickers,
                limit=50,
                order="desc",
                published_utc_gte=since,
            )

        candidates: list[dict[str, Any]] = []
        for article in raw_articles:
            if not is_quality_article(article):
                continue
            tickers = [str(t).strip().upper() for t in article.get("tickers", []) if str(t).strip()]
            publisher_name = str((article.get("publisher") or {}).get("name") or "").strip()
            affected = analyze_news_impact(article, watchlist_symbols=watchlist_symbols)
            sentiment = "neutral"
            insights = article.get("insights")
            if isinstance(insights, list) and insights:
                first = insights[0]
                if isinstance(first, dict):
                    raw_sent = str(first.get("sentiment") or "").strip().lower()
                    if raw_sent in {"positive", "negative", "neutral"}:
                        sentiment = raw_sent
            raw_sent2 = str(article.get("sentiment") or "").strip().lower()
            if raw_sent2 in {"positive", "negative", "neutral"}:
                sentiment = raw_sent2
            candidates.append(
                {
                "id": str(article.get("id") or ""),
                "title": str(article.get("title") or ""),
                "published_utc": str(article.get("published_utc") or ""),
                "publisher": {
                    "name": publisher_name or "Unknown source",
                    "tier": get_publisher_tier(publisher_name),
                },
                "tickers": tickers,
                "article_url": str(article.get("article_url") or ""),
                "sentiment": sentiment,
                "affected_stocks": affected,
                "impact_summary": generate_impact_summary(article, affected),
                # Back-compat for existing frontend fields.
                "article_id": str(article.get("id") or ""),
                "published_at": str(article.get("published_utc") or ""),
                "url": str(article.get("article_url") or ""),
                "source": publisher_name or "Unknown source",
                "description": article.get("description"),
                "image_url": article.get("image_url"),
                }
            )
        ranked = _publisher_diversity_ranked(candidates, max_per_publisher=2)
        headlines = ranked[: min(limit, 8)]
        return ok({"headlines": headlines})

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def options_chain_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    _ = context
    query = _query_params(event)
    symbol = str(query.get("symbol") or "").strip().upper()
    if not symbol:
        return bad_request("Query param 'symbol' is required.")

    expiration = str(query.get("expiration") or "").strip() or None
    option_type = str(query.get("option_type") or "").strip().lower() or None
    strike_gte_raw = query.get("strike_gte")
    strike_lte_raw = query.get("strike_lte")
    try:
        limit = int(query.get("limit") or 100)
    except ValueError:
        return bad_request("Invalid limit.")
    if limit < 1 or limit > 250:
        return bad_request("Limit must be between 1 and 250.")
    try:
        strike_gte = float(strike_gte_raw) if strike_gte_raw is not None else None
        strike_lte = float(strike_lte_raw) if strike_lte_raw is not None else None
    except ValueError:
        return bad_request("Invalid strike_gte/strike_lte.")
    if option_type and option_type not in {"call", "put"}:
        return bad_request("option_type must be 'call' or 'put'.")

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            contracts = await client.get_options_chain(
                underlying=symbol,
                expiration_date=expiration,
                strike_price_gte=strike_gte,
                strike_price_lte=strike_lte,
                option_type=option_type,
                limit=limit,
            )
        return ok([contract.model_dump(mode="json") for contract in contracts])

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def earnings_calendar_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    _ = context
    query = _query_params(event)
    symbols_raw = str(query.get("symbols") or "").strip()
    if not symbols_raw:
        return bad_request("Query param 'symbols' is required.")

    try:
        days = int(query.get("days") or 7)
    except ValueError:
        return bad_request("Invalid days.")
    if days < 1 or days > 30:
        return bad_request("days must be between 1 and 30.")

    symbols = [s.strip().upper() for s in symbols_raw.split(",") if s.strip()]
    if not symbols:
        return bad_request("Query param 'symbols' is required.")

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        today = date.today()
        to_date = today + timedelta(days=days)
        recent_from = today - timedelta(days=3)
        async with client_factory(api_key=settings.polygon_api_key) as client:
            rows = await client.get_earnings_calendar(symbols=symbols, from_date=recent_from, to_date=to_date)
        upcoming = [r for r in rows if r.report_date >= today]
        recent = [r for r in rows if r.report_date < today]
        return ok(
            {
                "symbols": symbols,
                "days": days,
                "upcoming": [x.model_dump(mode="json") for x in upcoming],
                "recent": [x.model_dump(mode="json") for x in recent],
            }
        )

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        msg_l = str(exc).lower()
        if (
            "403" in str(exc)
            or "401" in str(exc)
            or "forbidden" in msg_l
            or "not entitled" in msg_l
            or "subscription" in msg_l
        ):
            return ok(
                {
                    "symbols": symbols,
                    "days": days,
                    "upcoming": [],
                    "recent": [],
                    "notice": (
                        "Earnings data requires a Polygon Stocks Developer plan or Benzinga earnings add-on. "
                        "Upgrade at polygon.io to enable this feature."
                    ),
                }
            )
        return internal_error(str(exc))


def _query_params(event: LambdaEvent) -> dict[str, str]:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        return {}
    return query

