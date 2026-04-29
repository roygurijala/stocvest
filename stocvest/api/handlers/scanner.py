"""Phase 4h scanner endpoint handlers."""

from __future__ import annotations

from datetime import date
from typing import Any

from stocvest.api.response import bad_request, internal_error, ok
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
from stocvest.data.models import Bar, Snapshot
from stocvest.signals import (
    DailyBriefingGenerator,
    DailyBriefingInput,
    IntradaySetupScanner,
    NewsCatalystDetector,
    PremarketGapScanner,
)


def scanner_gaps_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        snapshots_raw = payload.get("snapshots")
        if not isinstance(snapshots_raw, list):
            return bad_request("Body field 'snapshots' must be a list.")
        limit = int(payload.get("limit", 8))
        min_abs_gap_percent = float(payload.get("min_abs_gap_percent", 2.0))
        min_day_volume = float(payload.get("min_day_volume", 0.0))
        snapshots = [Snapshot.model_validate(item) for item in snapshots_raw]
        candidates = PremarketGapScanner(
            min_abs_gap_percent=min_abs_gap_percent,
            min_day_volume=min_day_volume,
        ).scan_snapshots(snapshots, limit=limit)
        return ok([serialize_gap_candidate(c) for c in candidates])
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid gap scanner request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def scanner_catalysts_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        articles_raw = payload.get("articles")
        if not isinstance(articles_raw, list):
            return bad_request("Body field 'articles' must be a list.")
        min_score = float(payload.get("min_score", 0.35))
        limit = int(payload.get("limit", 8))
        articles = [parse_article(item) for item in articles_raw]
        candidates = NewsCatalystDetector(min_score=min_score).detect(articles, limit=limit)
        return ok([serialize_catalyst(c) for c in candidates])
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid catalyst request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def scanner_intraday_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
        bars_by_symbol_raw = payload.get("bars_by_symbol")
        if not isinstance(bars_by_symbol_raw, dict):
            return bad_request("Body field 'bars_by_symbol' must be an object.")
        limit = int(payload.get("limit", 8))
        min_score = float(payload.get("min_score", 0.35))
        bars_by_symbol: dict[str, list[Bar]] = {}
        for symbol, bars in bars_by_symbol_raw.items():
            if not isinstance(symbol, str) or not isinstance(bars, list):
                return bad_request("bars_by_symbol entries must map symbol strings to bar arrays.")
            bars_by_symbol[symbol.upper()] = [parse_bar(item, symbol.upper()) for item in bars]
        setups = IntradaySetupScanner(min_score=min_score).scan(bars_by_symbol, limit=limit)
        return ok([serialize_intraday_setup(c) for c in setups])
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid intraday scanner request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def scanner_briefing_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
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
        return ok({"date_iso": briefing.date_iso, "title": briefing.title, "markdown": briefing.markdown})
    except (TypeError, ValueError, KeyError) as exc:
        return bad_request(f"Invalid scanner briefing request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))

