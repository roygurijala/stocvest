"""Opportunity Desk HTTP handlers."""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.api.response import bad_request, ok, too_many_requests, unauthorized
from stocvest.api.services.opportunity_desk.batch import opportunity_desk_redis_key
from stocvest.api.services.opportunity_desk.funnel import (
    OpportunityDeskFunnelConfig,
    _rejection_reason_for_snapshot,
    run_snapshot_funnel,
)
from stocvest.api.services.opportunity_desk.snapshot_load import load_us_equity_snapshots_for_funnel
from stocvest.api.services.opportunity_desk.desk_refresh import (
    DeskRefreshCooldownError,
    run_manual_desk_refresh,
)
from stocvest.api.shared import build_request_context
from stocvest.api.types import LambdaContext, LambdaEvent
from stocvest.data import PolygonClient
from stocvest.data.corporate_actions import recent_split_symbols, symbols_with_frequent_reverse_splits
from stocvest.data.dashboard_cache import read_dashboard_cache
from stocvest.signals.day_trading_scanner import dynamic_gap_candidates_from_snapshots_with_stats
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

DeskMode = Literal["swing", "day"]


def _parse_desk_mode(event: LambdaEvent) -> DeskMode | None:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        query = {}
    raw = str(query.get("mode") or "swing").strip().lower()
    if raw in ("day", "intraday", "real"):
        return "day"
    if raw in ("swing", "swing_daily"):
        return "swing"
    return None


def _parse_why_symbol(event: LambdaEvent) -> str | None:
    query = event.get("queryStringParameters") or {}
    if not isinstance(query, dict):
        return None
    raw = str(query.get("why_symbol") or "").strip().upper()
    if not raw:
        return None
    if not (1 <= len(raw) <= 15):
        return None
    if not raw.replace(".", "").replace("-", "").isalnum():
        return None
    return raw


def _humanize_reason_code(reason: str) -> str:
    volume_day = reason.strip().lower()
    if volume_day.startswith("day_volume_below_"):
        try:
            n = int(volume_day.removeprefix("day_volume_below_"))
            return f"Day volume below {n:,} shares minimum."
        except Exception:
            return "Day volume below minimum."
    if volume_day.startswith("prev_day_volume_below_"):
        try:
            n = int(volume_day.removeprefix("prev_day_volume_below_"))
            return f"Average daily volume below {n:,} shares minimum."
        except Exception:
            return "Average daily volume below minimum."
    if volume_day.startswith("gap_below_") and volume_day.endswith("pct"):
        pct = volume_day.removeprefix("gap_below_").removesuffix("pct")
        return f"Gap magnitude below {pct}% threshold."
    if volume_day == "invalid_prev_close":
        return "Previous close is invalid or unavailable."
    if volume_day == "missing_session_price":
        return "Session price is unavailable."
    if volume_day == "corporate_action_artifact":
        return "Likely split/corporate-action distortion."
    if volume_day == "price_below_5":
        return "Trade price below $5 minimum."
    return reason.replace("_", " ")


def _funnel_config_from_settings() -> OpportunityDeskFunnelConfig:
    try:
        settings = get_settings()
        return OpportunityDeskFunnelConfig(
            survivor_limit=max(1, int(settings.opportunity_desk_survivor_limit)),
            adaptive_survivor_limit=bool(settings.opportunity_desk_adaptive_survivor_limit),
            elevated_survivor_limit=max(1, int(settings.opportunity_desk_elevated_survivor_limit)),
            elevated_breadth_trigger=max(1, int(settings.opportunity_desk_elevated_breadth_trigger)),
        )
    except Exception:
        return OpportunityDeskFunnelConfig()


async def _desk_symbol_diagnostic_async(symbol: str) -> dict[str, Any]:
    cfg = _funnel_config_from_settings()
    snapshots, snapshot_source = await load_us_equity_snapshots_for_funnel()
    if not snapshots:
        return {
            "symbol": symbol,
            "stage": "snapshot_unavailable",
            "reason_code": "snapshot_unavailable",
            "reason": "Snapshot feed unavailable right now.",
            "snapshot_source": snapshot_source,
        }
    recent_splits: frozenset[str] = frozenset()
    frequent_reverse: frozenset[str] = frozenset()
    try:
        settings = get_settings()
        async with PolygonClient(api_key=settings.polygon_api_key) as client:
            recent_splits, frequent_reverse = await asyncio.gather(
                recent_split_symbols(client),
                symbols_with_frequent_reverse_splits(client),
            )
    except Exception as exc:  # noqa: BLE001
        _LOG.warning("desk why-missing split metadata unavailable: %s", str(exc)[:200])

    funnel = run_snapshot_funnel(
        snapshots,
        cfg,
        recent_split_symbols=recent_splits,
        frequent_reverse_split_symbols=frequent_reverse,
    )
    snap_by_symbol = {str(s.symbol or "").strip().upper(): s for s in snapshots if s.symbol}
    snap = snap_by_symbol.get(symbol)
    if snap is None:
        return {
            "symbol": symbol,
            "stage": "not_in_snapshot_feed",
            "reason_code": "not_in_snapshot_feed",
            "reason": "Symbol not present in current snapshot feed.",
            "snapshot_source": snapshot_source,
            "scanned_snapshot_count": len(snapshots),
        }

    reason_code = _rejection_reason_for_snapshot(
        snap,
        cfg=cfg,
        recent_split_symbols=recent_splits,
        frequent_reverse_split_symbols=frequent_reverse,
    )
    if reason_code is not None:
        return {
            "symbol": symbol,
            "stage": "eligibility_gate",
            "reason_code": reason_code,
            "reason": _humanize_reason_code(reason_code),
            "snapshot_source": snapshot_source,
            "scanned_snapshot_count": len(snapshots),
            "eligible_symbol_count": funnel.eligible_symbol_count,
            "survivor_limit_used": funnel.survivor_limit_used,
        }

    scan_all = dynamic_gap_candidates_from_snapshots_with_stats(
        snapshots,
        limit=max(1, len(snapshots)),
        min_abs_gap_percent=cfg.min_abs_gap_percent,
        min_day_volume=cfg.min_day_volume,
        min_trade_price=cfg.min_trade_price,
        recent_split_symbols=recent_splits,
        frequent_reverse_split_symbols=frequent_reverse,
    )
    rank_position: int | None = None
    rank_score: float | None = None
    for idx, cand in enumerate(scan_all.candidates, start=1):
        if cand.symbol.strip().upper() != symbol:
            continue
        rank_position = idx
        rank_score = float(cand.rank_score)
        break
    if rank_position is None:
        return {
            "symbol": symbol,
            "stage": "diagnostic_incomplete",
            "reason_code": "diagnostic_incomplete",
            "reason": "Symbol passed baseline gates but ranking detail was unavailable.",
            "snapshot_source": snapshot_source,
            "eligible_symbol_count": funnel.eligible_symbol_count,
            "survivor_limit_used": funnel.survivor_limit_used,
        }
    if rank_position > funnel.survivor_limit_used:
        return {
            "symbol": symbol,
            "stage": "ranked_out",
            "reason_code": "ranked_below_survivor_cutoff",
            "reason": (
                f"Passed baseline filters but ranked #{rank_position}, below this cycle's survivor cutoff "
                f"of top {funnel.survivor_limit_used}."
            ),
            "rank_position": rank_position,
            "rank_score": rank_score,
            "snapshot_source": snapshot_source,
            "eligible_symbol_count": funnel.eligible_symbol_count,
            "survivor_limit_used": funnel.survivor_limit_used,
        }
    return {
        "symbol": symbol,
        "stage": "survivor_pool",
        "reason_code": "survivor_pool",
        "reason": (
            f"Passed baseline filters and ranked #{rank_position} within survivor cutoff; "
            "if not visible, it was filtered in later setup/composite stages."
        ),
        "rank_position": rank_position,
        "rank_score": rank_score,
        "snapshot_source": snapshot_source,
        "eligible_symbol_count": funnel.eligible_symbol_count,
        "survivor_limit_used": funnel.survivor_limit_used,
    }


def desk_today_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """
    GET ``/v1/desk/today`` — cached Opportunity Desk snapshot (discovery + movers radar).

    Query: ``mode=swing|day`` (default swing). Reads Upstash envelope written by scheduled batch.
    """
    _ = context
    mode = _parse_desk_mode(event)
    if mode is None:
        return bad_request("Invalid mode. Use swing or day.")
    why_symbol = _parse_why_symbol(event)
    why_missing: dict[str, Any] | None = None
    if why_symbol:
        try:
            why_missing = asyncio.run(_desk_symbol_diagnostic_async(why_symbol))
        except Exception as exc:  # noqa: BLE001
            _LOG.warning("desk_today why_missing_failed symbol=%s err=%s", why_symbol, str(exc)[:200])
            why_missing = {
                "symbol": why_symbol,
                "stage": "diagnostic_unavailable",
                "reason_code": "diagnostic_unavailable",
                "reason": "Could not compute symbol diagnostic right now. Try again shortly.",
            }

    key = opportunity_desk_redis_key(mode)
    envelope = read_dashboard_cache(key)
    if envelope is None:
        return ok(
            {
                "mode": mode,
                "source": "cache_miss",
                "envelope": None,
                "data": None,
                "why_missing": why_missing,
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )

    data = envelope.get("data") if isinstance(envelope.get("data"), dict) else None
    return ok(
        {
            "mode": mode,
            "source": "cache",
            "envelope": envelope,
            "data": data,
            "why_missing": why_missing,
            "disclaimer": API_SIGNAL_DISCLAIMER,
        }
    )


def desk_refresh_handler(event: LambdaEvent, context: LambdaContext) -> dict[str, Any]:
    """
    POST ``/v1/desk/refresh`` — manual Tier B + C batch (scanner Lambda, 120s timeout).

    Per-user cooldown (5 min) via Upstash. Requires authenticated ``sub``.
    """
    _ = context
    rc = build_request_context(event)
    if not rc.user_id:
        return unauthorized("Sign in to refresh the opportunity desk.")

    try:
        result = run_manual_desk_refresh(rc.user_id)
        return ok({**result, "disclaimer": API_SIGNAL_DISCLAIMER})
    except DeskRefreshCooldownError as exc:
        return too_many_requests(
            "Refresh desk is on cooldown. Try again shortly.",
            retry_after_seconds=exc.retry_after_seconds,
        )
    except Exception as exc:  # noqa: BLE001
        _LOG.exception("desk_refresh_failed user=%s", rc.user_id)
        return ok(
            {
                "status": "error",
                "message": str(exc)[:200],
                "disclaimer": API_SIGNAL_DISCLAIMER,
            }
        )