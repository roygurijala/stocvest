"""Phase 4d signal endpoint handlers (swing + day-trading)."""

from __future__ import annotations

import asyncio
import math
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any, Callable, Literal
from uuid import uuid4

from stocvest.api.legal_copy import (
    API_SIGNAL_DISCLAIMER,
    HISTORICAL_VALIDATION_DISCLAIMER,
    SCANNER_EVALUATION_TRACE_DISCLAIMER,
)
from stocvest.api.http_route import http_route_descriptor
from stocvest.api.response import bad_request, internal_error, json_response, not_found, ok, unauthorized
from stocvest.api.services.historical_validation_service import HistoricalValidationService
from stocvest.api.services.signal_analysis import analysis_authorized, build_signal_analysis_payload
from stocvest.api.services.real_composite_engine import real_composite_body_sync
from stocvest.api.services.swing_composite_engine import swing_composite_body_sync
from stocvest.api.services.signal_snapshot_builders import build_swing_composite_snapshot_payload
from stocvest.config.parameter_store import ParameterStore
from stocvest.api.services.composite_market_context import fetch_composite_market_status_payload_sync
from stocvest.api.services.day_setups_geo_preview import attach_geo_preview_to_intraday_rows
from stocvest.api.services.scanner_setups_bundle import (
    bundle_setups_response,
    ensure_setups_v2_bundle,
    excluded_symbols_from_bundle,
)
from stocvest.api.services.scanner_trace_persist import persist_evaluation_trace_rows
from stocvest.data.scanner_evaluation_trace_store import (
    get_scanner_evaluation_traces_merged,
    session_date_et,
)
from stocvest.signals.scanner_evaluation_trace import (
    build_intraday_evaluation_traces,
    build_swing_evaluation_traces,
)
from stocvest.api.services.signal_dto import (
    parse_bar,
    parse_pdt_assessment,
    serialize_daily_bar_setups_with_confluence,
    serialize_intraday_setups_with_confluence,
)
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.api.services.morning_brief_fetch import (
    fetch_morning_brief_context_live,
    morning_brief_context_from_payload_dict,
)
from stocvest.api.services.signal_recorder import (
    get_signal_recorder,
    performance_summary_from_records,
    public_signal_detail_dict,
)
from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.api.services.signal_validation_eligibility import (
    entry_rationale_from_gates,
    evaluate_swing_ledger_entry,
    gate_blob_json,
)
from stocvest.api.services.validation_timing import build_regime_window_key, is_swing_ledger_entry_window_et
from stocvest.api.services.user_profile_store import get_founding_member_count, get_user_profile_store
from stocvest.data.dashboard_cache import (
    evidence_cache_key,
    evidence_rate_limit_exceeded,
    read_dashboard_cache,
    write_dashboard_cache,
)
from stocvest.data import PolygonClient, PolygonError, Timeframe
from stocvest.data.models import Bar, MarketStatus, SignalRecord, Snapshot
from stocvest.signals.ai_explanations import AIExplanationService, news_articles_from_payload
from stocvest.signals.assistant_chat import AssistantChatService
from stocvest.signals.historical_validation import (
    BucketStats,
    HistoricalValidationSummary,
    Horizon,
)
from stocvest.signals import (
    AISynthesis,
    CompositeScoreEngine,
    CompositeVerdict,
    IntradaySetupScanner,
    LayerSignal,
    build_composite_score_engine_from_params,
    parse_liquidity_by_symbol_payload,
)
from stocvest.signals.daily_bar_scanner import DailyBarScanner
from stocvest.signals.confluence import ConfluenceDetector, confluence_result_to_response_fields
from stocvest.signals.morning_brief import build_morning_brief_payload
from stocvest.api.services.gap_intel_compute import compute_gap_intel_body
from stocvest.data.gap_intel_cache_store import gap_intel_cache_key, get_gap_intel_cache_row, put_gap_intel_cache_row
from stocvest.signals.gap_intel_alerts import next_last_disable_metric_timestamp
from stocvest.utils.circuit_breaker import CircuitOpenError, polygon_circuit
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

MIN_COMPOSITE_LAYERS_REQUIRED = 3
_COMPOSITE_INSUFFICIENT_MESSAGE = (
    "Insufficient market data to generate a reliable signal. "
    "Real-time data is required for at least 3 of 6 layers."
)

_COMPOSITE_TIMEOUT_SEC = 14.0
_GAP_INTEL_TIMEOUT_SEC = 12.0


def _compute_with_thread_timeout(
    fn: Callable[[], dict[str, Any]],
    *,
    timeout_sec: float,
) -> dict[str, Any] | None:
    with ThreadPoolExecutor(max_workers=1) as pool:
        fut = pool.submit(fn)
        try:
            return fut.result(timeout=timeout_sec)
        except FuturesTimeoutError:
            return None


def composite_response_with_evidence_cache(
    *,
    symbol: str,
    user_id: str | None,
    user_email: str | None,
    mode: str,
    sync_compute: Callable[[], dict[str, Any]],
) -> dict[str, Any]:
    """Bounded + cached composite for View Evidence (Upstash); rate limit + circuit breaker."""
    if evidence_rate_limit_exceeded(user_id):
        return {
            "error": "rate_limited",
            "retry_after": 60,
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }

    cache_key = evidence_cache_key(symbol, mode)
    envelope = read_dashboard_cache(cache_key)
    if envelope and isinstance(envelope.get("data"), dict):
        data = dict(envelope["data"])
        data["source"] = "cache"
        data["cache_state_version"] = envelope.get("state_version")
        return data

    try:
        body = polygon_circuit.call(
            lambda: _compute_with_thread_timeout(sync_compute, timeout_sec=_COMPOSITE_TIMEOUT_SEC)
        )
    except CircuitOpenError:
        stale = read_dashboard_cache(cache_key)
        if stale and isinstance(stale.get("data"), dict):
            data = dict(stale["data"])
            data["source"] = "cache_stale"
            data["cache_state_version"] = stale.get("state_version")
            return data
        return {
            "error": "upstream_unavailable",
            "message": "Market data is briefly unavailable. Try again in a moment.",
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }

    if body is None:
        stale = read_dashboard_cache(cache_key)
        if stale and isinstance(stale.get("data"), dict):
            data = dict(stale["data"])
            data["source"] = "cache_stale"
            data["cache_state_version"] = stale.get("state_version")
            return data
        return {
            "error": "timeout",
            "message": "Signal analysis timed out. Try again in a moment.",
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }

    if str(body.get("status") or "") == "insufficient_data" or body.get("error"):
        return dict(body)

    write_dashboard_cache(
        cache_key,
        dict(body),
        "evidence",
        "day" if mode == "day" else "swing",
    )
    out = dict(body)
    out["source"] = "computed"
    if user_id:
        try:
            from stocvest.api.services.watchlist_maturation_sync import (
                sync_watchlist_maturation_from_composite,
            )

            # Request path: persist maturation only — no SES on the hot path (avoids 503s).
            sync_watchlist_maturation_from_composite(
                user_id=user_id,
                symbol=symbol,
                mode="day" if mode == "day" else "swing",
                composite_body=out,
                email_on_state_change=False,
            )
        except Exception as exc:  # noqa: BLE001 — maturation must not break composite
            _LOG.warning("watchlist maturation sync skipped: %s", exc)
    return out


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


def _layer_verdict(raw_score: float) -> str:
    if raw_score >= 0.2:
        return "bullish"
    if raw_score <= -0.2:
        return "bearish"
    return "neutral"


def _generate_layer_reasoning(
    *,
    layer: str,
    raw_score: float,
    verdict: str,
    payload: dict[str, Any],
    snapshot: dict[str, Any],
) -> str:
    layer_l = layer.strip().lower()
    if layer_l == "technical":
        vwap = snapshot.get("day_vwap")
        last = snapshot.get("last_trade_price")
        if isinstance(vwap, (int, float)) and isinstance(last, (int, float)):
            relation = "above VWAP" if last >= vwap else "below VWAP"
            return (
                f"Technical signals are {verdict}: price is {relation} "
                f"({last:.2f} vs VWAP {vwap:.2f}) with score {raw_score:+.2f}."
            )
        return f"Technical signals are {verdict} with score {raw_score:+.2f} from current trend structure."

    if layer_l == "news":
        nc_raw = payload.get("news_catalyst")
        nc = dict(nc_raw) if isinstance(nc_raw, dict) else {}
        headline = str(nc.get("headline") or "").strip()
        sentiment = str(nc.get("sentiment") or "neutral").strip().lower()
        if headline:
            return (
                f"News layer is {verdict}: catalyst sentiment is {sentiment} "
                f"from '{headline[:120]}'."
            )
        return f"News layer is {verdict} with score {raw_score:+.2f}; no strong fresh catalyst was provided."

    if layer_l == "macro":
        regime = str(payload.get("regime") or "sideways").strip().lower()
        return f"Macro is {verdict}: current regime is '{regime}' with macro score {raw_score:+.2f}."

    if layer_l == "sector":
        sector_signal = str(payload.get("sector_signal") or "neutral").strip().lower()
        return (
            f"Sector context is {verdict}: sector input is '{sector_signal}' "
            f"and contributes score {raw_score:+.2f}."
        )

    if layer_l == "geopolitical":
        return (
            f"Geopolitical layer is {verdict} with score {raw_score:+.2f}; "
            "current headline risk is reflected in composite weighting."
        )

    if layer_l == "internals":
        return (
            f"Internals are {verdict} with score {raw_score:+.2f}; "
            "breadth/volatility inputs support this weighting."
        )

    return f"{layer.title()} is {verdict} with score {raw_score:+.2f}."


def real_composite_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/signals/composite/real — server-side layer stack from symbol only."""
    _ = context
    try:
        payload = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    symbol = str(payload.get("symbol") or "").strip().upper()
    if not symbol:
        return bad_request("Body field 'symbol' is required.")
    rc = build_request_context(event)
    body = composite_response_with_evidence_cache(
        symbol=symbol,
        user_id=rc.user_id,
        user_email=rc.email,
        mode="day",
        sync_compute=lambda: real_composite_body_sync(
            symbol=symbol,
            user_id=rc.user_id,
            user_email=rc.email,
        ),
    )
    return ok(body)


def swing_real_composite_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/signals/composite/swing — six-layer composite on daily data + swing parameters."""
    _ = context
    try:
        payload = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    symbol = str(payload.get("symbol") or "").strip().upper()
    if not symbol:
        return bad_request("Body field 'symbol' is required.")
    rc = build_request_context(event)
    body = composite_response_with_evidence_cache(
        symbol=symbol,
        user_id=rc.user_id,
        user_email=rc.email,
        mode="swing",
        sync_compute=lambda: swing_composite_body_sync(
            symbol=symbol,
            user_id=rc.user_id,
            user_email=rc.email,
        ),
    )
    return ok(body)


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
        active_params = ParameterStore.get_parameters_sync()
        composite = build_composite_score_engine_from_params(active_params, mode="swing").compute(
            signals, regime=regime
        )
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
                    "reasoning": _generate_layer_reasoning(
                        layer=c.layer,
                        raw_score=c.raw_score,
                        verdict=_layer_verdict(c.raw_score),
                        payload=payload,
                        snapshot=snap,
                    ),
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
        if symbol and price_raw is not None:
            try:
                price_at = float(price_raw)
                layer_scores = {str(s.layer): float(s.score) for s in signals}
                strength = int(round(max(0.0, min(1.0, composite.confidence)) * 100))
                snap_blobs = build_swing_composite_snapshot_payload(
                    payload=payload,
                    response_body=response_body if direction_out else None,
                    layer_scores=layer_scores,
                )
                param_ver = active_params.version
                rr_raw = response_body.get("risk_reward")
                rr_f = float(rr_raw) if isinstance(rr_raw, (int, float)) else None
                if rr_raw is not None and rr_f is None:
                    try:
                        rr_f = float(rr_raw)
                    except (TypeError, ValueError):
                        rr_f = None
                macro_regime = str(
                    payload.get("macro_market_regime") or payload.get("market_regime") or regime or "neutral"
                )
                eligible, gates = evaluate_swing_ledger_entry(
                    response_status=str(response_body.get("status") or "active"),
                    verdict=composite.verdict,
                    composite_score=float(composite.score),
                    alignment_ratio=float(composite.alignment_ratio),
                    macro_market_regime=macro_regime,
                    risk_reward=rr_f,
                    layer_scores=layer_scores,
                )
                gen_at = datetime.now(timezone.utc)
                uid = request_context.user_id
                if eligible:
                    if not is_swing_ledger_entry_window_et(gen_at):
                        eligible = False
                        gates["entry_daily_close_window"] = {
                            "pass": False,
                            "need": "post_regular_close_window_et",
                        }
                    if eligible and uid:
                        if get_signal_recorder().has_open_validation_position(uid, symbol, "swing"):
                            eligible = False
                            gates["dedupe_open_position"] = {
                                "pass": False,
                                "reason": "one_open_validation_per_symbol_mode",
                            }
                ny_date = gen_at.astimezone(ZoneInfo("America/New_York")).date().isoformat()
                rb = response_body
                stop_lvl = rb.get("reference_stop_level")
                ref_t1 = rb.get("reference_target_1")
                try:
                    stop_f = float(stop_lvl) if stop_lvl is not None else None
                except (TypeError, ValueError):
                    stop_f = None
                try:
                    ref_struct_f = float(ref_t1) if ref_t1 is not None else None
                except (TypeError, ValueError):
                    ref_struct_f = None
                rwk = build_regime_window_key(macro_regime, gen_at)
                record = SignalRecord(
                    signal_id=str(uuid4()),
                    symbol=symbol,
                    direction=str(composite.verdict.value),
                    signal_strength=strength,
                    pattern=pattern,
                    layer_scores=layer_scores,
                    price_at_signal=price_at,
                    generated_at=gen_at,
                    user_id=uid,
                    parameter_version=param_ver,
                    technical_snapshot_json=snap_blobs.get("technical_snapshot_json"),
                    news_snapshot_json=snap_blobs.get("news_snapshot_json"),
                    macro_snapshot_json=snap_blobs.get("macro_snapshot_json"),
                    sector_snapshot_json=snap_blobs.get("sector_snapshot_json"),
                    internals_snapshot_json=snap_blobs.get("internals_snapshot_json"),
                    layer_scores_json=snap_blobs.get("layer_scores_json"),
                    mode="swing",
                    ledger_qualified=eligible,
                    gate_status_json=gate_blob_json(gates, qualified=eligible),
                    entry_rationale=entry_rationale_from_gates(eligible, "swing"),
                    decision_state_entry="actionable" if eligible else None,
                    ledger_entry_date_et=ny_date if eligible else None,
                    stop_level=stop_f,
                    reference_structure_level=ref_struct_f,
                    regime_label_at_entry=str(macro_regime),
                    sector_label_at_entry=str(
                        payload.get("sector_signal") or payload.get("sector_verdict") or ""
                    ).strip()
                    or None,
                    vwap_state_at_entry=str(rb.get("vwap_state") or "").strip() or None,
                    regime_window_key=rwk,
                    ledger_position_open=bool(eligible),
                )
                if eligible:
                    get_signal_recorder().record_signal(record)
                else:
                    _LOG.info("swing (legacy) ledger row skipped (gates) symbol=%s", symbol)
                if eligible and request_context.user_id and request_context.email and direction_out:
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
        include_near = bool(payload.get("include_near_qualification"))
        near_min_score = float(payload.get("near_min_score", 0.35))
        near_limit = int(payload.get("near_limit", 5))
        include_trace = bool(payload.get("include_evaluation_trace"))
        trace_limit = int(payload.get("evaluation_trace_limit", 20))
    except ValueError:
        return bad_request("Invalid 'limit', 'min_score', near-qualification, or evaluation-trace fields.")

    try:
        rc = build_request_context(event)
        bars_by_symbol: dict[str, list[Bar]] = {}
        for symbol, bars in bars_by_symbol_raw.items():
            if not isinstance(symbol, str) or not isinstance(bars, list):
                return bad_request("bars_by_symbol entries must map symbol strings to bar arrays.")
            bars_by_symbol[symbol.upper()] = [parse_bar(item, symbol.upper()) for item in bars]

        liq = parse_liquidity_by_symbol_payload(payload.get("liquidity_by_symbol"))
        scanner = IntradaySetupScanner(min_score=min_score)
        setups = scanner.scan(bars_by_symbol, liquidity_by_symbol=liq, limit=limit)
        if include_near:
            near_scanner = IntradaySetupScanner(min_score=near_min_score)
            near_pool = near_scanner.scan(
                bars_by_symbol,
                liquidity_by_symbol=liq,
                limit=max(near_limit * 6, limit),
            )
            rows = bundle_setups_response(
                setups,
                near_pool,
                payload,
                serialize_intraday_setups_with_confluence,
                min_score=min_score,
                near_min_score=near_min_score,
                near_limit=max(1, near_limit),
            )
        else:
            rows = serialize_intraday_setups_with_confluence(setups, payload)
        try:
            attach_geo_preview_to_intraday_rows(
                rows["qualifying"] if isinstance(rows, dict) else rows,
                payload,
            )
            if isinstance(rows, dict):
                attach_geo_preview_to_intraday_rows(rows.get("near_qualification") or [], payload)
        except Exception as exc:
            _LOG.warning("day setups geo preview failed: %s", exc)
        if include_trace:
            bundle = ensure_setups_v2_bundle(rows)
            excluded = excluded_symbols_from_bundle(bundle)
            bundle["evaluation_trace"] = build_intraday_evaluation_traces(
                bars_by_symbol,
                liquidity_by_symbol=liq,
                min_score=min_score,
                exclude_symbols=excluded,
                limit=max(1, min(trace_limit, 50)),
            )
            persist_evaluation_trace_rows(rc.user_id, "day", bundle["evaluation_trace"])
            rows = bundle
        return ok(rows)
    except (KeyError, TypeError, ValueError) as exc:
        return bad_request(f"Invalid day setup request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


def scanner_trace_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/scanner-trace — persisted per-symbol evaluation trace (48h TTL)."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    qs = event.get("queryStringParameters") or {}
    mode_raw = str(qs.get("mode") or "both").strip().lower()
    if mode_raw not in ("day", "swing", "both"):
        return bad_request("Query param 'mode' must be day, swing, or both.")
    session_date = str(qs.get("session_date") or "").strip() or session_date_et()
    try:
        limit = max(1, min(50, int(str(qs.get("limit") or "20"))))
    except (TypeError, ValueError):
        limit = 20
    rows = get_scanner_evaluation_traces_merged(
        rc.user_id,
        mode=mode_raw,
        session_date=session_date,
        limit=limit,
    )
    return ok(
        {
            "session_date_et": session_date,
            "mode": mode_raw,
            "evaluation_trace": rows,
            "disclaimer": SCANNER_EVALUATION_TRACE_DISCLAIMER,
        }
    )


def swing_setups_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/signals/swing/setups — rank swing candidates from daily (DAY_1) bars."""
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
        min_score = float(payload.get("min_score", 0.48))
        min_daily_bars = int(payload.get("min_daily_bars", 205))
        include_near = bool(payload.get("include_near_qualification"))
        near_min_score = float(payload.get("near_min_score", 0.28))
        near_limit = int(payload.get("near_limit", 5))
        include_trace = bool(payload.get("include_evaluation_trace"))
        trace_limit = int(payload.get("evaluation_trace_limit", 20))
    except ValueError:
        return bad_request(
            "Invalid 'limit', 'min_score', 'min_daily_bars', near-qualification, or evaluation-trace fields."
        )

    try:
        rc = build_request_context(event)
        bars_by_symbol: dict[str, list[Bar]] = {}
        for symbol, bars in bars_by_symbol_raw.items():
            if not isinstance(symbol, str) or not isinstance(bars, list):
                return bad_request("bars_by_symbol entries must map symbol strings to bar arrays.")
            bars_by_symbol[symbol.upper()] = [parse_bar(item, symbol.upper()) for item in bars]

        liq = parse_liquidity_by_symbol_payload(payload.get("liquidity_by_symbol"))
        min_bars = max(60, min_daily_bars)
        scanner = DailyBarScanner(min_score=min_score, min_bars=min_bars)
        setups = scanner.scan(bars_by_symbol, liquidity_by_symbol=liq, limit=limit)
        if include_near:
            near_scanner = DailyBarScanner(min_score=near_min_score, min_bars=min_bars)
            near_pool = near_scanner.scan(
                bars_by_symbol,
                liquidity_by_symbol=liq,
                limit=max(near_limit * 6, limit),
            )
            rows = bundle_setups_response(
                setups,
                near_pool,
                payload,
                serialize_daily_bar_setups_with_confluence,
                min_score=min_score,
                near_min_score=near_min_score,
                near_limit=max(1, near_limit),
            )
        else:
            rows = serialize_daily_bar_setups_with_confluence(setups, payload)
        try:
            attach_geo_preview_to_intraday_rows(
                rows["qualifying"] if isinstance(rows, dict) else rows,
                payload,
            )
            if isinstance(rows, dict):
                attach_geo_preview_to_intraday_rows(rows.get("near_qualification") or [], payload)
        except Exception as exc:
            _LOG.warning("swing setups geo preview failed: %s", exc)
        if include_trace:
            bundle = ensure_setups_v2_bundle(rows)
            excluded = excluded_symbols_from_bundle(bundle)
            bundle["evaluation_trace"] = build_swing_evaluation_traces(
                bars_by_symbol,
                liquidity_by_symbol=liq,
                min_score=min_score,
                min_bars=min_bars,
                exclude_symbols=excluded,
                limit=max(1, min(trace_limit, 50)),
            )
            persist_evaluation_trace_rows(rc.user_id, "swing", bundle["evaluation_trace"])
            rows = bundle
        return ok(rows)
    except (KeyError, TypeError, ValueError) as exc:
        return bad_request(f"Invalid swing setup request: {exc}")
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


def _signal_id_from_path(event: LambdaEvent, *, path_prefix: str) -> str | None:
    """Resolve ``signal_id`` from API Gateway ``{signal_id}`` param or raw path (local tests)."""
    pp = event.get("pathParameters") or {}
    raw = pp.get("signal_id")
    if raw and str(raw).strip() and not str(raw).startswith("{"):
        return str(raw).strip()
    http = (event.get("requestContext") or {}).get("http") or {}
    path = str(http.get("path") or event.get("path") or "")
    if not path.startswith(path_prefix):
        return None
    rest = path[len(path_prefix) :].split("?")[0].strip().strip("/")
    return rest or None


def public_platform_signal_record_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/records/{signal_id} — platform (non-user) signals only."""
    _ = context
    sid = _signal_id_from_path(event, path_prefix="/v1/signals/records/")
    if not sid:
        return bad_request("signal_id is required.")
    rec = get_signal_recorder().get_signal_record_raw(sid)
    if rec is None:
        return not_found("Signal not found.")
    if rec.user_id is not None:
        return not_found("Signal not found.")
    return ok(public_signal_detail_dict(rec))


def user_signal_record_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/me/records/{signal_id} — authenticated user's evaluated signals only."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    sid = _signal_id_from_path(event, path_prefix="/v1/signals/me/records/")
    if not sid:
        return bad_request("signal_id is required.")
    rec = get_signal_recorder().get_signal_record_raw(sid)
    if rec is None or rec.user_id != rc.user_id:
        return not_found("Signal not found.")
    return ok(public_signal_detail_dict(rec))


def signals_analysis_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/analysis — admin / internal only; aggregates stored signals for tuning."""
    _ = context
    rc = build_request_context(event)
    headers = event.get("headers") if isinstance(event.get("headers"), dict) else {}
    if not analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return unauthorized("Signal analysis requires admin authorization.")
    qs = event.get("queryStringParameters") or {}
    period = str(qs.get("period") or "30d").strip() or "30d"
    rows = get_signal_recorder().scan_all_records()
    body = build_signal_analysis_payload(records=rows, period=period)
    body["disclaimer"] = API_SIGNAL_DISCLAIMER
    return ok(body)


def ai_explanations_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/signals/ai/explanations — signal capture / news synthesis copy (paid = Claude)."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Body must be a JSON object.")

    profile = get_user_profile_store().get_profile(rc.user_id)
    # Admin entitlement bump: an admin caller transparently gets the
    # paid (Claude) explanation path so they see exactly what a paying
    # user sees while inspecting the app. We construct a transient copy
    # of the profile with the beta-access flag set — the persisted row
    # is untouched. The bump uses the same gate as the admin-only
    # endpoints (`analysis_authorized`) so there is no way to be "admin
    # for AI" without also being "admin for backend".
    headers = event.get("headers") or {}
    if isinstance(headers, dict) and analysis_authorized(
        user_id=rc.user_id, claims=rc.claims, headers=headers
    ):
        profile = profile.model_copy(update={"beta_full_access": True})
    typ = str(body.get("type") or "").strip()
    svc = AIExplanationService()

    try:
        if typ == "signal_capture":
            symbol = str(body.get("symbol") or "").strip().upper()
            if not symbol:
                return bad_request("symbol is required.")
            score = int(body.get("score") or 0)
            verdict = str(body.get("verdict") or "neutral")
            rr = float(body.get("risk_reward") or 0.0)
            raw_layers = body.get("top_layers")
            top_layers = [x for x in raw_layers if isinstance(x, dict)] if isinstance(raw_layers, list) else []
            result = asyncio.run(
                svc.explain_signal_capture(
                    symbol=symbol,
                    score=score,
                    verdict=verdict,
                    top_layers=top_layers,
                    risk_reward=rr,
                    user_profile=profile,
                )
            )
        elif typ == "news_synthesis":
            symbol = str(body.get("symbol") or "").strip().upper()
            if not symbol:
                return bad_request("symbol is required.")
            verdict = str(body.get("verdict") or "neutral")
            raw_arts = body.get("articles")
            arts_list = raw_arts if isinstance(raw_arts, list) else []
            articles = news_articles_from_payload(arts_list)
            result = asyncio.run(
                svc.explain_news_synthesis(
                    symbol=symbol,
                    articles=articles,
                    verdict=verdict,
                    user_profile=profile,
                )
            )
        else:
            return bad_request("type must be signal_capture or news_synthesis.")
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid explanation request: {exc}")

    return ok(
        {
            "text": result.text,
            "source": result.source,
            "upgrade_available": result.upgrade_available,
            "cached": result.cached,
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
    )


def assistant_chat_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/signals/assistant/chat — STOCVEST Assistant conversational explanations.

    Requires authentication. The system prompt is locked server-side; clients only
    supply the conversation turns and an optional whitelisted page-context object.
    Paid users get a Claude-generated reply; free users get a deterministic message.
    """
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Body must be a JSON object.")

    raw_messages = body.get("messages")
    raw_context = body.get("page_context")
    page_context = raw_context if isinstance(raw_context, dict) else None

    profile = get_user_profile_store().get_profile(rc.user_id)
    svc = AssistantChatService()

    # Fetch the user's Phase 2 historical-validation summary (trailing 90 days, 1d
    # horizon — same defaults as the public mirror on /performance, but scoped to this
    # user). Failures are caught defensively: a chat turn must not break because the
    # signal-history store is briefly slow / unavailable. When the summary cannot be
    # fetched OR the user has zero rows in the window, the chat service skips the
    # historical-validation tail block entirely and the prompt's "if the field is
    # absent, do not comment" rule activates.
    historical_summary = None
    try:
        validation_service = HistoricalValidationService(get_signal_recorder())
        _now = datetime.now(timezone.utc)
        historical_summary = validation_service.summarize(
            user_id=rc.user_id,
            from_at=_now - timedelta(days=90),
            to_at=_now,
            horizon="1d",
        )
    except Exception:  # noqa: BLE001 — never let a fetch failure break the chat reply
        _LOG.exception("assistant_chat: failed to fetch historical validation summary")
        historical_summary = None

    try:
        result = asyncio.run(
            svc.reply(
                messages=raw_messages if isinstance(raw_messages, list) else [],
                page_context=page_context,
                user_profile=profile,
                historical_validation_summary=historical_summary,
            )
        )
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid assistant request: {exc}")

    return ok(
        {
            "text": result.text,
            "source": result.source,
            "mode": result.mode,
            "upgrade_available": result.upgrade_available,
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
    )


def public_assistant_chat_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/public/assistant/chat — unauthenticated STOCVEST Assistant for marketing visitors.

    No JWT required. The locked system prompt's PUBLIC MODE section activates via the
    appended ``session_mode=public`` marker so anonymous visitors can ask what STOCVEST
    is, how it positions itself versus signal-alert services, and for explanations of
    finance terms — while the prompt continues to refuse all trade recommendations,
    price predictions, and accuracy claims.

    Any ``page_context`` posted from the client is intentionally ignored on this path —
    anonymous visitors have no STOCVEST page state to anchor against.
    """
    _ = context
    try:
        body = parse_json_body(event)
    except (TypeError, ValueError, KeyError):
        return bad_request("Invalid JSON body.")
    if not isinstance(body, dict):
        return bad_request("Body must be a JSON object.")

    raw_messages = body.get("messages")
    svc = AssistantChatService()
    try:
        result = asyncio.run(
            svc.reply_public(
                messages=raw_messages if isinstance(raw_messages, list) else [],
            )
        )
    except (TypeError, ValueError) as exc:
        return bad_request(f"Invalid assistant request: {exc}")

    return ok(
        {
            "text": result.text,
            "source": result.source,
            "mode": result.mode,
            "upgrade_available": result.upgrade_available,
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
    )


def founding_members_count_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/founding-members — public pricing counter for landing page."""
    _ = event
    _ = context
    count = max(0, get_founding_member_count())
    return ok({"founding_member_count": count, "founding_spots_total": 100, "founding_spots_remaining": max(0, 100 - count)})


def _parse_me_history_page_size(qs: dict[str, Any]) -> int:
    """Allowed sizes only; default 25. Legacy `limit` is honored when `page_size` is absent."""
    allowed = (25, 50, 75, 100)
    raw_ps = qs.get("page_size")
    if raw_ps is not None and str(raw_ps).strip() != "":
        try:
            n = int(str(raw_ps))
        except (TypeError, ValueError):
            return 25
        return n if n in allowed else 25
    raw_lim = qs.get("limit")
    if raw_lim is not None and str(raw_lim).strip() != "":
        try:
            n = int(str(raw_lim))
        except (TypeError, ValueError):
            return 25
        if n in allowed:
            return n
        return 100 if n > 100 else 25
    return 25


def user_signal_history_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/me/history — legacy SignalHistory ledger (deprecated; B46).

    User-facing setup behavior is ``GET /v1/analytics/setup-outcomes``. This endpoint
    remains for admin/tooling and D1 resolution until Phase 6 retires the table.
    """
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")
    qs = event.get("queryStringParameters") or {}
    symbol = str(qs.get("symbol") or "").strip().upper() or None
    try:
        days = max(1, min(365, int(str(qs.get("days") or "30"))))
    except (TypeError, ValueError):
        days = 30
    page_size = _parse_me_history_page_size(qs)
    cursor_raw = str(qs.get("cursor") or "").strip() or None
    lo = str(qs.get("ledger_only") or qs.get("ledger_qualified_only") or "").strip().lower()
    ledger_qualified_only = lo in ("1", "true", "yes")
    mode_raw = str(qs.get("mode") or "").strip().lower()
    mode_filter: str | None = mode_raw if mode_raw in ("day", "swing") else None
    rows, next_cursor = get_signal_recorder().get_user_signal_history_page(
        user_id=rc.user_id,
        symbol=symbol,
        days=days,
        page_size=page_size,
        mode=mode_filter,
        ledger_qualified_only=ledger_qualified_only,
        cursor=cursor_raw,
    )
    return json_response(
        200,
        {
            "items": [public_signal_detail_dict(r) for r in rows],
            "next_cursor": next_cursor,
            "page_size": page_size,
            "deprecation_notice": (
                "Prefer GET /v1/analytics/setup-outcomes for user setup behavior. "
                "This SignalHistory ledger API will be removed in a future release."
            ),
        },
        headers={
            "Deprecation": "true",
            'Link': '</v1/analytics/setup-outcomes>; rel="successor-version"',
        },
    )


# ── D2 Historical Signal Validation — Phase 3a (read-only HTTP surface) ────────────────
#
# The handler below is the thin HTTP wrapper around ``HistoricalValidationService``
# (Phase 2). It is deliberately narrow:
#
# - Auth-gated (``rc.user_id`` required) — every query is scoped to the calling user, so
#   one tenant cannot read another tenant's tracked outcomes. The public ``/performance``
#   mirror (Phase 3b) gets its own unauthenticated handler instead of widening this one.
# - Read-only — no DB writes, no Polygon calls, no Claude calls. Worst case it scans a
#   capped slice of ``SignalHistory`` and runs Phase 1's pure aggregator.
# - JSON-safe — Phase 1's ``BucketStats.accuracy`` is ``math.nan`` when there are no
#   resolved-non-neutral rows. We convert NaN to ``None`` here so the response is valid
#   JSON (Python's default ``json.dumps`` emits the literal ``NaN`` which crashes browsers)
#   and the dashboard tab can render "—" rather than a misleading "0%".


def _parse_horizon(qs: dict[str, Any]) -> Horizon | None:
    raw = str(qs.get("horizon") or "").strip().lower()
    if raw in ("1h", "1d"):
        return raw  # type: ignore[return-value]
    return None


def _parse_iso_datetime(raw: Any) -> datetime | None:
    """Parse an ISO-8601 datetime from a query-string value.

    Accepts the trailing-``Z`` form (`2026-04-01T00:00:00Z`) that JavaScript's
    `Date.toISOString()` emits. Naive inputs are treated as UTC so the dashboard
    tab can send a plain `YYYY-MM-DD` date if it wants the calendar-day window.
    """

    if raw is None or not str(raw).strip():
        return None
    s = str(raw).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _bucket_stats_to_dict(stats: BucketStats) -> dict[str, Any]:
    """JSON-safe serialization of a ``BucketStats``.

    ``accuracy`` collapses NaN to ``None`` because Python's default ``json.dumps``
    emits the literal ``NaN`` which is not valid JSON.
    """

    return {
        "total_signals": stats.total_signals,
        "correct": stats.correct,
        "incorrect": stats.incorrect,
        "neutral": stats.neutral,
        "resolved": stats.resolved,
        "accuracy": None if math.isnan(stats.accuracy) else stats.accuracy,
    }


def _summary_to_dict(summary: HistoricalValidationSummary) -> dict[str, Any]:
    """JSON-safe serialization of a ``HistoricalValidationSummary``."""

    return {
        "horizon": summary.horizon,
        "overall": _bucket_stats_to_dict(summary.overall),
        "by_decision": {k: _bucket_stats_to_dict(v) for k, v in summary.by_decision.items()},
        "by_regime": {k: _bucket_stats_to_dict(v) for k, v in summary.by_regime.items()},
        "by_mode": {k: _bucket_stats_to_dict(v) for k, v in summary.by_mode.items()},
        "by_pattern": {k: _bucket_stats_to_dict(v) for k, v in summary.by_pattern.items()},
        "by_readiness": {k: _bucket_stats_to_dict(v) for k, v in summary.by_readiness.items()},
        "by_direction": {k: _bucket_stats_to_dict(v) for k, v in summary.by_direction.items()},
        "rows_examined": summary.rows_examined,
        "parameter_versions": list(summary.parameter_versions),
    }


def historical_validation_summary_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/historical-validation/summary — directional accuracy over a window.

    Query string:
      ``horizon``   (required) — ``"1h"`` or ``"1d"``.
      ``from``      (required) — ISO-8601 datetime. Naive = UTC. Lower bound inclusive.
      ``to``        (required) — ISO-8601 datetime. Naive = UTC. Upper bound exclusive.
      ``mode``      (optional) — ``"swing"`` or ``"day"``. Other values are ignored.
      ``symbol``    (optional) — single ticker filter (e.g. ``AAPL``).
      ``by_version`` (optional) — ``"true"`` to receive a per-``parameter_version`` map.

    Responses:
      - ``200`` — body carries ``summary`` (default) or ``by_parameter_version`` (when
        ``by_version=true``), plus echoed window parameters and the historical-validation
        disclaimer.
      - ``400`` — invalid / missing horizon, invalid / missing ``from`` / ``to``, or
        inverted window. The error envelope matches ``stocvest.api.response.bad_request``.
      - ``401`` — no authenticated user.
    """

    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authenticated user is required.")

    qs = event.get("queryStringParameters") or {}
    if not isinstance(qs, dict):
        qs = {}

    horizon = _parse_horizon(qs)
    if horizon is None:
        return bad_request("horizon must be '1h' or '1d'.")

    from_at = _parse_iso_datetime(qs.get("from"))
    if from_at is None:
        return bad_request("from must be an ISO-8601 datetime (e.g. 2026-04-01T00:00:00Z).")

    to_at = _parse_iso_datetime(qs.get("to"))
    if to_at is None:
        return bad_request("to must be an ISO-8601 datetime (e.g. 2026-05-01T00:00:00Z).")

    if to_at <= from_at:
        return bad_request("to must be strictly after from.")

    mode_raw = str(qs.get("mode") or "").strip().lower()
    mode_filter: str | None = mode_raw if mode_raw in ("day", "swing") else None

    symbol_raw = str(qs.get("symbol") or "").strip().upper()
    symbol_filter: str | None = symbol_raw or None

    by_version_raw = str(qs.get("by_version") or "").strip().lower()
    by_version = by_version_raw in ("1", "true", "yes")

    try:
        service = HistoricalValidationService(get_signal_recorder())
        body: dict[str, Any] = {
            "horizon": horizon,
            "from": from_at.isoformat(),
            "to": to_at.isoformat(),
            "mode": mode_filter,
            "symbol": symbol_filter,
            "disclaimer": HISTORICAL_VALIDATION_DISCLAIMER,
        }
        if by_version:
            result_map = service.summarize_by_parameter_version(
                user_id=rc.user_id,
                from_at=from_at,
                to_at=to_at,
                horizon=horizon,
                mode=mode_filter,
                symbol=symbol_filter,
            )
            body["by_parameter_version"] = {
                version: _summary_to_dict(summary) for version, summary in result_map.items()
            }
        else:
            summary = service.summarize(
                user_id=rc.user_id,
                from_at=from_at,
                to_at=to_at,
                horizon=horizon,
                mode=mode_filter,
                symbol=symbol_filter,
            )
            body["summary"] = _summary_to_dict(summary)
        return ok(body)
    except Exception as exc:  # noqa: BLE001 — defensive; service should never raise
        _LOG.exception("historical_validation_summary failed: %s", exc)
        return internal_error("Historical validation summary failed.")


def _public_summary_to_dict(summary: HistoricalValidationSummary) -> dict[str, Any]:
    """JSON-safe public projection of a ``HistoricalValidationSummary``.

    Deliberately strips every stratification that the LOGGED-OUT golden rule in the
    assistant prompt forbids surfacing to homepage visitors:

    - ``by_decision`` — surfaces which decision states are passing / failing, which is
      logged-in evidence detail.
    - ``by_regime`` — per-macro-regime accuracy is per-context inference detail.
    - ``by_pattern`` — per-setup-family accuracy is "evaluate this stock"-adjacent
      (a visitor who sees a pattern's accuracy would naturally ask "what's the current
      AAPL pattern?", and we never want to encourage that question from a logged-out
      surface).
    - ``by_readiness`` — Trade Readiness scores are LOGGED-IN ONLY by prompt rule.
    - ``by_direction`` — bullish / bearish breakdown is performance per direction;
      borderline, but safest to omit so the public mirror stays calm and framework-only.
    - ``parameter_versions`` — internal engineering detail; no value for public users.

    What remains:

    - ``horizon`` — so the UI can render the right horizon label.
    - ``overall`` — single overall directional accuracy, framework-level.
    - ``by_mode`` — high-level "swing vs day" cadence framing, which is already public.
    - ``rows_examined`` — how much data backs this number; transparency without specifics.
    """

    return {
        "horizon": summary.horizon,
        "overall": _bucket_stats_to_dict(summary.overall),
        "by_mode": {k: _bucket_stats_to_dict(v) for k, v in summary.by_mode.items()},
        "rows_examined": summary.rows_examined,
    }


# Default window the public mirror serves when ``from`` / ``to`` are omitted: the
# trailing 90 calendar days ending now. 90d is enough to smooth single-week variance,
# short enough that the mirror reflects "recent track record" rather than legacy noise,
# and well below the service-layer ``MAX_LOOKBACK_DAYS = 366`` cap.
PUBLIC_HISTORICAL_VALIDATION_DEFAULT_DAYS = 90
PUBLIC_HISTORICAL_VALIDATION_DEFAULT_HORIZON: Horizon = "1d"


def public_historical_validation_summary_handler(
    event: LambdaEvent, context: LambdaContext
) -> dict[str, Any]:
    """GET /v1/signals/historical-validation/public-summary — public mirror of D2.

    Same Phase 1 aggregator as ``historical_validation_summary_handler``, but:

    - **Unauthenticated.** Backed by the platform signal scope (`user_id=None` →
      `scope_key == "PUBLIC"`), so no user data ever leaks through.
    - **Trimmed projection.** Returns only ``overall`` + ``by_mode`` + ``horizon`` +
      ``rows_examined`` + the standing disclaimer; the per-decision / per-regime /
      per-pattern / per-readiness / per-direction stratifications are dropped at the
      response layer to honor the assistant prompt's LOGGED-OUT golden rule
      ("Explain the FRAMEWORK, not the DECISION").
    - **Defaults.** ``horizon`` defaults to ``"1d"`` (matches the marketing-facing
      swing track) and the window defaults to the trailing
      ``PUBLIC_HISTORICAL_VALIDATION_DEFAULT_DAYS`` days when ``from`` / ``to`` are
      omitted, so the homepage can hit the endpoint with no query string at all.
    - **Symbol filter forbidden.** Accepting ``symbol`` would let a logged-out visitor
      query per-ticker accuracy, which the prompt rules explicitly disallow. We return
      a calm 400 in that case rather than silently ignoring the param.
    - **``by_version`` ignored.** Per-engine-version detail is internal; the public
      surface never receives the per-version map even if the query param is set.

    Query string (all optional):
      ``horizon`` — ``"1h"`` or ``"1d"`` (default ``"1d"``).
      ``from`` / ``to`` — ISO-8601 datetimes; if omitted, the trailing
        ``PUBLIC_HISTORICAL_VALIDATION_DEFAULT_DAYS`` window ending now is used.
      ``mode`` — ``"swing"`` or ``"day"``. Other values are ignored.
    """

    _ = context

    qs = event.get("queryStringParameters") or {}
    if not isinstance(qs, dict):
        qs = {}

    # Symbol-level queries are forbidden on the public surface — same compliance gate
    # that the assistant prompt enforces. We respond with a clear 400 so any caller
    # accidentally passing it sees the rejection rather than thinking it was honored.
    if str(qs.get("symbol") or "").strip():
        return bad_request(
            "Per-symbol queries are not available on the public surface. "
            "Sign in to see per-symbol evaluation."
        )

    horizon = _parse_horizon(qs)
    if horizon is None and "horizon" in qs and str(qs.get("horizon") or "").strip():
        # The caller passed *something* for horizon but it wasn't 1h/1d — surface a
        # calm 400 rather than silently defaulting and confusing them.
        return bad_request("horizon must be '1h' or '1d'.")
    if horizon is None:
        horizon = PUBLIC_HISTORICAL_VALIDATION_DEFAULT_HORIZON

    now = datetime.now(timezone.utc)
    from_at = _parse_iso_datetime(qs.get("from"))
    to_at = _parse_iso_datetime(qs.get("to"))
    if from_at is None and to_at is None:
        to_at = now
        from_at = now - timedelta(days=PUBLIC_HISTORICAL_VALIDATION_DEFAULT_DAYS)
    elif from_at is None or to_at is None:
        # Partial windows aren't supported on the public surface — either supply both
        # bounds or neither (and let the default trailing window take over).
        return bad_request("from and to must be supplied together, or both omitted.")
    elif to_at <= from_at:
        return bad_request("to must be strictly after from.")

    mode_raw = str(qs.get("mode") or "").strip().lower()
    mode_filter: str | None = mode_raw if mode_raw in ("day", "swing") else None

    try:
        service = HistoricalValidationService(get_signal_recorder())
        summary = service.summarize(
            user_id=None,  # platform scope; selects rows where scope_key == "PUBLIC"
            from_at=from_at,
            to_at=to_at,
            horizon=horizon,
            mode=mode_filter,
            symbol=None,  # never honored on this surface — see symbol gate above
        )
        body: dict[str, Any] = {
            "horizon": horizon,
            "from": from_at.isoformat(),
            "to": to_at.isoformat(),
            "mode": mode_filter,
            "disclaimer": HISTORICAL_VALIDATION_DISCLAIMER,
            "summary": _public_summary_to_dict(summary),
        }
        return ok(body)
    except Exception as exc:  # noqa: BLE001 — defensive
        _LOG.exception("public_historical_validation_summary failed: %s", exc)
        return internal_error("Public historical validation summary failed.")


def gap_intel_snapshot_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """GET /v1/signals/gap-intel — server-computed gap lifecycle snapshot (auth required)."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authentication required.")
    qs = event.get("queryStringParameters") or {}
    symbol_raw = str(qs.get("symbol") or "").strip().upper()
    if not symbol_raw:
        return bad_request("Query parameter 'symbol' is required.")
    mode_raw = str(qs.get("trading_mode") or "day").strip().lower()
    mode: Literal["day", "swing"] = "swing" if mode_raw == "swing" else "day"

    now_utc = datetime.now(tz=timezone.utc)
    session_date_et = now_utc.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    ck = gap_intel_cache_key(symbol_raw, mode, session_date_et)
    now_epoch = int(now_utc.timestamp())

    cached = get_gap_intel_cache_row(ck)
    if cached is not None and cached.soft_expire > now_epoch:
        return ok(cached.payload)

    old_sb = cached.last_sb_state if cached else None
    prior_dm = cached.last_disable_metric_at if cached else None

    def _compute_gap() -> dict[str, Any]:
        return asyncio.run(compute_gap_intel_body(symbol_raw, mode, now_utc=now_utc))

    try:
        body = polygon_circuit.call(
            lambda: _compute_with_thread_timeout(_compute_gap, timeout_sec=_GAP_INTEL_TIMEOUT_SEC)
        )
    except CircuitOpenError:
        if cached is not None:
            stale = dict(cached.payload)
            stale["source"] = "cache_stale"
            return ok(stale)
        return ok(
            {
                "error": "upstream_unavailable",
                "symbol": symbol_raw,
                "message": "Market data is briefly unavailable. Try again in a moment.",
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )
    except PolygonError as exc:
        return bad_request(str(exc))

    if body is None:
        if cached is not None:
            stale = dict(cached.payload)
            stale["source"] = "cache_stale"
            return ok(stale)
        return ok(
            {
                "error": "timeout",
                "symbol": symbol_raw,
                "message": "Gap intelligence timed out. Try again in a moment.",
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )

    merged_dm = next_last_disable_metric_timestamp(
        old_sb_state=old_sb,
        prior_last_disable_metric_at=prior_dm,
        new_body=body,
        symbol=symbol_raw,
        trading_mode=mode,
    )
    put_gap_intel_cache_row(ck, body, last_disable_metric_at=merged_dm)
    return ok(body)


_GAP_INTEL_BATCH_MAX = 24


def gap_intel_batch_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """POST /v1/signals/gap-intel/batch — bounded multi-symbol gap intel (auth required)."""
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Authentication required.")
    payload = parse_json_body(event)
    if not isinstance(payload, dict):
        return bad_request("JSON body required.")
    raw_syms = payload.get("symbols")
    if not isinstance(raw_syms, list) or not raw_syms:
        return bad_request("Field 'symbols' must be a non-empty array.")
    mode_raw = str(payload.get("trading_mode") or "day").strip().lower()
    mode: Literal["day", "swing"] = "swing" if mode_raw == "swing" else "day"

    seen: list[str] = []
    for s in raw_syms:
        if len(seen) >= _GAP_INTEL_BATCH_MAX:
            break
        u = str(s or "").strip().upper()
        if u and u not in seen:
            seen.append(u)

    if not seen:
        return bad_request("No valid symbols in 'symbols'.")

    now_utc = datetime.now(tz=timezone.utc)
    session_date_et = now_utc.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    items: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for sym in seen:
        ck = gap_intel_cache_key(sym, mode, session_date_et)
        now_epoch = int(now_utc.timestamp())
        cached = get_gap_intel_cache_row(ck)
        if cached is not None and cached.soft_expire > now_epoch:
            items[sym] = cached.payload
            continue
        old_sb = cached.last_sb_state if cached else None
        prior_dm = cached.last_disable_metric_at if cached else None
        try:
            body = asyncio.run(compute_gap_intel_body(sym, mode, now_utc=now_utc))
        except PolygonError as exc:
            errors[sym] = str(exc)
            continue
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("gap_intel_batch failed for %s: %s", sym, exc)
            errors[sym] = "gap intelligence failed"
            continue
        merged_dm = next_last_disable_metric_timestamp(
            old_sb_state=old_sb,
            prior_last_disable_metric_at=prior_dm,
            new_body=body,
            symbol=sym,
            trading_mode=mode,
        )
        put_gap_intel_cache_row(ck, body, last_disable_metric_at=merged_dm)
        items[sym] = body

    out: dict[str, Any] = {
        "items": items,
        "errors": errors,
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }
    return ok(out)


def signals_http_dispatch(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """Route signals module requests including parameterized outcome-tracking paths."""
    route = http_route_descriptor(event)
    # D10 Phase 3a — admin proposal review surface. Parameterized routes
    # are checked BEFORE the flat-route table because the {proposal_id}
    # path-param shape doesn't match a literal route key.
    if route.startswith("POST /v1/admin/proposals/") and route.endswith("/promote"):
        from stocvest.api.handlers.admin_proposals import admin_proposals_promote_handler

        return admin_proposals_promote_handler(event, context)
    if route.startswith("POST /v1/admin/proposals/") and route.endswith("/reject"):
        from stocvest.api.handlers.admin_proposals import admin_proposals_reject_handler

        return admin_proposals_reject_handler(event, context)
    if route.startswith("GET /v1/admin/proposals/"):
        from stocvest.api.handlers.admin_proposals import admin_proposals_get_handler

        return admin_proposals_get_handler(event, context)
    if route == "GET /v1/admin/proposals" or route.startswith("GET /v1/admin/proposals?"):
        from stocvest.api.handlers.admin_proposals import admin_proposals_list_handler

        return admin_proposals_list_handler(event, context)
    # D10 Phase 4 — admin parameter rollback surface. Same admin gate
    # (analysis_authorized) as the proposal review routes; same atomic
    # write primitive (ParameterStore.save_parameters_sync) so promotion
    # and rollback both produce honest ParameterHistory audit rows.
    if route == "POST /v1/admin/parameters/rollback":
        from stocvest.api.handlers.admin_parameters import (
            admin_parameters_rollback_handler,
        )

        return admin_parameters_rollback_handler(event, context)
    if route == "GET /v1/admin/parameters/history" or route.startswith(
        "GET /v1/admin/parameters/history?"
    ):
        from stocvest.api.handlers.admin_parameters import (
            admin_parameters_history_handler,
        )

        return admin_parameters_history_handler(event, context)
    # D10 Admin hub — readable view of the live SignalParameters secret
    # + aggregated operations status. Same admin gate as proposals /
    # rollback above. The hub page uses these to render its overview
    # tile and its dedicated "current parameters" section.
    if route == "GET /v1/admin/parameters/current" or route.startswith(
        "GET /v1/admin/parameters/current?"
    ):
        from stocvest.api.handlers.admin_parameters import (
            admin_parameters_current_handler,
        )

        return admin_parameters_current_handler(event, context)
    if route == "GET /v1/admin/system-status" or route.startswith(
        "GET /v1/admin/system-status?"
    ):
        from stocvest.api.handlers.admin_system_status import (
            admin_system_status_handler,
        )

        return admin_system_status_handler(event, context)
    if route.startswith("GET /v1/signals/records/"):
        return public_platform_signal_record_handler(event, context)
    if route.startswith("GET /v1/signals/me/records/"):
        return user_signal_record_handler(event, context)
    if route == "GET /v1/signals/me/history" or route.startswith("GET /v1/signals/me/history?"):
        return user_signal_history_handler(event, context)
    if route == "GET /v1/signals/analysis" or route.startswith("GET /v1/signals/analysis?"):
        return signals_analysis_handler(event, context)
    if (
        route == "GET /v1/signals/historical-validation/public-summary"
        or route.startswith("GET /v1/signals/historical-validation/public-summary?")
    ):
        return public_historical_validation_summary_handler(event, context)
    if (
        route == "GET /v1/signals/historical-validation/summary"
        or route.startswith("GET /v1/signals/historical-validation/summary?")
    ):
        return historical_validation_summary_handler(event, context)
    if route == "GET /v1/signals/scanner-trace" or route.startswith("GET /v1/signals/scanner-trace?"):
        return scanner_trace_handler(event, context)

    routes: dict[str, Callable[[LambdaEvent, LambdaContext], dict[str, Any]]] = {
        "GET /v1/signals/founding-members": founding_members_count_handler,
        "POST /v1/signals/ai/explanations": ai_explanations_handler,
        "POST /v1/signals/assistant/chat": assistant_chat_handler,
        "POST /v1/public/assistant/chat": public_assistant_chat_handler,
        "POST /v1/signals/composite/real": real_composite_handler,
        "POST /v1/signals/composite/swing": swing_real_composite_handler,
        "POST /v1/signals/swing/composite": swing_composite_handler,
        "POST /v1/signals/swing/synthesis/parse": swing_synthesis_parse_handler,
        "POST /v1/signals/day/setups": day_setups_handler,
        "POST /v1/signals/swing/setups": swing_setups_handler,
        "POST /v1/signals/day/briefing": day_briefing_handler,
        "GET /v1/signals/recent": public_recent_signals_handler,
        "GET /v1/signals/performance/summary": public_performance_summary_handler,
        "GET /v1/signals/gap-intel": gap_intel_snapshot_handler,
        "POST /v1/signals/gap-intel/batch": gap_intel_batch_handler,
    }
    target = routes.get(route)
    if target is None:
        return not_found(f"Unknown route: {route or '(empty)'}")
    return target(event, context)

