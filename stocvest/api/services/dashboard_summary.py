"""Dashboard first-paint aggregate — one Polygon session, parallel fetches (Tier 1.C Phase 2)."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from stocvest.api.services.morning_brief_fetch import get_vix_snapshot_with_fallback
from stocvest.data import PolygonClient, PolygonError, Timeframe
from stocvest.data.models import Bar, EarningsEvent, Snapshot
from stocvest.utils.config import Settings, get_settings

# Keep in lockstep with `frontend/lib/dashboard/dashboard-page-data.ts` symbol lists.
DASHBOARD_TAPE_SYMBOLS: tuple[str, ...] = ("SPY", "QQQ", "IWM", "I:VIX", "^VIX")
DASHBOARD_DAILY_SYMBOLS: tuple[str, ...] = (
    "SPY",
    "QQQ",
    "IWM",
    "XLK",
    "XLC",
    "XLE",
    "XLF",
    "XLY",
)


def _bar_close(bar: Bar | dict[str, Any]) -> float | None:
    if isinstance(bar, Bar):
        c = bar.close
        return float(c) if c is not None and float(c) == float(c) else None
    if isinstance(bar, dict):
        raw = bar.get("close", bar.get("c"))
        if isinstance(raw, (int, float)) and float(raw) == float(raw):
            return float(raw)
        if isinstance(raw, str):
            try:
                n = float(raw)
                return n if n == n else None
            except ValueError:
                return None
    return None


def _closes_from_bars(bars: list[Bar] | list[dict[str, Any]], *, limit: int) -> list[float]:
    out: list[float] = []
    for row in bars:
        c = _bar_close(row)
        if c is not None:
            out.append(c)
    return out[-limit:] if limit > 0 else out


async def _fetch_daily_closes(
    client: PolygonClient,
    symbols: list[str],
    *,
    limit: int,
) -> dict[str, list[float]]:
    if not symbols:
        return {}

    async def one(sym: str) -> tuple[str, list[float]]:
        bars = await client.get_bars(symbol=sym, timeframe=Timeframe.DAY_1, limit=limit)
        return sym, _closes_from_bars(bars, limit=limit)

    pairs = await asyncio.gather(*[one(s) for s in symbols])
    return {sym: closes for sym, closes in pairs if closes}


async def _fetch_sparklines(
    client: PolygonClient,
    symbols: list[str],
    *,
    limit: int,
) -> dict[str, list[float]]:
    if not symbols:
        return {}

    async def one(sym: str) -> tuple[str, list[float]]:
        bars = await client.get_bars(symbol=sym, timeframe=Timeframe.MIN_5, limit=limit)
        return sym, _closes_from_bars(bars, limit=limit)

    pairs = await asyncio.gather(*[one(s) for s in symbols])
    return {sym: closes for sym, closes in pairs if closes}


async def _fetch_earnings(
    client: PolygonClient,
    symbols: list[str],
    *,
    days: int,
) -> dict[str, Any]:
    today = date.today()
    to_date = today + timedelta(days=days)
    recent_from = today - timedelta(days=3)
    rows = await client.get_earnings_calendar(symbols=symbols, from_date=recent_from, to_date=to_date)
    upcoming = [r for r in rows if r.report_date >= today]
    recent = [r for r in rows if r.report_date < today]
    return {
        "symbols": symbols,
        "days": days,
        "upcoming": [x.model_dump(mode="json") for x in upcoming],
        "recent": [x.model_dump(mode="json") for x in recent],
    }


def _snapshot_symbol_is_vix(sym: str) -> bool:
    u = str(sym or "").strip().upper()
    return u in ("I:VIX", "^VIX", "VIX") or u.endswith(":VIX")


def _json_numeric_positive(v: Any) -> bool:
    if isinstance(v, (int, float)) and v == v and v > 0:
        return True
    if isinstance(v, str) and v.strip():
        try:
            x = float(v.strip())
            return x == x and x > 0
        except ValueError:
            return False
    return False


def _json_numeric_pct(v: Any) -> bool:
    if isinstance(v, (int, float)) and v == v and v > -99.5:
        return True
    if isinstance(v, str) and v.strip():
        try:
            x = float(v.strip())
            return x == x and x > -99.5
        except ValueError:
            return False
    return False


def _dashboard_snapshots_have_usable_vix(snapshots: list[dict[str, Any]]) -> bool:
    """True when tape already includes a VIX row the UI can pulse (level and/or session %)."""
    for raw in snapshots:
        if not _snapshot_symbol_is_vix(str(raw.get("symbol", ""))):
            continue
        if _json_numeric_positive(raw.get("last_trade_price")):
            return True
        if _json_numeric_positive(raw.get("day_close")):
            return True
        for k in ("change_percent", "pre_market_change_percent", "after_hours_change_percent"):
            if _json_numeric_pct(raw.get(k)):
                return True
    return False


def _earnings_entitlement_fallback(symbols: list[str], days: int, exc: PolygonError) -> dict[str, Any]:
    msg_l = str(exc).lower()
    if not (
        "403" in str(exc)
        or "401" in str(exc)
        or "forbidden" in msg_l
        or "not entitled" in msg_l
        or "subscription" in msg_l
    ):
        raise exc
    return {
        "symbols": symbols,
        "days": days,
        "upcoming": [],
        "recent": [],
        "notice": (
            "Earnings data requires a Polygon Stocks Developer plan or Benzinga earnings add-on. "
            "Upgrade at polygon.io to enable this feature."
        ),
    }


async def build_dashboard_summary(
    *,
    earnings_symbols: list[str],
    earnings_days: int = 7,
    sparkline_limit: int = 12,
    daily_limit: int = 8,
    tape_symbols: list[str] | None = None,
    daily_symbols: list[str] | None = None,
    settings: Settings | None = None,
    client_factory: Callable[..., PolygonClient] = PolygonClient,
) -> dict[str, Any]:
    """
    Parallel dashboard tape + daily closes + earnings inside one Polygon client session.
    News is omitted (dashboard overview does not render MI feed on first paint).
    """
    settings = settings or get_settings()
    tape = list(tape_symbols or DASHBOARD_TAPE_SYMBOLS)
    daily = list(daily_symbols or DASHBOARD_DAILY_SYMBOLS)
    earn_syms = [s.strip().upper() for s in earnings_symbols if s.strip()]

    async with client_factory(api_key=settings.polygon_api_key) as client:
        status_coro = client.get_market_status()
        snaps_coro = client.get_snapshots_many(tape, chunk_size=50)
        spark_coro = _fetch_sparklines(client, tape, limit=sparkline_limit)
        daily_coro = _fetch_daily_closes(client, daily, limit=daily_limit)

        status, snaps, sparklines, daily_closes = await asyncio.gather(
            status_coro, snaps_coro, spark_coro, daily_coro
        )

        earnings: dict[str, Any]
        if earn_syms:
            try:
                earnings = await _fetch_earnings(client, earn_syms, days=earnings_days)
            except PolygonError as exc:
                earnings = _earnings_entitlement_fallback(earn_syms, earnings_days, exc)
        else:
            earnings = {"symbols": [], "days": earnings_days, "upcoming": [], "recent": []}

        snapshots: list[dict[str, Any]] = []
        if isinstance(snaps, list):
            for snap in snaps:
                if isinstance(snap, Snapshot):
                    snapshots.append(snap.model_dump(mode="json"))
                elif isinstance(snap, dict):
                    snapshots.append(snap)

        if not _dashboard_snapshots_have_usable_vix(snapshots):
            vix_snap = await get_vix_snapshot_with_fallback(client)
            if vix_snap is not None:
                snapshots.append(vix_snap.model_dump(mode="json"))

    return {
        "status": status.model_dump(mode="json"),
        "snapshots": snapshots,
        "sparklines_by_symbol": sparklines,
        "daily_closes": daily_closes,
        "earnings": earnings,
        "served_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
