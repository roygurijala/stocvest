"""
Intraday market pulse snapshot (SPY / QQQ / VIX + regime) → Upstash dashboard cache.

Scheduled every minute during NY session hours; no-ops outside 9:30–16:00 ET weekdays.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from stocvest.api.services.market_environment import (
    build_market_environment_policy,
    fetch_vix_change_5d_pct,
    read_environment_tier_state,
    write_environment_tier_state,
)
from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.data import PolygonClient
from stocvest.data.dashboard_cache import DashboardKeys, write_dashboard_cache
from stocvest.data.models import Snapshot
from stocvest.data.vix_snapshot import vix_level_from_snapshot
from stocvest.signals.morning_brief import infer_regime
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)


def _within_equity_rth_et(now: datetime | None = None) -> bool:
    from zoneinfo import ZoneInfo

    et = ZoneInfo("America/New_York")
    n = now or datetime.now(et)
    if n.weekday() >= 5:
        return False
    minutes = n.hour * 60 + n.minute
    return 9 * 60 + 30 <= minutes < 16 * 60


def _session_pct(s: Snapshot | None) -> float | None:
    if s is None:
        return None
    if s.pre_market_change_percent is not None:
        return float(s.pre_market_change_percent)
    if s.change_percent is not None:
        return float(s.change_percent)
    return None


async def refresh_market_pulse() -> dict[str, Any]:
    if not _within_equity_rth_et():
        _LOG.info("market_pulse_refresher skip reason=outside_rth (NY weekday 09:30-16:00 ET only)")
        return {"statusCode": 200, "skipped": True, "reason": "outside_rth"}
    settings = get_settings()
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        snaps = await client.get_snapshots(["SPY", "QQQ"])
        spy = snaps.get("SPY") or snaps.get("spy")
        qqq = snaps.get("QQQ") or snaps.get("qqq")
        vix_snap = await get_vix_snapshot_with_fallback(client)
        spy_pct = _session_pct(spy)
        qqq_pct = _session_pct(qqq)
        vix_level = vix_level_from_snapshot(vix_snap)
        vix_chg = (
            float(vix_snap.change_percent)
            if vix_snap is not None and vix_snap.change_percent is not None
            else None
        )
        regime = infer_regime(spy_pct, qqq_pct, vix_level)
        vix_chg_5d = await fetch_vix_change_5d_pct(current_vix=vix_level)
        state = read_environment_tier_state()
        prev_raw = str(state.get("environment_tier") or "").strip().lower() if state else ""
        previous = prev_raw if prev_raw in ("normal", "elevated", "stressed", "crisis") else None
        env_swing = build_market_environment_policy(
            mode="swing",
            vix_level=vix_level,
            vix_change_pct=vix_chg,
            vix_change_5d_pct=vix_chg_5d,
            macro_regime=regime,
            previous_environment_tier=previous,  # type: ignore[arg-type]
            persist_tier_state=True,
        )
        env_day = build_market_environment_policy(
            mode="day",
            vix_level=vix_level,
            vix_change_pct=vix_chg,
            vix_change_5d_pct=vix_chg_5d,
            macro_regime=regime,
            previous_environment_tier=previous,  # type: ignore[arg-type]
            persist_tier_state=False,
        )
        write_environment_tier_state(
            environment_tier=str(env_swing.get("environment_tier") or "normal"),
            vix_level=vix_level,
        )
        payload = {
            "spy_pct": spy_pct,
            "qqq_pct": qqq_pct,
            "vix_level": vix_level,
            "vix_change_pct": vix_chg,
            "regime": regime,
            "market_environment": env_swing,
            "market_environment_swing": env_swing,
            "market_environment_day": env_day,
        }
    ok = write_dashboard_cache(
        DashboardKeys.MARKET_PULSE,
        payload,
        "market_pulse",
        "day",
    )
    _LOG.info("market_pulse_refresher written=%s regime=%s", ok, regime)
    return {"statusCode": 200, "written": ok, "regime": regime}


def handler(event: Any, context: Any) -> dict[str, Any]:
    _ = (event, context)
    return asyncio.run(refresh_market_pulse())
