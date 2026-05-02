"""Phase 4h scanner endpoint handlers."""

from __future__ import annotations

import asyncio
from datetime import date
from typing import Any

from stocvest.api.http_route import http_route_descriptor
from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, internal_error, not_found, ok
from stocvest.api.services.scanner_response_cache import build_cache_key, cache_get, cache_set
from stocvest.api.services.scanner_scheduled_pipeline import run_scheduled_scan_sync
from stocvest.api.services.signal_dto import (
    parse_article,
    parse_bar,
    parse_catalyst,
    parse_gap_candidate,
    parse_pdt_assessment,
    serialize_catalyst,
    serialize_gap_candidate,
    serialize_intraday_setup,
)
from stocvest.api.shared import parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data import PolygonClient, PolygonError
from stocvest.data.models import Bar, Snapshot
from stocvest.data.scanner_universe import LIQUID_SYMBOLS_FALLBACK
from stocvest.signals import (
    DailyBriefingGenerator,
    DailyBriefingInput,
    IntradaySetupScanner,
    NewsCatalystDetector,
    PremarketGapScanner,
    parse_liquidity_by_symbol_payload,
)
from stocvest.signals.day_trading_scanner import dynamic_gap_candidates_from_snapshots
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_SCHEDULED_SCAN_TYPES = frozenset({"premarket", "intraday", "eod_summary"})


async def _load_snapshots_for_dynamic_gaps() -> list[Snapshot]:
    """
    Prefer Polygon's full US equities snapshot (one paginated REST feed).

    If the API key's tier returns 401/403 on that aggregate route, batch-fetch
    :data:`LIQUID_SYMBOLS_FALLBACK` instead (~50–100 liquid names).
    """
    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        try:
            return await client.get_us_stocks_market_snapshots(include_otc=False)
        except PolygonError as exc:
            msg = str(exc)
            if "Polygon 403" in msg or "Polygon 401" in msg:
                _LOG.warning(
                    "Polygon aggregate US snapshot unavailable for this tier; "
                    "using batched liquid fallback universe: %s",
                    msg[:200],
                )
                return await client.get_snapshots_many(list(LIQUID_SYMBOLS_FALLBACK), chunk_size=50)
            raise


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
            snapshots = asyncio.run(_load_snapshots_for_dynamic_gaps())
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
        min_score = float(payload.get("min_score", 0.5))
        bars_by_symbol: dict[str, list[Bar]] = {}
        for symbol, bars in bars_by_symbol_raw.items():
            if not isinstance(symbol, str) or not isinstance(bars, list):
                return bad_request("bars_by_symbol entries must map symbol strings to bar arrays.")
            bars_by_symbol[symbol.upper()] = [parse_bar(item, symbol.upper()) for item in bars]
        liq = parse_liquidity_by_symbol_payload(payload.get("liquidity_by_symbol"))
        setups = IntradaySetupScanner(min_score=min_score).scan(
            bars_by_symbol, liquidity_by_symbol=liq, limit=limit
        )
        return cache_set(key, ok([serialize_intraday_setup(c) for c in setups]), ttl_seconds=300)
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
        gaps_raw = payload.get("gap_candidates", [])
        catalysts_raw = payload.get("news_catalysts", [])
        if not isinstance(gaps_raw, list) or not isinstance(catalysts_raw, list):
            return bad_request("gap_candidates/news_catalysts must be lists.")
        pdt_raw = payload.get("pdt_assessment")
        pdt = parse_pdt_assessment(pdt_raw) if isinstance(pdt_raw, dict) else None

        briefing = DailyBriefingGenerator().generate(
            DailyBriefingInput(
                briefing_date=briefing_date,
                gap_candidates=tuple(parse_gap_candidate(item) for item in gaps_raw),
                news_catalysts=tuple(parse_catalyst(item) for item in catalysts_raw),
                pdt_assessment=pdt,
                market_session_summary=(
                    str(payload.get("market_session_summary"))
                    if payload.get("market_session_summary") is not None
                    else None
                ),
            )
        )
        return cache_set(
            key,
            ok(
                {
                    "date_iso": briefing.date_iso,
                    "title": briefing.title,
                    "markdown": briefing.markdown,
                    "disclaimer": API_SIGNAL_DISCLAIMER,
                }
            ),
            ttl_seconds=60,
        )
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid scanner briefing request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))
