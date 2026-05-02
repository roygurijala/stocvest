"""Phase 4d signal endpoint handlers (swing + day-trading)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
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
from stocvest.utils.config import get_settings
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
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )
    except (KeyError, TypeError, ValueError) as exc:
        return bad_request(f"Invalid briefing request: {exc}")
    except Exception as exc:
        return internal_error(str(exc))


_SIGNAL_PERFORMANCE_TABLE_NAME = "SignalPerformance"
_OUTCOME_THRESHOLD_PCT = 0.5
_LAUNCH_DATE = datetime.now(timezone.utc).date()


def _to_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_iso(ts: Any) -> datetime | None:
    if not isinstance(ts, str) or not ts.strip():
        return None
    raw = ts.strip()
    if raw.endswith("Z"):
        raw = f"{raw[:-1]}+00:00"
    try:
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _compute_signal_outcome(item: dict[str, Any], now: datetime) -> str:
    ts = _parse_iso(item.get("timestamp_iso") or item.get("timestamp"))
    if ts is None:
        return "pending"
    if (now - ts).total_seconds() < 24 * 60 * 60:
        return "pending"

    direction = str(item.get("direction") or "").strip().lower()
    entry = _to_float(item.get("price_at_signal"))
    resolved = (
        _to_float(item.get("price_outcome"))
        or _to_float(item.get("price_24h_after"))
        or _to_float(item.get("price_1d_after"))
        or _to_float(item.get("resolved_price"))
        or _to_float(item.get("close"))
    )
    if entry is None or resolved is None or entry == 0:
        return "pending"

    move_pct = ((resolved - entry) / entry) * 100.0
    if abs(move_pct) <= _OUTCOME_THRESHOLD_PCT:
        return "neutral"
    if direction in {"long", "buy", "bullish"}:
        return "win" if move_pct > 0 else "loss"
    if direction in {"short", "sell", "bearish"}:
        return "win" if move_pct < 0 else "loss"
    return "neutral"


def _public_signal_shape(item: dict[str, Any], now: datetime) -> dict[str, Any]:
    direction = str(item.get("direction") or "").strip().lower()
    if direction in {"buy", "bullish"}:
        direction = "long"
    elif direction in {"sell", "bearish"}:
        direction = "short"
    elif direction not in {"long", "short", "neutral"}:
        direction = "neutral"

    raw_strength = _to_float(item.get("signal_strength"))
    if raw_strength is None:
        raw_strength = _to_float(item.get("confidence"))
    return {
        "symbol": str(item.get("symbol") or "").upper(),
        "direction": direction,
        "signal_strength": round(raw_strength, 2) if raw_strength is not None else 0.0,
        "timestamp_iso": str(item.get("timestamp_iso") or item.get("timestamp") or ""),
        "outcome": _compute_signal_outcome(item, now),
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }


def _scan_signal_performance_items() -> list[dict[str, Any]]:
    try:
        import boto3
        from botocore.exceptions import ClientError
    except Exception:
        return []

    settings = get_settings()
    kwargs: dict[str, Any] = {}
    if settings.dynamodb_endpoint_url:
        kwargs["endpoint_url"] = settings.dynamodb_endpoint_url
    table = boto3.resource("dynamodb", **kwargs).Table(_SIGNAL_PERFORMANCE_TABLE_NAME)

    items: list[dict[str, Any]] = []
    scan_kwargs: dict[str, Any] = {}
    while True:
        try:
            result = table.scan(**scan_kwargs)
        except ClientError as exc:
            code = str((exc.response or {}).get("Error", {}).get("Code", ""))
            if code in {"ResourceNotFoundException", "ValidationException"}:
                return []
            raise
        batch = result.get("Items") if isinstance(result, dict) else None
        if isinstance(batch, list):
            items.extend(x for x in batch if isinstance(x, dict))
        lek = result.get("LastEvaluatedKey") if isinstance(result, dict) else None
        if not lek:
            break
        scan_kwargs["ExclusiveStartKey"] = lek
    return items


def _load_recent_signal_performance(limit: int) -> list[dict[str, Any]]:
    items = _scan_signal_performance_items()
    now = datetime.now(timezone.utc)
    ordered = sorted(items, key=lambda x: str(x.get("timestamp_iso") or x.get("timestamp") or ""), reverse=True)
    return [_public_signal_shape(item, now) for item in ordered[:limit]]


def public_recent_signals_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = event
    _ = context
    try:
        return ok(_load_recent_signal_performance(limit=10))
    except Exception as exc:
        return internal_error(str(exc))


def public_performance_summary_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = event
    _ = context
    try:
        signals = [_public_signal_shape(item, datetime.now(timezone.utc)) for item in _scan_signal_performance_items()]
        launch_date = _LAUNCH_DATE.isoformat()
        if not signals:
            return ok(
                {
                    "total_signals_tracked": 0,
                    "signals_evaluated": 0,
                    "win_count": 0,
                    "loss_count": 0,
                    "neutral_count": 0,
                    "directional_accuracy_percent": 0.0,
                    "launch_date": launch_date,
                    "date_range_days": 0,
                    "disclaimer": API_SIGNAL_DISCLAIMER,
                }
            )

        wins = sum(1 for s in signals if s["outcome"] == "win")
        losses = sum(1 for s in signals if s["outcome"] == "loss")
        neutral = sum(1 for s in signals if s["outcome"] == "neutral")
        resolved = wins + losses + neutral
        win_rate = round((wins / resolved) * 100.0, 1) if resolved > 0 else 0.0

        days = max(0, (datetime.now(timezone.utc).date() - _LAUNCH_DATE).days)

        return ok(
            {
                "total_signals_tracked": len(signals),
                "signals_evaluated": resolved,
                "win_count": wins,
                "loss_count": losses,
                "neutral_count": neutral,
                "directional_accuracy_percent": win_rate,
                "launch_date": launch_date,
                "date_range_days": days,
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )
    except Exception as exc:
        return internal_error(str(exc))

