"""Phase 4d signal endpoint handlers (swing + day-trading)."""

from __future__ import annotations

from datetime import date
from typing import Any

from stocvest.api.response import bad_request, internal_error, ok
from stocvest.api.services.signal_dto import (
    parse_bar,
    parse_catalyst,
    parse_gap_candidate,
    parse_pdt_assessment,
    serialize_intraday_setup,
)
from stocvest.api.shared import parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data.models import Bar
from stocvest.signals import (
    AISynthesis,
    CompositeScoreEngine,
    DailyBriefingGenerator,
    DailyBriefingInput,
    IntradaySetupScanner,
    LayerSignal,
)


def swing_composite_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))

    try:
        signals_raw = payload.get("signals")
        if not isinstance(signals_raw, list):
            return bad_request("Body field 'signals' must be a list.")
        regime = str(payload.get("regime") or "sideways")
        signals = [
            LayerSignal(
                layer=str(item["layer"]),
                score=float(item["score"]),
                confidence=float(item["confidence"]),
            )
            for item in signals_raw
            if isinstance(item, dict)
        ]
        composite = CompositeScoreEngine().compute(signals, regime=regime)
        return ok(
            {
                "score": composite.score,
                "confidence": composite.confidence,
                "verdict": composite.verdict.value,
                "contributions": [
                    {
                        "layer": c.layer,
                        "raw_score": c.raw_score,
                        "confidence": c.confidence,
                        "base_weight": c.base_weight,
                        "regime_multiplier": c.regime_multiplier,
                        "effective_weight": c.effective_weight,
                        "weighted_value": c.weighted_value,
                    }
                    for c in composite.contributions
                ],
            }
        )
    except (KeyError, TypeError, ValueError) as exc:
        return bad_request(f"Invalid composite request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def swing_synthesis_parse_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))

    symbol = str(payload.get("symbol") or "").strip().upper()
    response_text = payload.get("response_text")
    if not symbol:
        return bad_request("Body field 'symbol' is required.")
    if not isinstance(response_text, str) or not response_text.strip():
        return bad_request("Body field 'response_text' is required.")

    try:
        verdict = AISynthesis().parse_response(symbol=symbol, response_text=response_text)
        return ok(
            {
                "symbol": verdict.symbol,
                "action": verdict.action.value,
                "conviction": verdict.conviction,
                "confidence": verdict.confidence,
                "position_size_pct": verdict.position_size_pct,
                "stop_loss_pct": verdict.stop_loss_pct,
                "take_profit_pct": verdict.take_profit_pct,
                "rationale": verdict.rationale,
                "risks": verdict.risks,
                "timeframe": verdict.timeframe,
            }
        )
    except ValueError as exc:
        return bad_request(f"Invalid synthesis response: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def day_setups_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))

    bars_by_symbol_raw = payload.get("bars_by_symbol")
    if not isinstance(bars_by_symbol_raw, dict):
        return bad_request("Body field 'bars_by_symbol' must be an object.")

    try:
        limit = int(payload.get("limit", 8))
        min_score = float(payload.get("min_score", 0.35))
    except ValueError:
        return bad_request("Invalid 'limit' or 'min_score'.")

    try:
        bars_by_symbol: dict[str, list[Bar]] = {}
        for symbol, bars in bars_by_symbol_raw.items():
            if not isinstance(symbol, str) or not isinstance(bars, list):
                return bad_request("bars_by_symbol entries must map symbol strings to bar arrays.")
            bars_by_symbol[symbol.upper()] = [parse_bar(item, symbol.upper()) for item in bars]

        setups = IntradaySetupScanner(min_score=min_score).scan(bars_by_symbol, limit=limit)
        return ok([serialize_intraday_setup(c) for c in setups])
    except (KeyError, TypeError, ValueError) as exc:
        return bad_request(f"Invalid day setup request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def day_briefing_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        payload = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))

    try:
        briefing_date = date.fromisoformat(str(payload["briefing_date"]))
        gaps = tuple(parse_gap_candidate(item) for item in payload.get("gap_candidates", []))
        catalysts = tuple(parse_catalyst(item) for item in payload.get("news_catalysts", []))
        pdt_raw = payload.get("pdt_assessment")
        pdt = parse_pdt_assessment(pdt_raw) if isinstance(pdt_raw, dict) else None
        market_session_summary = payload.get("market_session_summary")

        briefing = DailyBriefingGenerator().generate(
            DailyBriefingInput(
                briefing_date=briefing_date,
                gap_candidates=gaps,
                news_catalysts=catalysts,
                pdt_assessment=pdt,
                market_session_summary=str(market_session_summary) if market_session_summary else None,
            )
        )
        return ok(
            {
                "date_iso": briefing.date_iso,
                "title": briefing.title,
                "markdown": briefing.markdown,
            }
        )
    except (KeyError, TypeError, ValueError) as exc:
        return bad_request(f"Invalid briefing request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))

