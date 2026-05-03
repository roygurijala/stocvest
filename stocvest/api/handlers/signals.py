"""Phase 4d signal endpoint handlers (swing + day-trading)."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any
from uuid import uuid4

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, internal_error, ok
from stocvest.api.services.composite_market_context import fetch_composite_market_status_payload_sync
from stocvest.api.services.signal_dto import (
    parse_bar,
    parse_pdt_assessment,
    serialize_intraday_setups_with_confluence,
)
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.api.services.morning_brief_fetch import (
    fetch_morning_brief_context_live,
    morning_brief_context_from_payload_dict,
)
from stocvest.api.services.signal_recorder import get_signal_recorder, performance_summary_from_records
from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.data.models import Bar, SignalRecord
from stocvest.signals import (
    AISynthesis,
    CompositeScoreEngine,
    CompositeVerdict,
    IntradaySetupScanner,
    LayerSignal,
    parse_liquidity_by_symbol_payload,
)
from stocvest.signals.confluence import ConfluenceDetector, confluence_result_to_response_fields
from stocvest.signals.morning_brief import build_morning_brief_payload
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

MIN_COMPOSITE_LAYERS_REQUIRED = 3
_COMPOSITE_INSUFFICIENT_MESSAGE = (
    "Insufficient market data to generate a reliable signal. "
    "Real-time data is required for at least 3 of 6 layers."
)


def _parse_composite_signal_item(item: object) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    layer_raw = item.get("layer")
    if not isinstance(layer_raw, str) or not layer_raw.strip():
        return None
    layer = layer_raw.strip().lower()
    status = str(item.get("status") or "").strip().lower()
    score_raw = item.get("score")
    score_f: float | None
    try:
        score_f = float(score_raw) if score_raw is not None else None
    except (TypeError, ValueError):
        score_f = None
    try:
        conf_f = float(item.get("confidence", 0.5))
    except (TypeError, ValueError):
        conf_f = 0.5
    return {"layer": layer, "status": status, "score": score_f, "confidence": conf_f}


def _composite_layer_available(parsed: dict[str, Any]) -> bool:
    if parsed.get("status") == "unavailable":
        return False
    return parsed.get("score") is not None


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
        symbol = str(payload.get("symbol") or "").strip().upper()
        parsed_items = [p for p in (_parse_composite_signal_item(x) for x in signals_raw) if p is not None]
        available_layers = [p for p in parsed_items if _composite_layer_available(p)]
        if len(available_layers) < MIN_COMPOSITE_LAYERS_REQUIRED:
            market_status = fetch_composite_market_status_payload_sync()
            return ok(
                {
                    "symbol": symbol,
                    "status": "insufficient_data",
                    "available_layers": len(available_layers),
                    "required_layers": MIN_COMPOSITE_LAYERS_REQUIRED,
                    "message": _COMPOSITE_INSUFFICIENT_MESSAGE,
                    "market_status": market_status,
                    "disclaimer": API_SIGNAL_DISCLAIMER,
                }
            )
        signals = [
            LayerSignal(
                layer=str(p["layer"]),
                score=float(p["score"]),
                confidence=float(p["confidence"]),
            )
            for p in available_layers
        ]
        composite = CompositeScoreEngine().compute(signals, regime=regime)
        snap_raw = payload.get("symbol_snapshot") or payload.get("snapshot") or {}
        snap = dict(snap_raw) if isinstance(snap_raw, dict) else {}
        request_context = build_request_context(event)
        response_body = {
            "score": composite.score,
            "signal_strength": composite.confidence,
            "signal_summary": composite.verdict.value,
            "contributions": [
                {
                    "layer": c.layer,
                    "raw_score": c.raw_score,
                    "signal_strength": c.confidence,
                    "base_weight": c.base_weight,
                    "regime_multiplier": c.regime_multiplier,
                    "effective_weight": c.effective_weight,
                    "weighted_value": c.weighted_value,
                }
                for c in composite.contributions
            ],
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
        price_raw = payload.get("price_at_signal")
        pattern = str(payload.get("pattern") or "swing_composite")
        direction_out = ""
        if composite.verdict == CompositeVerdict.BULLISH:
            direction_out = "long"
        elif composite.verdict == CompositeVerdict.BEARISH:
            direction_out = "short"
        if direction_out:
            symbol_c = symbol or "PORTFOLIO"
            nc_raw = payload.get("news_catalyst")
            nc = dict(nc_raw) if isinstance(nc_raw, dict) else None
            regime_c = str(regime or "neutral").lower()
            sector_c = str(payload.get("sector_signal") or "neutral").lower()
            price_at_f = None
            try:
                price_at_f = float(price_raw) if price_raw is not None else None
            except (TypeError, ValueError):
                price_at_f = None
            last_px = snap.get("last_trade_price")
            try:
                last_f = float(last_px) if last_px is not None else 0.0
            except (TypeError, ValueError):
                last_f = 0.0
            if not last_f and price_at_f is not None:
                last_f = float(price_at_f)
            sig_data = {
                "pattern": pattern,
                "volume_vs_avg": float(payload.get("volume_vs_avg", 1.0) or 1.0),
                "gap_pct": float(payload.get("gap_pct", 0) or 0),
                "ema9": payload.get("ema9"),
                "last_trade_price": last_f,
            }
            cf = ConfluenceDetector().calculate_confluence(
                symbol=symbol_c,
                direction=direction_out,
                signal_data=sig_data,
                snapshot=snap,
                news_catalyst=nc,
                regime=regime_c,
                sector_signal=sector_c,
            )
            response_body.update(confluence_result_to_response_fields(cf))
        if symbol and price_raw is not None:
            try:
                price_at = float(price_raw)
                layer_scores = {str(s.layer): float(s.score) for s in signals}
                strength = int(round(max(0.0, min(1.0, composite.confidence)) * 100))
                record = SignalRecord(
                    signal_id=str(uuid4()),
                    symbol=symbol,
                    direction=str(composite.verdict.value),
                    signal_strength=strength,
                    pattern=pattern,
                    layer_scores=layer_scores,
                    price_at_signal=price_at,
                    generated_at=datetime.now(timezone.utc),
                    user_id=request_context.user_id,
                )
                get_signal_recorder().record_signal(record)
                if request_context.user_id and request_context.email and direction_out:
                    from stocvest.api.services.alert_tasks import run_alert_background
                    from stocvest.services.alert_trigger import get_alert_trigger

                    def _fire_alert() -> None:
                        get_alert_trigger().trigger_signal_alert(
                            user_id=request_context.user_id or "",
                            user_email=request_context.email or "",
                            symbol=symbol,
                            direction=direction_out,
                            signal_strength=strength,
                            pattern=pattern,
                            is_confluence=bool(response_body.get("is_confluence_alert")),
                            confluence_score=int(response_body.get("confluence_score") or 0),
                        )

                    run_alert_background(_fire_alert)
            except Exception as exc:
                _LOG.warning("record_signal skipped: %s", exc)
        cf_subset: dict[str, Any] | None = None
        if direction_out:
            cf_subset = {
                "confirming_signals": response_body.get("confirming_signals"),
                "conflicting_signals": response_body.get("conflicting_signals"),
                "n_confirming": response_body.get("n_confirming"),
                "n_conflicting": response_body.get("n_conflicting"),
            }
        response_body.update(
            build_swing_composite_evidence_fields(
                composite=composite,
                regime=regime,
                payload=payload,
                confluence=cf_subset,
                snapshot=snap,
            )
        )
        return ok(response_body)
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
                "signal_strength": verdict.confidence,
                "position_size_pct": verdict.position_size_pct,
                "stop_loss_pct": verdict.stop_loss_pct,
                "take_profit_pct": verdict.take_profit_pct,
                "rationale": verdict.rationale,
                "risks": verdict.risks,
                "timeframe": verdict.timeframe,
                "disclaimer": API_SIGNAL_DISCLAIMER,
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
        min_score = float(payload.get("min_score", 0.55))
    except ValueError:
        return bad_request("Invalid 'limit' or 'min_score'.")

    try:
        bars_by_symbol: dict[str, list[Bar]] = {}
        for symbol, bars in bars_by_symbol_raw.items():
            if not isinstance(symbol, str) or not isinstance(bars, list):
                return bad_request("bars_by_symbol entries must map symbol strings to bar arrays.")
            bars_by_symbol[symbol.upper()] = [parse_bar(item, symbol.upper()) for item in bars]

        liq = parse_liquidity_by_symbol_payload(payload.get("liquidity_by_symbol"))
        setups = IntradaySetupScanner(min_score=min_score).scan(
            bars_by_symbol, liquidity_by_symbol=liq, limit=limit
        )
        return ok(serialize_intraday_setups_with_confluence(setups, payload))
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
        return ok(
            {
                "date_iso": briefing_date.isoformat(),
                "title": title,
                **brief,
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )
    except (KeyError, TypeError, ValueError) as exc:
        return bad_request(f"Invalid briefing request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def public_recent_signals_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    try:
        qs = event.get("queryStringParameters") or {}
        landing_raw = qs.get("landing")
        landing = str(landing_raw or "").lower() == "true"
        if landing:
            rows = get_signal_recorder().get_public_landing_items(limit=5)
            return ok({"items": rows})
        rows = get_signal_recorder().get_public_recent(limit=50)
        return ok(rows)
    except Exception as exc:
        return internal_error(str(exc))


def public_performance_summary_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = event
    _ = context
    try:
        records = get_signal_recorder().iter_public_records()
        return ok(performance_summary_from_records(records))
    except Exception as exc:
        return internal_error(str(exc))

