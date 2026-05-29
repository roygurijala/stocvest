"""Polygon ``/v3/reference/tickers/{symbol}`` profile for universe gates."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any


@dataclass(frozen=True)
class TickerReference:
    symbol: str
    active: bool | None
    market_cap: float | None
    security_type: str | None
    locale: str | None
    country_code: str | None
    primary_exchange: str | None
    list_date: date | None
    name: str | None

    def is_adr(self) -> bool:
        t = (self.security_type or "").strip().upper()
        return t in {"ADRC", "ADRP", "ADR"}

    def listed_days(self, *, as_of: date | None = None) -> int | None:
        if self.list_date is None:
            return None
        ref = as_of or date.today()
        return (ref - self.list_date).days


def _parse_date(raw: object) -> date | None:
    if raw is None:
        return None
    text = str(raw).strip()[:10]
    if not text:
        return None
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _parse_market_cap(raw: object) -> float | None:
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val <= 0 or val != val:
        return None
    return val


def parse_polygon_ticker_details(raw: dict[str, Any] | None, *, symbol: str = "") -> TickerReference | None:
    if not isinstance(raw, dict) or not raw:
        return None
    sym = str(raw.get("ticker") or symbol or "").strip().upper()
    if not sym:
        return None
    active_raw = raw.get("active")
    active: bool | None
    if isinstance(active_raw, bool):
        active = active_raw
    else:
        active = None
    return TickerReference(
        symbol=sym,
        active=active,
        market_cap=_parse_market_cap(raw.get("market_cap")),
        security_type=str(raw.get("type") or "").strip().upper() or None,
        locale=str(raw.get("locale") or "").strip().lower() or None,
        country_code=str(raw.get("country_code") or "").strip().upper() or None,
        primary_exchange=str(raw.get("primary_exchange") or "").strip().upper() or None,
        list_date=_parse_date(raw.get("list_date")),
        name=str(raw.get("name") or "").strip() or None,
    )
