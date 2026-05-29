"""Multi-source earnings calendar for dashboard, market API, and gap catalysts."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from stocvest.data.benzinga_client import BenzingaClient
from stocvest.data.finnhub_client import get_earnings_calendar as finnhub_earnings_calendar
from stocvest.data.finnhub_client import get_market_earnings_calendar
from stocvest.data.fmp_client import get_upcoming_earnings_date
from stocvest.data.models import EarningsEvent
from stocvest.data.polygon_client import PolygonClient, PolygonError
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_POLYGON_EARNINGS_NOTICE = (
    "Earnings data requires a Polygon Stocks Developer plan or Benzinga earnings add-on. "
    "Upgrade at polygon.io to enable this feature, or configure FINNHUB_API_KEY."
)


def _dedupe_events(events: list[EarningsEvent]) -> list[EarningsEvent]:
    seen: set[tuple[str, str]] = set()
    out: list[EarningsEvent] = []
    for ev in events:
        k = (ev.symbol.strip().upper(), ev.report_date.isoformat())
        if k in seen:
            continue
        seen.add(k)
        out.append(ev)
    return out


async def _from_benzinga_symbols(
    symbols: list[str],
    *,
    from_date: date,
    to_date: date,
) -> list[EarningsEvent]:
    """Best-effort per-symbol Benzinga forward calendar."""
    client = BenzingaClient()
    today = date.today()
    window = max(1, (to_date - today).days + 1)
    out: list[EarningsEvent] = []
    for sym in symbols:
        s = sym.strip().upper()
        if not s:
            continue
        try:
            dates = await client.get_upcoming_earnings_calendar(s, days=min(30, window + 7))
        except Exception:
            continue
        for d in dates:
            if d < from_date or d > to_date:
                continue
            out.append(
                EarningsEvent(
                    symbol=s,
                    company_name=s,
                    report_date=d,
                    report_time="unknown",
                )
            )
    return out


async def _from_polygon(
    symbols: list[str],
    *,
    from_date: date,
    to_date: date,
    client: PolygonClient,
) -> list[EarningsEvent]:
    return await client.get_earnings_calendar(symbols=symbols, from_date=from_date, to_date=to_date)


async def _from_fmp_symbols(symbols: list[str], *, to_date: date) -> list[EarningsEvent]:
    today = date.today()
    window = max(1, (to_date - today).days + 1)
    out: list[EarningsEvent] = []
    for sym in symbols:
        s = sym.strip().upper()
        if not s:
            continue
        try:
            d = await get_upcoming_earnings_date(s, window_days=window)
        except Exception:
            continue
        if d is None or d < today or d > to_date:
            continue
        out.append(
            EarningsEvent(
                symbol=s,
                company_name=s,
                report_date=d,
                report_time="unknown",
            )
        )
    return out


async def fetch_earnings_events(
    symbols: list[str],
    *,
    from_date: date,
    to_date: date,
    polygon_client: PolygonClient | None = None,
) -> tuple[list[EarningsEvent], str | None, str | None]:
    """
    Load earnings for ``symbols`` in [from_date, to_date].

    Returns ``(events, notice, source)`` where ``source`` is finnhub|benzinga|polygon|fmp|empty.
    """
    syms = [s.strip().upper() for s in symbols if s and str(s).strip()]
    if not syms:
        return [], None, "empty"

    merged: list[EarningsEvent] = []
    source: str | None = None
    notice: str | None = None

    try:
        fh = await finnhub_earnings_calendar(syms, from_date=from_date, to_date=to_date)
        if fh:
            merged.extend(fh)
            source = "finnhub"
    except Exception as exc:
        _LOG.warning("earnings_fetch_finnhub err=%s", type(exc).__name__)

    if not merged:
        try:
            bz = await _from_benzinga_symbols(syms, from_date=from_date, to_date=to_date)
            if bz:
                merged.extend(bz)
                source = "benzinga"
        except Exception as exc:
            _LOG.warning("earnings_fetch_benzinga err=%s", type(exc).__name__)

    if not merged and polygon_client is not None:
        try:
            poly = await _from_polygon(syms, from_date=from_date, to_date=to_date, client=polygon_client)
            if poly:
                merged.extend(poly)
                source = "polygon"
        except PolygonError as exc:
            msg_l = str(exc).lower()
            if (
                "403" in str(exc)
                or "401" in str(exc)
                or "forbidden" in msg_l
                or "not entitled" in msg_l
                or "subscription" in msg_l
            ):
                notice = _POLYGON_EARNINGS_NOTICE
            else:
                _LOG.warning("earnings_fetch_polygon err=%s", str(exc)[:120])
        except Exception as exc:
            _LOG.warning("earnings_fetch_polygon err=%s", type(exc).__name__)

    if not merged:
        try:
            fmp = await _from_fmp_symbols(syms, to_date=to_date)
            if fmp:
                merged.extend(fmp)
                source = "fmp"
        except Exception as exc:
            _LOG.warning("earnings_fetch_fmp err=%s", type(exc).__name__)

    events = _dedupe_events(merged)
    if not events and notice is None and polygon_client is not None:
        notice = None
    return events, notice, source or ("empty" if not events else source)


def split_upcoming_recent(
    events: list[EarningsEvent],
    *,
    today: date | None = None,
) -> tuple[list[EarningsEvent], list[EarningsEvent]]:
    """Upcoming = report_date >= today; recent = report_date < today."""
    ref = today or date.today()
    upcoming = [e for e in events if e.report_date >= ref]
    recent = [e for e in events if e.report_date < ref]
    return upcoming, recent


async def fetch_market_earnings_events(
    *,
    from_date: date,
    to_date: date,
) -> tuple[list[EarningsEvent], str | None, str | None]:
    """Full-market earnings calendar (Finnhub); used by the dedicated earnings page."""
    try:
        fh = await get_market_earnings_calendar(from_date=from_date, to_date=to_date)
        if fh:
            return _dedupe_events(fh), None, "finnhub"
    except Exception as exc:
        _LOG.warning("earnings_fetch_market_finnhub err=%s", type(exc).__name__)
    notice = (
        "Market-wide earnings require FINNHUB_API_KEY. "
        "Configure the key in stocvest/external-api-keys."
    )
    return [], notice, "empty"


async def fetch_market_earnings_payload(
    *,
    days: int,
) -> dict[str, Any]:
    """Payload for scope=market earnings requests."""
    today = date.today()
    to_date = today + timedelta(days=max(1, int(days)))
    recent_from = today - timedelta(days=3)
    events, notice, source = await fetch_market_earnings_events(
        from_date=recent_from,
        to_date=to_date,
    )
    upcoming, recent = split_upcoming_recent(events, today=today)
    return {
        "symbols": [],
        "days": days,
        "scope": "market",
        "upcoming": [x.model_dump(mode="json") for x in upcoming],
        "recent": [x.model_dump(mode="json") for x in recent],
        "notice": notice,
        "source": source,
    }


async def fetch_earnings_payload(
    symbols: list[str],
    *,
    days: int,
    polygon_client: PolygonClient | None = None,
) -> dict[str, Any]:
    """Shape used by market earnings API and dashboard summary."""
    today = date.today()
    to_date = today + timedelta(days=max(1, int(days)))
    recent_from = today - timedelta(days=3)
    events, notice, source = await fetch_earnings_events(
        symbols,
        from_date=recent_from,
        to_date=to_date,
        polygon_client=polygon_client,
    )
    upcoming, recent = split_upcoming_recent(events, today=today)
    return {
        "symbols": [s.strip().upper() for s in symbols if s.strip()],
        "days": days,
        "upcoming": [x.model_dump(mode="json") for x in upcoming],
        "recent": [x.model_dump(mode="json") for x in recent],
        "notice": notice,
        "source": source,
    }


def index_earnings_by_symbol(events: list[EarningsEvent]) -> dict[str, list[EarningsEvent]]:
    out: dict[str, list[EarningsEvent]] = {}
    for ev in events:
        sym = ev.symbol.strip().upper()
        if not sym:
            continue
        out.setdefault(sym, []).append(ev)
    return out
