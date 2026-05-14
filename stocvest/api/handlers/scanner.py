"""Phase 4h scanner endpoint handlers."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, internal_error, not_found, ok
from stocvest.api.services.gap_intelligence_news import collect_news_for_gap_intelligence
from stocvest.api.services.scanner_response_cache import build_cache_key, cache_get, cache_set
from stocvest.api.services.scanner_scheduled_pipeline import run_scheduled_scan_sync
from stocvest.api.services.morning_brief_fetch import (
    fetch_morning_brief_context_live,
    morning_brief_context_from_payload_dict,
)
from stocvest.api.services.signal_dto import (
    parse_article,
    parse_bar,
    parse_catalyst,
    parse_pdt_assessment,
    serialize_catalyst,
    serialize_gap_candidate,
    serialize_intraday_setups_with_confluence,
)
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data import PolygonClient, PolygonError
from stocvest.data.models import Bar, Snapshot
from stocvest.signals import (
    IntradaySetupScanner,
    NewsCatalystDetector,
    PremarketGapScanner,
    parse_liquidity_by_symbol_payload,
)
from stocvest.signals.day_trading_scanner import (
    dynamic_gap_candidates_from_snapshots,
    dynamic_gap_candidates_from_snapshots_with_stats,
)
from stocvest.signals.gap_intelligence import build_gap_intelligence_items
from stocvest.signals.morning_brief import build_morning_brief_payload
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_SCHEDULED_SCAN_TYPES = frozenset({"premarket", "intraday", "eod_summary"})

# Gap intelligence: prefer Polygon full-US snapshot, rank top N by |gap| + liquidity gates.
# API Gateway integrates at ~30s — leave headroom for bounded fallback + news + scoring.
_GAP_INTEL_TOP_N = 20
_GAP_INTEL_FULL_SNAPSHOT_TIMEOUT_SEC = 12.0


async def _enrich_gap_company_names(client: PolygonClient, items: list[dict[str, Any]]) -> None:
    """Polygon aggregate snapshots often omit ticker name; fill from v3 reference/tickers."""
    missing = [str(row["symbol"]).strip().upper() for row in items if not str(row.get("company_name") or "").strip()]
    if not missing:
        return

    async def one(sym: str) -> tuple[str, str]:
        try:
            raw = await client.get_ticker_details(sym)
            name = str(raw.get("name") or "").strip()
            return sym, name
        except (PolygonError, Exception) as exc:  # noqa: BLE001 — best-effort enrichment
            _LOG.debug("ticker details for %s: %s", sym, exc)
            return sym, ""

    pairs = await asyncio.gather(*[one(s) for s in missing[:12]])
    by_sym = dict(pairs)
    for row in items:
        sym = str(row["symbol"]).strip().upper()
        if str(row.get("company_name") or "").strip():
            continue
        nm = by_sym.get(sym, "")
        if nm:
            row["company_name"] = nm


async def _load_snapshots_for_dynamic_gaps(user_id: str | None = None, *, bounded: bool = False) -> list[Snapshot]:
    """
    Prefer Polygon's full US equities snapshot (one paginated REST feed).

    If ``bounded`` is True (used by HTTP ``gap-intelligence`` with empty snapshots), skip the
    aggregate US feed and fetch watchlist + system defaults only. That keeps the request under
    API Gateway's ~30s Lambda integration limit; the full US snapshot can exceed it.

    If the API key's tier returns 401/403 on that aggregate route, batch-fetch
    watchlist + system default symbols (see :func:`stocvest.data.scan_symbols.get_scan_symbols`).
    """
    from stocvest.data.scan_symbols import get_scan_symbols
    from stocvest.data.watchlist_store import get_watchlist_store

    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        if bounded:
            try:
                wl_store = get_watchlist_store()
            except Exception as w_exc:  # noqa: BLE001 — never break scanner on Dynamo/boto init
                _LOG.warning("watchlist store unavailable; using system defaults only: %s", w_exc)
                wl_store = None
            merged = get_scan_symbols(user_id, wl_store)
            _LOG.info(
                "bounded scanner snapshots (%s symbols) for gap-intelligence HTTP path",
                len(merged),
            )
            return await client.get_snapshots_many(merged, chunk_size=50)
        try:
            return await client.get_us_stocks_market_snapshots(include_otc=False)
        except PolygonError as exc:
            msg = str(exc)
            if "Polygon 403" in msg or "Polygon 401" in msg:
                try:
                    wl_store = get_watchlist_store()
                except Exception as w_exc:  # noqa: BLE001 — never break scanner on Dynamo/boto init
                    _LOG.warning("watchlist store unavailable; using system defaults only: %s", w_exc)
                    wl_store = None
                merged = get_scan_symbols(user_id, wl_store)
                _LOG.warning(
                    "Polygon aggregate US snapshot unavailable for this tier; "
                    "using watchlist+default merged universe (%s symbols): %s",
                    len(merged),
                    msg[:200],
                )
                return await client.get_snapshots_many(merged, chunk_size=50)
            raise


async def _snapshots_for_gap_intelligence(user_id: str | None) -> list[Snapshot]:
    """Load snapshots across the broadest universe we can afford under API Gateway latency.

    Prefer Polygon's paginated full-US feed (same as ``POST /v1/scanner/gaps`` with empty snapshots).
    On slow responses (common with very large feeds) or unexpected errors, fall back to the bounded
    watchlist + system-default universe so the route still answers within the integration window.
    """
    try:
        return await asyncio.wait_for(
            _load_snapshots_for_dynamic_gaps(user_id, bounded=False),
            timeout=_GAP_INTEL_FULL_SNAPSHOT_TIMEOUT_SEC,
        )
    except TimeoutError:
        _LOG.warning(
            "gap_intelligence full US snapshot exceeded %.0fs; bounded_fallback",
            _GAP_INTEL_FULL_SNAPSHOT_TIMEOUT_SEC,
        )
        return await _load_snapshots_for_dynamic_gaps(user_id, bounded=True)
    except Exception as exc:  # noqa: BLE001 — never 500 gap-intel on snapshot transport quirks
        _LOG.warning("gap_intelligence full_universe_snapshot_failed err=%s; bounded_fallback", str(exc)[:200])
        return await _load_snapshots_for_dynamic_gaps(user_id, bounded=True)


def _is_eventbridge_schedule_event(event: LambdaEvent) -> bool:
    if event.get("source") != "eventbridge":
        return False
    scan_type = event.get("scan_type")
    return isinstance(scan_type, str) and scan_type in _SCHEDULED_SCAN_TYPES


def _handle_eventbridge_schedule(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """EventBridge Scheduler passes the schedule Input JSON as the Lambda event body (top-level dict)."""
    _ = context
    scan_type = str(event.get("scan_type"))
    _LOG.info("scanner schedule invocation scan_type=%s", scan_type)
    try:
        result = run_scheduled_scan_sync(scan_type)
        return ok(result)
    except Exception as exc:
        _LOG.exception("scheduled scanner failed scan_type=%s", scan_type)
        return internal_error(str(exc))


def handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """Scanner Lambda entry: EventBridge Scheduler payloads or API Gateway HTTP routes."""
    if event.get("source") == "eventbridge":
        if not _is_eventbridge_schedule_event(event):
            return bad_request("Scheduled scanner event requires scan_type premarket|intraday|eod_summary.")
        return _handle_eventbridge_schedule(event, context)

    route = http_route_descriptor(event)
    routes: dict[str, Any] = {
        "POST /v1/scanner/gaps": scanner_gaps_handler,
        "POST /v1/scanner/catalysts": scanner_catalysts_handler,
        "POST /v1/scanner/intraday": scanner_intraday_handler,
        "POST /v1/scanner/briefing": scanner_briefing_handler,
        "POST /v1/scanner/gap-intelligence": scanner_gap_intelligence_handler,
    }
    target = routes.get(route)
    if target is None:
        return not_found(f"Unknown scanner route: {route or '(empty)'}.")
    return target(event, context)


def scanner_gaps_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        key = build_cache_key("gaps", payload)
        cached = cache_get(key)
        if cached is not None:
            return cached
        snapshots_raw = payload.get("snapshots")
        if not isinstance(snapshots_raw, list):
            return bad_request("Body field 'snapshots' must be a list.")
        limit = int(payload.get("limit", 8))
        min_abs_gap_percent = float(payload.get("min_abs_gap_percent", 2.0))
        min_day_volume = float(payload.get("min_day_volume", 0.0))

        if len(snapshots_raw) == 0:
            out_limit = max(1, min(limit, 20))
            dyn_min_vol = max(500_000.0, min_day_volume)
            rc = build_request_context(event)
            snapshots = asyncio.run(_load_snapshots_for_dynamic_gaps(rc.user_id))
            candidates = dynamic_gap_candidates_from_snapshots(
                snapshots,
                limit=20,
                min_abs_gap_percent=min_abs_gap_percent,
                min_day_volume=dyn_min_vol,
                min_trade_price=5.0,
            )
            candidates = candidates[:out_limit]
        else:
            snapshots = [Snapshot.model_validate(item) for item in snapshots_raw]
            candidates = PremarketGapScanner(
                min_abs_gap_percent=min_abs_gap_percent,
                min_day_volume=min_day_volume,
            ).scan_snapshots(snapshots, limit=limit)
        return cache_set(key, ok([serialize_gap_candidate(c) for c in candidates]), ttl_seconds=60)
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid gap scanner request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def scanner_catalysts_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        key = build_cache_key("catalysts", payload)
        cached = cache_get(key)
        if cached is not None:
            return cached
        articles_raw = payload.get("articles")
        if not isinstance(articles_raw, list):
            return bad_request("Body field 'articles' must be a list.")
        min_score = float(payload.get("min_score", 0.35))
        limit = int(payload.get("limit", 8))
        articles = [parse_article(item) for item in articles_raw]
        candidates = NewsCatalystDetector(min_score=min_score).detect(articles, limit=limit)
        return cache_set(key, ok([serialize_catalyst(c) for c in candidates]), ttl_seconds=60)
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid catalyst request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def scanner_intraday_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        key = build_cache_key("intraday", payload)
        cached = cache_get(key)
        if cached is not None:
            return cached
        bars_by_symbol_raw = payload.get("bars_by_symbol")
        if not isinstance(bars_by_symbol_raw, dict):
            return bad_request("Body field 'bars_by_symbol' must be an object.")
        limit = int(payload.get("limit", 8))
        min_score = float(payload.get("min_score", 0.55))
        bars_by_symbol: dict[str, list[Bar]] = {}
        for symbol, bars in bars_by_symbol_raw.items():
            if not isinstance(symbol, str) or not isinstance(bars, list):
                return bad_request("bars_by_symbol entries must map symbol strings to bar arrays.")
            bars_by_symbol[symbol.upper()] = [parse_bar(item, symbol.upper()) for item in bars]
        liq = parse_liquidity_by_symbol_payload(payload.get("liquidity_by_symbol"))
        setups = IntradaySetupScanner(min_score=min_score).scan(
            bars_by_symbol, liquidity_by_symbol=liq, limit=limit
        )
        return cache_set(key, ok(serialize_intraday_setups_with_confluence(setups, payload)), ttl_seconds=300)
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid intraday scanner request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def scanner_briefing_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        key = build_cache_key("briefing", payload)
        cached = cache_get(key)
        if cached is not None:
            return cached
        briefing_date = date.fromisoformat(str(payload["briefing_date"]))
        pdt_raw = payload.get("pdt_assessment")
        pdt = parse_pdt_assessment(pdt_raw) if isinstance(pdt_raw, dict) else None
        ctx_raw = payload.get("morning_brief_context")
        if isinstance(ctx_raw, dict):
            merged_ctx = dict(ctx_raw)
            intra = payload.get("intraday_setups")
            if isinstance(intra, list):
                merged_ctx["intraday_setups"] = intra
            ctx = morning_brief_context_from_payload_dict(merged_ctx, briefing_date, pdt)
        else:
            rc = build_request_context(event)
            ctx = asyncio.run(fetch_morning_brief_context_live(briefing_date, pdt, user_id=rc.user_id))
        brief = build_morning_brief_payload(ctx)
        title = f"Morning Brief — {briefing_date.isoformat()}"
        return cache_set(
            key,
            ok(
                {
                    "date_iso": briefing_date.isoformat(),
                    "title": title,
                    **brief,
                    "disclaimer": API_SIGNAL_DISCLAIMER,
                }
            ),
            ttl_seconds=60,
        )
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid scanner briefing request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


async def _gap_intelligence_async(payload: dict[str, Any], user_id: str | None) -> dict[str, Any]:
    snapshots_raw = payload.get("snapshots")
    if not isinstance(snapshots_raw, list):
        raise TypeError("Body field 'snapshots' must be a list.")
    min_abs_gap_percent = float(payload.get("min_abs_gap_percent", 2.0))
    min_day_volume = float(payload.get("min_day_volume", 500_000))
    news_limit = min(1000, max(50, int(payload.get("news_limit", 400))))

    if len(snapshots_raw) == 0:
        snapshots = await _snapshots_for_gap_intelligence(user_id)
    else:
        snapshots = [Snapshot.model_validate(item) for item in snapshots_raw]

    dyn_min_vol = max(500_000.0, min_day_volume)
    gap_scan = dynamic_gap_candidates_from_snapshots_with_stats(
        snapshots,
        limit=_GAP_INTEL_TOP_N,
        min_abs_gap_percent=min_abs_gap_percent,
        min_day_volume=dyn_min_vol,
        min_trade_price=5.0,
    )
    gaps = gap_scan.candidates
    settings = get_settings()
    gap_symbols = [g.symbol for g in gaps]
    sym_need = frozenset(gap_symbols)
    # Default client news_limit is 400; a single huge global news pull can dominate latency.
    global_cap = min(120, max(50, min(news_limit, 500)))
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        news = await collect_news_for_gap_intelligence(
            client,
            gap_symbols,
            global_limit=global_cap,
            per_symbol_limit=5,
            max_symbols=_GAP_INTEL_TOP_N,
        )
        sym_map = {s.symbol: s for s in snapshots if s.symbol in sym_need}
        items = build_gap_intelligence_items(gaps, sym_map, news)
        await _enrich_gap_company_names(client, items)
    return ok(
        {
            "items": items,
            "disclaimer": API_SIGNAL_DISCLAIMER,
            "snapshot_symbol_count": gap_scan.eligible_symbol_count,
        }
    )


def scanner_gap_intelligence_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        key = build_cache_key("gap_intelligence", payload)
        cached = cache_get(key)
        if cached is not None:
            return cached
        rc = build_request_context(event)
        out = asyncio.run(_gap_intelligence_async(payload, rc.user_id))
        return cache_set(key, out, ttl_seconds=60)
    except TypeError as exc:
        return bad_request(str(exc))
    except ValueError as exc:
        return bad_request(f"Invalid gap intelligence request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))
