"""
Dashboard cache writer with mandatory versioning (Upstash Redis REST).

Every cached object is wrapped in an envelope with state_version, computed_at,
market_date, ttl_seconds, and data. SSE / Edge consumers treat Redis as source
of truth; live hints use a short-lived key (REST has no blocking subscribe).
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from typing import Any
from zoneinfo import ZoneInfo

from stocvest.utils.config import get_settings

_LOG = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

# Hint key polled by Vercel Edge SSE — publishers SET this; clients never treat payload as authoritative.
SIGNALS_LIVE_HINT_KEY = "stocvest:signals:live_hint"


class DashboardKeys:
    TOP_SIGNALS_SWING = "stocvest:dashboard:top_signals_swing"
    TOP_SIGNALS_DAY = "stocvest:dashboard:top_signals_day"
    MARKET_PULSE = "stocvest:dashboard:market_pulse"
    SECTOR_ROTATION = "stocvest:dashboard:sector_rotation"
    UPCOMING_EVENTS = "stocvest:dashboard:upcoming_events"
    ACTIVE_POSITIONS = "stocvest:dashboard:active_positions"
    GEO_THEMES = "stocvest:geo_themes:today"

    LAYER_HEALTH = "stocvest:ops:layer_health"
    COMPUTE_LOG = "stocvest:ops:compute_log"


def upstash_configured() -> bool:
    s = get_settings()
    return bool(str(s.upstash_redis_rest_url or "").strip() and str(s.upstash_redis_rest_token or "").strip())


def get_upstash():  # type: ignore[no-untyped-def]
    """Upstash Redis client (HTTP). Caller must check :func:`upstash_configured` first."""
    from upstash_redis import Redis

    s = get_settings()
    return Redis(
        url=str(s.upstash_redis_rest_url).strip(),
        token=str(s.upstash_redis_rest_token).strip(),
        allow_telemetry=False,
    )


def make_state_version(mode: str = "swing") -> str:
    """swing → swing_YYYY_MM_DD; day → day_YYYY_MM_DD_HH_MM (ET wall clock)."""
    now = datetime.now(ET)
    date_str = now.strftime("%Y_%m_%d")
    if mode == "day":
        time_str = now.strftime("%H_%M")
        return f"day_{date_str}_{time_str}"
    return f"swing_{date_str}"


def get_market_ttl(key_type: str) -> int:
    now = datetime.now(ET)
    is_market_hours = (
        now.weekday() < 5
        and (now.hour > 9 or (now.hour == 9 and now.minute >= 30))
        and now.hour < 16
    )

    if not is_market_hours:
        return {
            "market_pulse": 3600,
            "day_signals": 86400,
            "swing_signals": 86400,
            "sector_rotation": 86400,
            "upcoming_events": 86400,
            "active_positions": 86400,
            "geo_themes": 86400,
            "evidence": 300,
        }.get(key_type, 86400)

    return {
        "market_pulse": 60,
        "day_signals": 300,
        "swing_signals": 86400,
        "sector_rotation": 300,
        "upcoming_events": 86400,
        "active_positions": 300,
        "geo_themes": 86400,
        "evidence": 300,
    }.get(key_type, 300)


def write_dashboard_cache(
    key: str,
    data: dict[str, Any],
    key_type: str,
    mode: str = "swing",
) -> bool:
    ttl = get_market_ttl(key_type)
    market_d = datetime.now(ET).date().isoformat()
    envelope = {
        "state_version": make_state_version(mode),
        "computed_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "market_date": market_d,
        "ttl_seconds": ttl,
        "data": data,
    }
    if not upstash_configured():
        _LOG.debug("upstash_skip_write key=%s (not configured)", key)
        return False
    try:
        r = get_upstash()
        r.set(key, json.dumps(envelope, default=str), ex=ttl)
        _log_compute_success(key, ttl, mode)
        return True
    except Exception as exc:
        _LOG.error("upstash_write_failed key=%s error=%s", key, str(exc))
        _log_compute_failure(key, str(exc))
        return False


def read_dashboard_cache(key: str) -> dict[str, Any] | None:
    if not upstash_configured():
        return None
    try:
        r = get_upstash()
        raw = r.get(key)
        if raw is None:
            return None
        if isinstance(raw, dict):
            return raw
        return json.loads(str(raw))
    except Exception as exc:
        _LOG.warning("upstash_read_failed key=%s error=%s", key, str(exc))
    return None


def publish_signals_live_hint(state_version: str) -> None:
    """Best-effort: Edge SSE polls this key; not authoritative."""
    if not upstash_configured() or not str(state_version or "").strip():
        return
    try:
        r = get_upstash()
        r.set(SIGNALS_LIVE_HINT_KEY, str(state_version).strip(), ex=120)
    except Exception:
        pass


def evidence_cache_key(symbol: str, mode: str) -> str:
    sym = str(symbol or "").strip().upper()
    m = "day" if str(mode or "").strip().lower() in ("day", "intraday", "real") else "swing"
    return f"stocvest:evidence:{sym}:{m}"


def evidence_rate_limit_exceeded(user_id: str | None) -> bool:
    """Return True if user exceeded evidence requests in the rolling window."""
    uid = str(user_id or "anon").strip() or "anon"
    if not upstash_configured():
        return False
    try:
        r = get_upstash()
        rate_key = f"stocvest:rate:{uid}:evidence"
        n = int(r.incr(rate_key) or 0)
        if n == 1:
            r.expire(rate_key, 60)
        return n > 10
    except Exception:
        return False


def _log_compute_success(key: str, ttl: int, mode: str) -> None:
    try:
        r = get_upstash()
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        r.hset(
            DashboardKeys.LAYER_HEALTH,
            values={
                f"{key}:last_success": now,
                f"{key}:ttl": str(ttl),
                f"{key}:mode": mode,
                f"{key}:status": "ok",
            },
        )
    except Exception:
        pass


def _log_compute_failure(key: str, error: str) -> None:
    try:
        r = get_upstash()
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        r.hset(
            DashboardKeys.LAYER_HEALTH,
            values={
                f"{key}:last_failure": now,
                f"{key}:status": "error",
                f"{key}:error": error[:200],
            },
        )
    except Exception:
        pass
