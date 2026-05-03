"""Market session context for swing composite insufficient-data responses."""

from __future__ import annotations

import asyncio
from datetime import datetime, time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from stocvest.data import PolygonClient
from stocvest.data.models import MarketStatus
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_ET = ZoneInfo("America/New_York")


def us_equity_exchange_raw(status: MarketStatus) -> str:
    ex = status.exchanges or {}
    raw = ex.get("NYSE") or ex.get("nyse") or ex.get("Nasdaq") or ex.get("NASDAQ") or ""
    return str(raw).strip().lower().replace(" ", "_").replace("-", "_")


def classify_market_session(nyse_raw: str) -> tuple[str, bool]:
    """
    Return (market_session, is_market_open).
    ``is_market_open`` is True only during regular NYSE hours (Polygon ``open``).
    """
    r = nyse_raw
    if r == "open":
        return "regular", True
    if r in {"closed", ""}:
        return "closed", False
    if "pre" in r or "early" in r:
        return "pre_market", False
    if "after" in r or "late" in r:
        return "after_hours", False
    if r in {"extended_hours", "extended"}:
        return "after_hours", False
    return "closed", False


def next_regular_open_et(reference_utc: datetime) -> datetime:
    """First weekday 09:30 America/New_York strictly after ``reference_utc``."""
    t = reference_utc.astimezone(_ET)
    for i in range(14):
        day = (t + timedelta(days=i)).date()
        wd = day.weekday()
        if wd >= 5:
            continue
        open_moment = datetime.combine(day, time(9, 30), tzinfo=_ET)
        if open_moment > t:
            return open_moment
    return datetime.combine(t.date(), time(9, 30), tzinfo=_ET)


def format_next_open_label(open_moment: datetime) -> str:
    h12 = open_moment.hour % 12 or 12
    ampm = open_moment.strftime("%p")
    dayname = open_moment.strftime("%A")
    return f"{dayname} {h12}:{open_moment.minute:02d} {ampm} ET"


def market_status_payload_from_model(status: MarketStatus) -> dict[str, Any]:
    ny = us_equity_exchange_raw(status)
    session, is_open = classify_market_session(ny)
    ref = status.server_time
    if ref.tzinfo is None:
        ref = ref.replace(tzinfo=timezone.utc)
    next_open = format_next_open_label(next_regular_open_et(ref))
    if is_open:
        next_open_val: str | None = None
    else:
        next_open_val = next_open
    return {
        "is_market_open": is_open,
        "next_open": next_open_val,
        "market_session": session,
    }


def fetch_composite_market_status_payload_sync(
    *,
    client_factory: type[PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    async def _run() -> dict[str, Any]:
        settings = get_settings()
        async with client_factory(api_key=settings.polygon_api_key) as client:
            ms = await client.get_market_status()
        return market_status_payload_from_model(ms)

    try:
        return asyncio.run(_run())
    except Exception as exc:
        _LOG.warning("composite market status fallback: %s", exc)
        ref = datetime.now(timezone.utc)
        return {
            "is_market_open": False,
            "next_open": format_next_open_label(next_regular_open_et(ref)),
            "market_session": "closed",
        }
