"""
Intraday market pulse snapshot (SPY / QQQ / VIX + regime) → Upstash dashboard cache.

Scheduled every minute during NY session hours; no-ops outside 9:30–16:00 ET weekdays.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import Any

from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.data import PolygonClient
from stocvest.data.dashboard_cache import DashboardKeys, write_dashboard_cache
from stocvest.data.models import Snapshot
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


def _vix_level(s: Snapshot | None) -> float | None:
    """Level for regime + cache: prefer last print; then Polygon session close on index snapshots."""
    if s is None:
        return None
    lp = s.last_trade_price
    if isinstance(lp, (int, float)) and lp == lp and lp > 0:
        return float(lp)
    dc = s.day_close
    if isinstance(dc, (int, float)) and dc == dc and dc > 0:
        return float(dc)
    return None


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
        vix_level = _vix_level(vix_snap)
        regime = infer_regime(spy_pct, qqq_pct, vix_level)
        payload = {
            "spy_pct": spy_pct,
            "qqq_pct": qqq_pct,
            "vix_level": vix_level,
            "regime": regime,
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
