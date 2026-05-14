"""Polygon-backed gap intel snapshot body (shared by GET, POST batch, cache warmer)."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timezone
from typing import Any, Literal

from zoneinfo import ZoneInfo

from stocvest.api.legal_copy import API_SIGNAL_DISCLAIMER
from stocvest.data.polygon_client import PolygonClient, PolygonError, Timeframe
from stocvest.signals.gap_intel_snapshot import build_gap_intel_snapshot
from stocvest.utils.config import get_settings


async def compute_gap_intel_body(
    symbol: str,
    trading_mode: Literal["day", "swing"],
    *,
    now_utc: datetime | None = None,
) -> dict[str, Any]:
    """Build the JSON-serializable gap-intel snapshot dict (includes ``disclaimer``)."""
    settings = get_settings()
    symbol_u = symbol.strip().upper()
    nu = now_utc or datetime.now(tz=timezone.utc)
    async with PolygonClient(api_key=settings.polygon_api_key) as client:
        snap = await client.get_snapshot(symbol_u)
        try:
            mkt = await client.get_market_status()
        except Exception:  # noqa: BLE001
            mkt = None
        et_now = nu.astimezone(ZoneInfo("America/New_York"))
        session_d: date = et_now.date()
        bars = await client.get_bars(
            symbol_u,
            Timeframe.MIN_1,
            from_date=session_d,
            to_date=session_d,
            limit=500,
        )
        prev_bar = await client.get_previous_close(symbol_u)
    body = build_gap_intel_snapshot(
        symbol=symbol_u,
        snapshot=snap,
        bars_1m=bars,
        market_status=mkt,
        trading_mode=trading_mode,
        now_utc=nu,
        prev_session_bar=prev_bar,
    )
    body["disclaimer"] = API_SIGNAL_DISCLAIMER
    return body


def compute_gap_intel_body_sync(symbol: str, trading_mode: Literal["day", "swing"]) -> dict[str, Any]:
    """Sync wrapper for scheduled warmer / tests (one event loop per call)."""
    return asyncio.run(compute_gap_intel_body(symbol, trading_mode))
