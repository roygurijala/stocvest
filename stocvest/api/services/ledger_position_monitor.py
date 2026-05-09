"""Rule-ordered exits for open validation ledger rows (SignalHistory).

Swing: evaluate after each RTH close (structure, regime veto, max hold). First matching rule wins.
Day: evaluate during RTH (VWAP violation, flatten cutoff, session close). First matching rule wins.

Exit prices use Polygon snapshot (last / day close) as documented tradable references.
Full composite “decision downgrade” is not recomputed here (cost/latency); structure, regime,
session clock, and VWAP rules are enforced.
"""

from __future__ import annotations

import asyncio
from datetime import time as time_type
from datetime import datetime, timezone
from typing import Any

from stocvest.api.services.validation_timing import (
    MAX_HOLD_CALENDAR_DAYS_SWING,
    MIN_SESSION_VOLUME_SHARES_DAY_LEDGER,
    is_at_or_after_day_flatten_cutoff_et,
    is_day_monitor_active_session_et,
    is_swing_monitor_evaluation_window_et,
    now_et,
)
from stocvest.config.parameter_store import ParameterStore
from stocvest.data.polygon_client import PolygonClient
from stocvest.signals.macro_analyzer import MacroAnalyzer
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_VWAP_REL_EPS = 1e-3


async def _current_macro_regime(client: PolygonClient) -> str:
    from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback

    spy_r, qqq_r, vix_r = await asyncio.gather(
        client.get_snapshot("SPY"),
        client.get_snapshot("QQQ"),
        get_vix_snapshot_with_fallback(client),
        return_exceptions=True,
    )
    spy = spy_r if not isinstance(spy_r, BaseException) else None
    qqq = qqq_r if not isinstance(qqq_r, BaseException) else None
    vix = vix_r if not isinstance(vix_r, BaseException) else None
    params = ParameterStore.get_parameters_sync().macro
    mac = MacroAnalyzer().analyze(spy, qqq, vix, [], params)
    return str(mac.market_regime or "neutral").strip().lower()


def _exit_px_from_snapshot(snap: Any) -> float | None:
    if snap is None:
        return None
    dc = getattr(snap, "day_close", None)
    lp = getattr(snap, "last_trade_price", None)
    if isinstance(dc, (int, float)) and float(dc) > 0:
        return float(dc)
    if isinstance(lp, (int, float)) and float(lp) > 0:
        return float(lp)
    return None


def _structure_invalidated(direction: str, stop: float, close_px: float) -> bool:
    d = direction.lower()
    if d == "bullish":
        return close_px <= stop
    if d == "bearish":
        return close_px >= stop
    return False


def _vwap_violated(direction: str, vwap: float, last_px: float) -> bool:
    if vwap <= 0 or last_px <= 0:
        return False
    d = direction.lower()
    if d == "bullish":
        return last_px < vwap * (1.0 - _VWAP_REL_EPS)
    if d == "bearish":
        return last_px > vwap * (1.0 + _VWAP_REL_EPS)
    return False


async def run_ledger_position_monitor(client: PolygonClient, recorder: Any) -> dict[str, int]:
    """Process open validation rows; returns counts."""
    now = datetime.now(timezone.utc)
    counts: dict[str, int] = {"swing_closed": 0, "day_closed": 0, "skipped": 0, "errors": 0}

    try:
        regime_current = await _current_macro_regime(client)
    except Exception as exc:
        _LOG.warning("ledger monitor: macro regime fetch failed: %s", exc)
        regime_current = "neutral"

    try:
        open_rows = recorder.iter_open_validation_records()
    except Exception as exc:
        _LOG.exception("iter_open_validation_records: %s", exc)
        return counts

    syms = sorted({r.symbol.upper() for r in open_rows})
    snaps: dict[str, Any] = {}
    if syms:
        try:
            snaps = await client.get_snapshots_many(syms, chunk_size=80)
        except Exception as exc:
            _LOG.warning("batch snapshots failed: %s", exc)

    for rec in open_rows:
        sym = rec.symbol.upper()
        snap = snaps.get(sym)
        try:
            if rec.mode == "swing":
                if not is_swing_monitor_evaluation_window_et(now):
                    counts["skipped"] += 1
                    continue
                px_close = _exit_px_from_snapshot(snap)
                if px_close is None:
                    counts["errors"] += 1
                    continue

                exit_rule: str | None = None
                exit_reason: str | None = None
                mre: str | None = None

                stop = rec.stop_level
                if stop is not None and _structure_invalidated(rec.direction, float(stop), px_close):
                    exit_rule = "swing_structure_invalidated"
                    exit_reason = "Reference stop / structure invalidated vs session close"
                elif (
                    regime_current == "avoid"
                    and str(rec.regime_label_at_entry or "").strip().lower() != "avoid"
                ):
                    exit_rule = "swing_regime_veto"
                    exit_reason = "Macro regime veto (current = avoid)"
                    mre = regime_current
                else:
                    gen_d = now_et(rec.generated_at).date()
                    days_open = (now_et(now).date() - gen_d).days
                    if days_open >= MAX_HOLD_CALENDAR_DAYS_SWING:
                        exit_rule = "swing_max_hold_days"
                        exit_reason = f"Max hold {MAX_HOLD_CALENDAR_DAYS_SWING} calendar days reached"

                if exit_rule and exit_reason:
                    ok = recorder.close_validation_position(
                        signal_id=rec.signal_id,
                        exit_price=px_close,
                        exit_rule=exit_rule,
                        exit_reason=exit_reason,
                        mode="swing",
                        now=now,
                        market_regime_exit=mre,
                    )
                    if ok:
                        counts["swing_closed"] += 1
                    else:
                        counts["errors"] += 1
                else:
                    counts["skipped"] += 1

            elif rec.mode == "day":
                if not is_day_monitor_active_session_et(now):
                    counts["skipped"] += 1
                    continue
                if snap is None:
                    counts["errors"] += 1
                    continue
                vol = float(snap.day_volume or 0.0)
                if vol < MIN_SESSION_VOLUME_SHARES_DAY_LEDGER:
                    counts["skipped"] += 1
                    continue

                last_px = float(snap.last_trade_price) if snap.last_trade_price else None
                vwap = float(snap.day_vwap) if snap.day_vwap else None

                exit_rule_d: str | None = None
                exit_reason_d: str | None = None
                px: float | None = None

                if (
                    last_px is not None
                    and vwap is not None
                    and last_px > 0
                    and _vwap_violated(rec.direction, vwap, last_px)
                ):
                    px = last_px
                    exit_rule_d = "day_vwap_violation"
                    exit_reason_d = "Price vs session VWAP (rule-based intraday exit)"
                elif is_at_or_after_day_flatten_cutoff_et(now) and now_et(now).time() < time_type(16, 0):
                    if last_px is not None and last_px > 0:
                        px = last_px
                        exit_rule_d = "day_time_flatten"
                        exit_reason_d = "Time-of-day flatten before regular close"
                elif now_et(now).time() >= time_type(16, 0):
                    pxc = _exit_px_from_snapshot(snap)
                    if pxc is not None:
                        px = pxc
                        exit_rule_d = "day_rth_session_close"
                        exit_reason_d = "Regular trading hours close (no overnight carry)"

                if px is not None and exit_rule_d and exit_reason_d:
                    ok = recorder.close_validation_position(
                        signal_id=rec.signal_id,
                        exit_price=px,
                        exit_rule=exit_rule_d,
                        exit_reason=exit_reason_d,
                        mode="day",
                        now=now,
                    )
                    if ok:
                        counts["day_closed"] += 1
                    else:
                        counts["errors"] += 1
                else:
                    counts["skipped"] += 1
            else:
                counts["skipped"] += 1
        except Exception as exc:
            _LOG.warning("ledger monitor row failed signal_id=%s: %s", rec.signal_id, exc)
            counts["errors"] += 1

    return counts
