"""Phase 4c market-data endpoint handlers."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from collections import defaultdict, deque
from datetime import date, datetime, timedelta, timezone
from typing import Any

from stocvest.api.response import bad_request, internal_error, ok
from stocvest.api.services.analyst_panel_format import format_analyst_ratings_for_panel
from stocvest.api.services.news_impact_analyzer import analyze_news_impact, generate_impact_summary
from stocvest.api.services.news_panel_format import (
    RECENT_NEWS_HOURS,
    SWING_PANEL_RECENT_NEWS_HOURS,
    catalyst_type_for_article,
    classify_news_source,
    compute_news_age_label,
    parse_published_utc,
    sentiment_score_and_label,
)
from stocvest.api.services.news_quality_filter import get_publisher_tier, passes_market_intelligence_gate
from stocvest.api.services.news_relevance import (
    calculate_article_relevance,
    catalyst_category_for_text,
    categorize_article,
    deduplicate_articles,
    source_credibility_meta,
)
from stocvest.api.services.symbol_news_fetch import (
    article_matches_symbol_panel,
    enrich_article_ticker_metadata,
    fetch_symbol_panel_raw_articles,
)
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data import PolygonClient, PolygonError, Timeframe
from stocvest.data.models import EconomicCalendarEvent
from stocvest.data.polygon_client import LIQUID_NEWS_TICKERS
from stocvest.data.benzinga_client import BenzingaClient
from stocvest.data.watchlist_store import get_watchlist_store
from stocvest.utils.config import get_settings
from stocvest.api.services.dashboard_summary import build_dashboard_summary
from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.signals.macro_context import get_macro_context


def _published_utc_sort_key(article: dict[str, Any]) -> str:
    return str(article.get("published_utc") or "")


def _news_relevance_sort_key(article: dict[str, Any]) -> tuple[int, float]:
    score = int(article.get("_relevance_score") or 0)
    raw = str(article.get("published_utc") or "").replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        ts = dt.timestamp()
    except (TypeError, ValueError, OSError):
        ts = 0.0
    return (-score, -ts)


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


def _publisher_diversity_cap_preserving_order(
    articles: list[dict[str, Any]],
    *,
    max_per_publisher: int = 2,
) -> list[dict[str, Any]]:
    """Keep input order (e.g. relevance-sorted); drop extras beyond ``max_per_publisher`` per source."""
    counts: dict[str, int] = {}
    out: list[dict[str, Any]] = []
    for article in articles:
        publisher = str(((article.get("publisher") or {}).get("name") or "unknown")).strip().lower()
        if counts.get(publisher, 0) >= max_per_publisher:
            continue
        counts[publisher] = counts.get(publisher, 0) + 1
        out.append(article)
    return out


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


def macro_context_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    """Lightweight macro pulse (FRED + optional Polygon economics) for dashboard banner."""
    _ = context

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        econ: list[EconomicCalendarEvent] = []
        try:
            async with client_factory(api_key=settings.polygon_api_key) as client:
                econ = await client.get_polygon_econ_events(date.today(), date.today() + timedelta(days=14))
        except Exception:
            econ = []
        ctx = await get_macro_context(polygon_econ_events=econ)
        return ok(ctx)

    try:
        return asyncio.run(_run())
    except Exception as exc:
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


def tickers_search_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    """GET ``/v1/market/tickers-search?q=`` — Polygon reference ticker search (symbol / company name)."""
    _ = context
    query = _query_params(event)
    raw = str(query.get("q") or query.get("search") or "").strip()
    if len(raw) < 1:
        return bad_request("Query param 'q' is required.")
    if len(raw) > 80:
        return bad_request("Query too long.")

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            rows = await client.search_reference_tickers(raw, limit=25)
        items = [{"symbol": r["ticker"], "name": r.get("name", "")} for r in rows if r.get("ticker")]
        return ok({"items": items})

    try:
        return asyncio.run(_run())
    except PolygonError as exc:
        return internal_error(str(exc))


def vix_snapshot_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    """GET ``/v1/market/vix-snapshot`` — VIX via indices + stocks fallback (Polygon key from Lambda secret)."""
    _ = (event, context)

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            snap = await get_vix_snapshot_with_fallback(client)
        if snap is None:
            return ok({"snapshot": None})
        return ok({"snapshot": snap.model_dump(mode="json")})

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
    symbol_raw = str(query.get("symbol") or "").strip()
    symbol = symbol_raw.upper() if symbol_raw else None
    rc = build_request_context(event)

    watchlist_symbols: list[str] = []
    if rc.user_id:
        default = get_watchlist_store().get_default_watchlist(rc.user_id)
        if default:
            watchlist_symbols = [str(s).strip().upper() for s in default.symbols if str(s).strip()]

    if symbol:
        try:
            days = int(query.get("days") or 20)
        except ValueError:
            return bad_request("Invalid days.")
        if days < 1 or days > 20:
            return bad_request("days must be between 1 and 20.")
        try:
            panel_limit = int(query.get("limit") or 20)
        except ValueError:
            return bad_request("Invalid limit.")
        if panel_limit < 1 or panel_limit > 100:
            return bad_request("Limit must be between 1 and 100.")
        try:
            panel_mode = str(query.get("trading_mode") or query.get("panel_mode") or "").strip().lower()
            default_recent = SWING_PANEL_RECENT_NEWS_HOURS if panel_mode == "swing" else RECENT_NEWS_HOURS
            recent_hours = int(query.get("recent_hours") or default_recent)
        except ValueError:
            return bad_request("Invalid recent_hours.")
        if recent_hours < 1 or recent_hours > 168:
            return bad_request("recent_hours must be between 1 and 168.")

        async def _run_symbol_panel() -> dict[str, Any]:
            now = datetime.now(timezone.utc)
            since = now - timedelta(days=days)
            recent_cutoff = now - timedelta(hours=recent_hours)
            fetch_limit = min(1000, max(80, panel_limit * 5))
            settings = get_settings()
            bz_client = BenzingaClient()
            analyst_configured = bool(settings.benzinga_analyst_key.strip())

            async def _symbol_mark_price() -> float | None:
                try:
                    async with client_factory(api_key=settings.polygon_api_key) as client:
                        snap = await client.get_snapshot(symbol)
                    for field in (snap.last_trade_price, snap.day_close):
                        if isinstance(field, (int, float)) and float(field) > 0:
                            return float(field)
                except Exception:
                    return None
                return None

            raw_articles, ratings_raw, current_price = await asyncio.gather(
                fetch_symbol_panel_raw_articles(
                    symbol=symbol,
                    since=since,
                    fetch_limit=fetch_limit,
                    client_factory=client_factory,
                    polygon_api_key=settings.polygon_api_key,
                ),
                bz_client.get_analyst_ratings(symbol, days=30),
                _symbol_mark_price(),
            )
            ratings = ratings_raw if isinstance(ratings_raw, list) else []
            analyst_panel = format_analyst_ratings_for_panel(
                ratings,
                symbol=symbol,
                analyst_feed_configured=analyst_configured,
                current_price=current_price if isinstance(current_price, (int, float)) else None,
                limit=min(30, panel_limit + 10),
                now=now,
            )

            def collect_panel(min_relevance: int) -> list[dict[str, Any]]:
                rows: list[dict[str, Any]] = []
                for article in raw_articles:
                    article = enrich_article_ticker_metadata(article, symbol)
                    if not article_matches_symbol_panel(article, symbol):
                        continue
                    if not passes_market_intelligence_gate(article):
                        continue
                    pub = parse_published_utc(str(article.get("published_utc") or ""))
                    # Align with NewsAnalyzer: unparseable timestamps still count in composite scoring.
                    if pub is not None and pub < since:
                        continue
                    rel = calculate_article_relevance(article, watchlist_symbols)
                    if rel < min_relevance:
                        continue
                    rows.append({**article, "_relevance_score": rel})
                return rows

            scored = collect_panel(10)
            if not scored:
                scored = collect_panel(0)
            scored.sort(key=_news_relevance_sort_key)
            deduped = deduplicate_articles(scored, score_key="_relevance_score")
            for row in deduped:
                row.pop("_relevance_score", None)
            deduped.sort(key=_published_utc_sort_key, reverse=True)

            total_found = len(deduped)
            has_recent_news = False
            for article in deduped:
                pub = parse_published_utc(str(article.get("published_utc") or ""))
                if pub and pub > recent_cutoff:
                    has_recent_news = True
                    break

            slice_rows = deduped[:panel_limit]
            articles_out: list[dict[str, Any]] = []
            oldest_dt: datetime | None = None
            for article in slice_rows:
                pub = parse_published_utc(str(article.get("published_utc") or ""))
                if pub and (oldest_dt is None or pub < oldest_dt):
                    oldest_dt = pub
                src, src_label = classify_news_source(article)
                score, sent_label = sentiment_score_and_label(article)
                cat = catalyst_type_for_article(article)
                pub_iso = str(article.get("published_utc") or "")
                is_recent = bool(pub and pub > recent_cutoff)
                age_label = compute_news_age_label(now, pub) if pub else ""
                url_val = str(article.get("article_url") or "").strip()
                articles_out.append(
                    {
                        "id": str(article.get("id") or ""),
                        "title": str(article.get("title") or ""),
                        "source": src,
                        "source_label": src_label,
                        "published_at": pub_iso,
                        "sentiment_score": round(score, 4),
                        "sentiment_label": sent_label,
                        "catalyst_type": cat,
                        "url": url_val if url_val else None,
                        "is_recent": is_recent,
                        "age_label": age_label,
                    }
                )

            oldest_included: str | None = None
            if oldest_dt is not None:
                oldest_included = oldest_dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

            return ok(
                {
                    "symbol": symbol,
                    "has_recent_news": has_recent_news,
                    "recent_cutoff_hours": recent_hours,
                    "articles": articles_out,
                    "total_found": total_found,
                    "oldest_included": oldest_included,
                    "analyst": analyst_panel,
                }
            )

        try:
            return asyncio.run(_run_symbol_panel())
        except PolygonError as exc:
            return internal_error(str(exc))

    try:
        limit = int(query.get("limit") or 20)
    except ValueError:
        return bad_request("Invalid limit.")
    if limit < 1 or limit > 1000:
        return bad_request("Limit must be between 1 and 1000.")

    merged_tickers: list[str] = []
    seen: set[str] = set()
    for sym in LIQUID_NEWS_TICKERS:
        if sym not in seen:
            seen.add(sym)
            merged_tickers.append(sym)
    for sym in watchlist_symbols:
        if sym not in seen and len(merged_tickers) < 30:
            seen.add(sym)
            merged_tickers.append(sym)
    merged_tickers = merged_tickers[:30]
    news_query_tickers = merged_tickers

    async def _run() -> dict[str, Any]:
        settings = get_settings()
        since_4h = datetime.now(timezone.utc) - timedelta(hours=4)
        since_24h = datetime.now(timezone.utc) - timedelta(hours=24)
        async with client_factory(api_key=settings.polygon_api_key) as client:
            raw_articles = await client.get_market_news(
                tickers=news_query_tickers,
                limit=50,
                order="desc",
                published_utc_gte=since_4h,
            )
            # Quiet sessions often have zero Polygon rows in a 4h window; widen once so MI is not blank.
            if not raw_articles and not symbol:
                raw_articles = await client.get_market_news(
                    tickers=news_query_tickers,
                    limit=50,
                    order="desc",
                    published_utc_gte=since_24h,
                )

        def collect_scored(min_relevance: int) -> list[dict[str, Any]]:
            rows: list[dict[str, Any]] = []
            for article in raw_articles:
                if not passes_market_intelligence_gate(article):
                    continue
                if symbol and symbol not in _article_tickers_upper(article):
                    continue
                rel = calculate_article_relevance(article, watchlist_symbols)
                if rel < min_relevance:
                    continue
                rows.append({**article, "_relevance_score": rel})
            return rows

        scored_polygon = collect_scored(10)
        if not scored_polygon:
            scored_polygon = collect_scored(0)

        scored_polygon.sort(key=_news_relevance_sort_key)
        deduped_polygon = deduplicate_articles(scored_polygon, score_key="_relevance_score")
        diversity_polygon = _publisher_diversity_cap_preserving_order(deduped_polygon, max_per_publisher=2)

        out_cap = min(limit, 20)
        candidates: list[dict[str, Any]] = []
        for article in diversity_polygon[:out_cap]:
            relevance_score = int(article.pop("_relevance_score", 0))
            tickers = [str(t).strip().upper() for t in article.get("tickers", []) if str(t).strip()]
            publisher_name = str((article.get("publisher") or {}).get("name") or "").strip()
            title_lower = str(article.get("title") or "").lower()
            desc_lower = str(article.get("description") or "").lower()
            category = categorize_article(article)
            catalyst_category = catalyst_category_for_text(title_lower, desc_lower)
            credibility = source_credibility_meta(publisher_name)
            watchlist_upper = {s.strip().upper() for s in watchlist_symbols if s.strip()}
            matches_watchlist = bool(watchlist_upper and any(t in watchlist_upper for t in tickers))
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
                    "relevance_score": relevance_score,
                    "category": category,
                    "catalyst_category": catalyst_category,
                    "credibility": credibility,
                    "matches_watchlist": matches_watchlist,
                    # Back-compat for existing frontend fields.
                    "article_id": str(article.get("id") or ""),
                    "published_at": str(article.get("published_utc") or ""),
                    "url": str(article.get("article_url") or ""),
                    "source": publisher_name or "Unknown source",
                    "description": article.get("description"),
                    "image_url": article.get("image_url"),
                }
            )
        return ok({"headlines": candidates})

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


def dashboard_summary_handler(
    event: LambdaEvent,
    context: LambdaContext,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    """
    GET ``/v1/dashboard/summary`` — market tape + index/sector daily closes + earnings
    in one Lambda invocation (Tier 1.C Phase 2).
    """
    _ = context
    query = _query_params(event)

    symbols_raw = str(query.get("earnings_symbols") or "").strip()
    earnings_symbols = [s.strip().upper() for s in symbols_raw.split(",") if s.strip()]

    try:
        earnings_days = int(query.get("earnings_days") or query.get("days") or 7)
    except ValueError:
        return bad_request("Invalid earnings_days.")
    if earnings_days < 1 or earnings_days > 30:
        return bad_request("earnings_days must be between 1 and 30.")

    try:
        sparkline_limit = int(query.get("sparkline_limit") or 12)
    except ValueError:
        return bad_request("Invalid sparkline_limit.")
    if sparkline_limit < 1 or sparkline_limit > 50:
        return bad_request("sparkline_limit must be between 1 and 50.")

    try:
        daily_limit = int(query.get("daily_limit") or 8)
    except ValueError:
        return bad_request("Invalid daily_limit.")
    if daily_limit < 1 or daily_limit > 30:
        return bad_request("daily_limit must be between 1 and 30.")

    async def _run() -> dict[str, Any]:
        payload = await build_dashboard_summary(
            earnings_symbols=earnings_symbols,
            earnings_days=earnings_days,
            sparkline_limit=sparkline_limit,
            daily_limit=daily_limit,
            client_factory=client_factory,
        )
        return ok(payload)

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

