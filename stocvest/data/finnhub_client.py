"""Finnhub.io — earnings calendar (optional; loaded from FINNHUB_API_KEY)."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

import httpx

from stocvest.data.models import EarningsEvent
from stocvest.utils.config import get_settings
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

FINNHUB_BASE = "https://finnhub.io/api/v1"


def _api_key() -> str:
    return str(get_settings().finnhub_api_key or "").strip()


def _report_time_from_hour(raw: object) -> str:
    s = str(raw or "").strip().lower()
    if s in ("bmo", "before market", "before_market", "beforemarket", "pre"):
        return "before_market"
    if s in ("amc", "after market", "after_market", "aftermarket", "post"):
        return "after_market"
    if s in ("dmh", "during market", "during_market", "during"):
        return "during_market"
    return "unknown"


def _safe_float(v: object) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _parse_report_date(raw: object) -> date | None:
    if raw is None:
        return None
    if isinstance(raw, date):
        return raw
    s = str(raw).strip()[:10]
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _event_from_calendar_row(row: dict[str, Any]) -> EarningsEvent | None:
    sym = str(row.get("symbol") or "").strip().upper()
    if not sym:
        return None
    report_date = _parse_report_date(row.get("date"))
    if report_date is None:
        return None
    est = _safe_float(row.get("epsEstimate"))
    act = _safe_float(row.get("epsActual"))
    surprise: float | None = None
    if est is not None and act is not None and est != 0:
        surprise = round((act - est) / abs(est) * 100.0, 2)
    return EarningsEvent(
        symbol=sym,
        company_name=sym,
        report_date=report_date,
        report_time=_report_time_from_hour(row.get("hour")),
        estimated_eps=est,
        actual_eps=act,
        surprise_percent=surprise,
        market_cap=None,
    )


def _event_from_stock_earnings_row(row: dict[str, Any], *, symbol: str) -> EarningsEvent | None:
    sym = str(row.get("symbol") or symbol).strip().upper()
    if not sym:
        return None
    raw_d = row.get("period") or row.get("date")
    if raw_d is None:
        return None
    if isinstance(raw_d, (int, float)):
        try:
            report_date = datetime.fromtimestamp(float(raw_d), tz=timezone.utc).date()
        except (OSError, OverflowError, ValueError):
            return None
    else:
        report_date = _parse_report_date(raw_d)
    if report_date is None:
        return None
    est = _safe_float(row.get("estimate"))
    act = _safe_float(row.get("actual"))
    surprise = _safe_float(row.get("surprisePercent") or row.get("surprise"))
    return EarningsEvent(
        symbol=sym,
        company_name=sym,
        report_date=report_date,
        report_time="unknown",
        estimated_eps=est,
        actual_eps=act,
        surprise_percent=surprise,
        market_cap=None,
    )


async def _calendar_rows_from_finnhub(
    *,
    from_date: date,
    to_date: date,
    client: httpx.AsyncClient,
    key: str,
) -> list[dict[str, Any]]:
    resp = await client.get(
        f"{FINNHUB_BASE}/calendar/earnings",
        params={
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
            "token": key,
        },
    )
    if resp.status_code != 200:
        _LOG.warning(
            "finnhub_earnings_calendar_http status=%s body=%s",
            resp.status_code,
            resp.text[:200],
        )
        return []
    payload = resp.json()
    rows = payload.get("earningsCalendar") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict)]


def _events_in_range(
    rows: list[dict[str, Any]],
    *,
    from_date: date,
    to_date: date,
    symbols: frozenset[str] | None = None,
) -> list[EarningsEvent]:
    out: list[EarningsEvent] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        ev = _event_from_calendar_row(row)
        if ev is None:
            continue
        if symbols is not None and ev.symbol not in symbols:
            continue
        if ev.report_date < from_date or ev.report_date > to_date:
            continue
        k = (ev.symbol, ev.report_date.isoformat())
        if k in seen:
            continue
        seen.add(k)
        out.append(ev)
    out.sort(key=lambda e: (e.report_date, e.symbol))
    return out


async def get_market_earnings_calendar(
    *,
    from_date: date,
    to_date: date,
) -> list[EarningsEvent]:
    """
    Full US earnings calendar from Finnhub for [from_date, to_date] (no symbol filter).
    Never raises.
    """
    key = _api_key()
    if not key:
        return []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as client:
            rows = await _calendar_rows_from_finnhub(
                from_date=from_date,
                to_date=to_date,
                client=client,
                key=key,
            )
            return _events_in_range(rows, from_date=from_date, to_date=to_date, symbols=None)
    except Exception as exc:
        _LOG.warning("finnhub_market_earnings_calendar_failed err=%s", type(exc).__name__)
        return []


async def get_earnings_calendar(
    symbols: list[str],
    *,
    from_date: date,
    to_date: date,
) -> list[EarningsEvent]:
    """
    Earnings events for ``symbols`` between ``from_date`` and ``to_date`` (inclusive).

    Uses Finnhub ``/calendar/earnings`` plus per-symbol ``/stock/earnings`` when the
    calendar returns no rows in the past window (Finnhub calendar is forward-biased).
    Never raises.
    """
    key = _api_key()
    sym_set = frozenset(s.strip().upper() for s in symbols if s and str(s).strip())
    if not key or not sym_set:
        return []

    out: list[EarningsEvent] = []
    seen: set[tuple[str, str]] = set()

    def _add(ev: EarningsEvent) -> None:
        if ev.symbol not in sym_set:
            return
        if ev.report_date < from_date or ev.report_date > to_date:
            return
        k = (ev.symbol, ev.report_date.isoformat())
        if k in seen:
            return
        seen.add(k)
        out.append(ev)

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            rows = await _calendar_rows_from_finnhub(
                from_date=from_date,
                to_date=to_date,
                client=client,
                key=key,
            )
            for ev in _events_in_range(rows, from_date=from_date, to_date=to_date, symbols=sym_set):
                _add(ev)

            today = datetime.now(timezone.utc).date()
            if from_date < today:
                for sym in sorted(sym_set):
                    try:
                        sresp = await client.get(
                            f"{FINNHUB_BASE}/stock/earnings",
                            params={"symbol": sym, "token": key},
                        )
                        if sresp.status_code != 200:
                            continue
                        srows = sresp.json()
                        if not isinstance(srows, list):
                            continue
                        for row in srows:
                            if not isinstance(row, dict):
                                continue
                            ev = _event_from_stock_earnings_row(row, symbol=sym)
                            if ev is not None:
                                _add(ev)
                    except Exception as exc:
                        _LOG.debug("finnhub_stock_earnings_failed symbol=%s err=%s", sym, type(exc).__name__)
    except Exception as exc:
        _LOG.warning("finnhub_earnings_calendar_failed err=%s", type(exc).__name__)

    out.sort(key=lambda e: (e.report_date, e.symbol))
    return out
