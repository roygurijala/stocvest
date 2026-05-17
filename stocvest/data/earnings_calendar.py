"""Upcoming earnings date for swing context (not a composite layer)."""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, MutableMapping

from stocvest.data.benzinga_client import BenzingaClient
from stocvest.data.models import EarningsEvent
from stocvest.data.polygon_client import PolygonClient
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

EarningsRiskLevel = Literal["imminent", "elevated", "watch", "normal"]

_CACHE_TTL_SEC = 24 * 60 * 60
_horizon_cache: dict[str, tuple[float, EarningsHorizon | None]] = {}


@dataclass(frozen=True)
class EarningsHorizon:
    report_date: date
    days_away: int
    risk: EarningsRiskLevel
    report_time: str
    chip: str | None

    @property
    def report_date_iso(self) -> str:
        return self.report_date.isoformat()


def classify_earnings_risk(days_away: int) -> tuple[EarningsRiskLevel, str | None]:
    if days_away <= 1:
        return "imminent", "⚠️ Earnings tomorrow — high volatility risk"
    if days_away <= 3:
        return "elevated", f"⚠️ Earnings in {days_away} days"
    if days_away <= 7:
        return "watch", f"Earnings in {days_away} days"
    return "normal", None


def _normalize_report_time(raw: str | None) -> str:
    s = str(raw or "").strip().lower()
    if s in ("before_market", "bmo", "premarket", "pre-market"):
        return "before_market"
    if s in ("after_market", "amc", "postmarket", "post-market"):
        return "after_market"
    if s in ("during_market", "dmh"):
        return "during_market"
    return "unknown"


def _horizon_from_event(event: EarningsEvent, *, today: date) -> EarningsHorizon | None:
    days = (event.report_date - today).days
    if days < 0 or days > 30:
        return None
    risk, chip = classify_earnings_risk(days)
    return EarningsHorizon(
        report_date=event.report_date,
        days_away=days,
        risk=risk,
        report_time=_normalize_report_time(event.report_time),
        chip=chip,
    )


async def _from_benzinga(symbol: str, *, today: date, window_days: int) -> date | None:
    client = BenzingaClient()
    rows = await client.get_upcoming_earnings_calendar(symbol, days=window_days)
    best: date | None = None
    for row in rows:
        if row < today:
            continue
        if best is None or row < best:
            best = row
    return best


async def _from_polygon(
    symbol: str,
    *,
    client: PolygonClient,
    today: date,
    window_days: int,
) -> EarningsHorizon | None:
    to_date = today + timedelta(days=window_days)
    events = await client.get_earnings_calendar([symbol], today, to_date)
    best: EarningsHorizon | None = None
    for ev in events:
        h = _horizon_from_event(ev, today=today)
        if h is None:
            continue
        if best is None or h.report_date < best.report_date:
            best = h
    return best


async def resolve_upcoming_earnings_horizon(
    symbol: str,
    *,
    polygon_client: PolygonClient | None = None,
    window_days: int = 30,
) -> EarningsHorizon | None:
    """
  Return the next scheduled earnings date within ``window_days``, if any.

    Never raises. Uses a 24h in-process cache per symbol.
    """
    sym = symbol.strip().upper()
    if not sym:
        return None

    now = time.time()
    cached = _horizon_cache.get(sym)
    if cached and now - cached[0] < _CACHE_TTL_SEC:
        return cached[1]

    today = datetime.now(timezone.utc).date()
    horizon: EarningsHorizon | None = None

    try:
        bz_date = await _from_benzinga(sym, today=today, window_days=window_days)
        if bz_date is not None:
            days = (bz_date - today).days
            risk, chip = classify_earnings_risk(days)
            horizon = EarningsHorizon(
                report_date=bz_date,
                days_away=days,
                risk=risk,
                report_time="unknown",
                chip=chip,
            )
    except Exception as exc:
        _LOG.warning("earnings_calendar_benzinga_failed symbol=%s err=%s", sym, type(exc).__name__)

    if horizon is None and polygon_client is not None:
        try:
            horizon = await _from_polygon(sym, client=polygon_client, today=today, window_days=window_days)
        except Exception as exc:
            _LOG.warning("earnings_calendar_polygon_failed symbol=%s err=%s", sym, type(exc).__name__)

    if horizon is None:
        try:
            from stocvest.data.fmp_client import get_upcoming_earnings_date

            fmp_date = await get_upcoming_earnings_date(sym, window_days=window_days)
            if fmp_date is not None:
                days = (fmp_date - today).days
                risk, chip = classify_earnings_risk(days)
                horizon = EarningsHorizon(
                    report_date=fmp_date,
                    days_away=days,
                    risk=risk,
                    report_time="unknown",
                    chip=chip,
                )
        except Exception as exc:
            _LOG.warning("earnings_calendar_fmp_failed symbol=%s err=%s", sym, type(exc).__name__)

    _horizon_cache[sym] = (now, horizon)
    return horizon


def earnings_horizon_to_api_fields(horizon: EarningsHorizon | None) -> dict[str, Any]:
    """Top-level swing composite fields (display-only; no score impact)."""
    if horizon is None:
        return {}
    out: dict[str, Any] = {
        "upcoming_earnings_date": horizon.report_date_iso,
        "earnings_days_away": horizon.days_away,
        "earnings_risk": horizon.risk,
        "earnings_report_time": horizon.report_time,
    }
    if horizon.chip:
        out["earnings_chip"] = horizon.chip
    return out


def merge_earnings_horizon_into_response(
    response: MutableMapping[str, Any],
    horizon: EarningsHorizon | None,
) -> None:
    response.update(earnings_horizon_to_api_fields(horizon))


def clear_earnings_horizon_cache(symbol: str | None = None) -> None:
    """Test helper."""
    if symbol:
        _horizon_cache.pop(symbol.strip().upper(), None)
    else:
        _horizon_cache.clear()
