"""HTTP handlers for the model portfolio (signal tracking / notional validation)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, ok, unauthorized
from stocvest.api.services.portfolio_recorder import ExitReason, PortfolioRecorder, get_portfolio_recorder
from stocvest.api.services.signal_analysis import analysis_authorized
from stocvest.api.shared import build_request_context, parse_json_body
from stocvest.api.types import LambdaContext, LambdaEvent


def _parse_exit_reason(raw: str) -> ExitReason | None:
    r = (raw or "").strip().lower()
    for er in ExitReason:
        if er.value == r:
            return er
    return None


def _float_item(v: Any, default: float = 0.0) -> float:
    if v is None:
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _summary_body(rec: PortfolioRecorder) -> dict[str, Any]:
    item = rec.get_summary_item() or {}
    open_n = len(rec.get_open_positions())
    started = str(item.get("started_at") or "")
    return {
        "summary": {
            "portfolio_version": str(item.get("portfolio_version") or "v1"),
            "started_at": started,
            "last_updated": str(item.get("last_updated") or ""),
            "total_positions": int(item.get("total_positions") or 0),
            "open_positions": open_n,
            "closed_positions": int(item.get("closed_positions") or 0),
            "winning_positions": int(item.get("winning_positions") or 0),
            "losing_positions": int(item.get("losing_positions") or 0),
            "breakeven_positions": int(item.get("breakeven_positions") or 0),
            "total_return_dollars": _float_item(item.get("total_return_dollars")),
            "total_return_pct": _float_item(item.get("total_return_pct")),
            "win_rate": _float_item(item.get("win_rate")),
            "avg_win_pct": _float_item(item.get("avg_win_pct")),
            "avg_loss_pct": _float_item(item.get("avg_loss_pct")),
            "profit_factor": _float_item(item.get("profit_factor")),
            "avg_r_multiple": _float_item(item.get("avg_r_multiple")),
            "moderate_win_rate": _float_item(item.get("moderate_win_rate")),
            "strong_win_rate": _float_item(item.get("strong_win_rate")),
            "very_strong_win_rate": _float_item(item.get("very_strong_win_rate")),
            "avg_hold_days": _float_item(item.get("avg_hold_days")),
            "max_drawdown_pct": _float_item(item.get("max_drawdown_pct")),
            "current_drawdown_pct": _float_item(item.get("current_drawdown_pct")),
            "value_history_json": str(item.get("value_history_json") or "[]"),
        },
        "open_positions_count": open_n,
        "disclaimer": API_SIGNAL_DISCLAIMER,
    }


def model_portfolio_summary_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rec = get_portfolio_recorder()
    return ok(_summary_body(rec))


def model_portfolio_open_positions_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rec = get_portfolio_recorder()
    rows = rec.get_open_positions()
    return ok({"positions": rows, "disclaimer": API_SIGNAL_DISCLAIMER})


def model_portfolio_history_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    qs = event.get("queryStringParameters") or {}
    try:
        limit = max(1, min(100, int(str(qs.get("limit") or "20"))))
    except (TypeError, ValueError):
        limit = 20
    try:
        days = max(1, min(365, int(str(qs.get("days") or "90"))))
    except (TypeError, ValueError):
        days = 90
    symbol = str(qs.get("symbol") or "").strip().upper() or None
    rec = get_portfolio_recorder()
    rows = rec.get_closed_positions(limit=limit * 3, symbol=symbol)
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    def _row_ts(r: dict[str, Any]) -> datetime | None:
        raw = r.get("exit_date") or r.get("entry_date")
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return None

    filtered = [r for r in rows if (t := _row_ts(r)) is None or t >= cutoff][:limit]
    return ok({"positions": filtered, "disclaimer": API_SIGNAL_DISCLAIMER})


def model_portfolio_performance_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    qs = event.get("queryStringParameters") or {}
    period = str(qs.get("period") or "30d").strip().lower()
    rec = get_portfolio_recorder()
    rows = rec.get_closed_positions(limit=200, symbol=None)
    now = datetime.now(timezone.utc)
    if period == "7d":
        cutoff = now - timedelta(days=7)
    elif period == "90d":
        cutoff = now - timedelta(days=90)
    elif period == "all":
        cutoff = datetime(1970, 1, 1, tzinfo=timezone.utc)
    else:
        cutoff = now - timedelta(days=30)

    def _exit_ts(r: dict[str, Any]) -> datetime | None:
        raw = r.get("exit_date")
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except ValueError:
            return None

    scoped = [r for r in rows if (t := _exit_ts(r)) is not None and t >= cutoff]
    by_tier: dict[str, dict[str, int]] = {
        "moderate": {"closed": 0, "wins": 0},
        "strong": {"closed": 0, "wins": 0},
        "very_strong": {"closed": 0, "wins": 0},
    }
    combos: dict[str, dict[str, int]] = {}

    for r in scoped:
        score = int(r.get("signal_score") or 0)
        if score >= 90:
            tk = "very_strong"
        elif score >= 80:
            tk = "strong"
        else:
            tk = "moderate"
        by_tier[tk]["closed"] += 1
        oc = str(r.get("outcome") or "").lower()
        if oc == "profit":
            by_tier[tk]["wins"] += 1

        lv_raw = r.get("layer_verdicts_json") or "{}"
        try:
            lv = json.loads(lv_raw) if isinstance(lv_raw, str) else {}
        except json.JSONDecodeError:
            lv = {}
        if isinstance(lv, dict):
            key = "|".join(f"{k}:{v}" for k, v in sorted(lv.items()))
            slot = combos.setdefault(key, {"closed": 0, "wins": 0})
            slot["closed"] += 1
            if oc == "profit":
                slot["wins"] += 1

    def _wr(bucket: dict[str, int]) -> float:
        if not bucket["closed"]:
            return 0.0
        return bucket["wins"] / bucket["closed"]

    return ok(
        {
            "period": period,
            "by_signal_strength": {
                k: {"closed": v["closed"], "wins": v["wins"], "win_rate": round(_wr(v), 4)}
                for k, v in by_tier.items()
            },
            "by_layer_verdict_combo": [
                {"combo": k, "closed": v["closed"], "wins": v["wins"], "win_rate": round(_wr(v), 4)}
                for k, v in sorted(combos.items(), key=lambda x: -x[1]["closed"])[:25]
            ],
            "sample_size": len(scoped),
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
    )


def model_portfolio_open_post_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    headers = event.get("headers") if isinstance(event.get("headers"), dict) else {}
    if not analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return unauthorized("Opening a tracked position requires internal authorization.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    symbol = str(body.get("symbol") or "").strip().upper()
    if not symbol:
        return bad_request("symbol is required.")
    try:
        entry_price = float(body.get("entry_price"))
    except (TypeError, ValueError):
        return bad_request("entry_price must be a number.")
    try:
        signal_score = int(body.get("signal_score"))
    except (TypeError, ValueError):
        return bad_request("signal_score must be an integer.")
    entry_reason = str(body.get("entry_reason") or "Signal tracked.")
    layer_scores = body.get("layer_scores") if isinstance(body.get("layer_scores"), dict) else {}
    layer_verdicts = body.get("layer_verdicts") if isinstance(body.get("layer_verdicts"), dict) else {}
    layer_chips = body.get("layer_chips") if isinstance(body.get("layer_chips"), dict) else {}
    confluence_fired = bool(body.get("confluence_fired"))
    try:
        confluence_score = int(body.get("confluence_score") or 0)
    except (TypeError, ValueError):
        confluence_score = 0
    market_regime = str(body.get("market_regime") or "neutral")
    vix = body.get("vix_at_entry")
    spy = body.get("spy_day_pct")
    sector_etf = str(body.get("sector_etf") or "").strip().upper() or None
    sector_day = body.get("sector_day_pct")
    param_ver = str(body.get("parameter_version") or "1.0.0")

    rec: PortfolioRecorder = get_portfolio_recorder()
    pid = rec.open_position(
        symbol=symbol,
        entry_price=entry_price,
        signal_score=signal_score,
        entry_reason=entry_reason,
        layer_scores=layer_scores,
        layer_verdicts=layer_verdicts,
        layer_chips=layer_chips,
        confluence_fired=confluence_fired,
        confluence_score=confluence_score,
        market_regime=market_regime,
        vix_at_entry=float(vix) if vix is not None else None,
        spy_day_pct=float(spy) if spy is not None else None,
        sector_etf=sector_etf,
        sector_day_pct=float(sector_day) if sector_day is not None else None,
        parameter_version=param_ver,
    )
    if not pid:
        return ok({"accepted": False, "position_id": None, "message": "Position not logged (limits, score, or duplicate)."})
    return ok({"accepted": True, "position_id": pid, "disclaimer": API_SIGNAL_DISCLAIMER})


def model_portfolio_close_post_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    _ = context
    rc = build_request_context(event)
    headers = event.get("headers") if isinstance(event.get("headers"), dict) else {}
    if not analysis_authorized(user_id=rc.user_id, claims=rc.claims, headers=headers):
        return unauthorized("Closing a tracked position requires internal authorization.")
    try:
        body = parse_json_body(event)
    except ValueError as exc:
        return bad_request(str(exc))
    position_id = str(body.get("position_id") or "").strip()
    if not position_id:
        return bad_request("position_id is required.")
    try:
        exit_price = float(body.get("exit_price"))
    except (TypeError, ValueError):
        return bad_request("exit_price must be a number.")
    er = _parse_exit_reason(str(body.get("exit_reason") or ""))
    if er is None:
        return bad_request("exit_reason must be a known exit reason.")
    ok_close = get_portfolio_recorder().close_position(position_id, exit_price, er)
    return ok({"closed": ok_close, "disclaimer": API_SIGNAL_DISCLAIMER})
