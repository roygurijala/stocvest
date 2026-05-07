"""Async macro context: FRED + optional Polygon economics overlay."""

from __future__ import annotations

import asyncio
import re
from datetime import date, datetime
from typing import Any
from zoneinfo import ZoneInfo

from stocvest.data.fred_client import FREDClient
from stocvest.data.models import EconomicCalendarEvent
from stocvest.signals.macro_event import (
    MacroEvent,
    MacroEventCategory,
    MacroEventStatus,
    compute_event_status,
    event_to_wire_dict,
)
from stocvest.utils.logging import get_logger

_LOG = get_logger(__name__)

_ET = ZoneInfo("America/New_York")


def _impact_to_score(impact: str) -> int:
    i = impact.lower()
    if i == "high":
        return 4
    if i == "medium":
        return 3
    return 2


def _category_from_name(name: str) -> MacroEventCategory:
    n = name.lower()
    if "fomc" in n or "fed" in n or "federal reserve" in n:
        return MacroEventCategory.FED
    if "cpi" in n or "consumer price" in n:
        return MacroEventCategory.CPI
    if "pce" in n:
        return MacroEventCategory.PCE
    if "payroll" in n or "employment" in n or "nfp" in n or "job" in n:
        return MacroEventCategory.JOBS
    if "gdp" in n:
        return MacroEventCategory.GDP
    if "retail" in n:
        return MacroEventCategory.RETAIL
    return MacroEventCategory.OTHER


def _parse_hhmm_et(time_et: str, *, day: date) -> tuple[int, int]:
    t = (time_et or "").strip().upper()
    if not t:
        return 8, 30
    m = re.match(r"^(\d{1,2}):(\d{2})", t)
    if m:
        return int(m.group(1)), int(m.group(2))
    return 8, 30


def polygon_econ_to_macro_events(rows: list[EconomicCalendarEvent]) -> list[MacroEvent]:
    """Convert Polygon/Benzinga economics rows to :class:`MacroEvent` (supplemental)."""
    out: list[MacroEvent] = []
    for ev in rows:
        nm_low = ev.event_name.lower()
        major_kw = any(
            k in nm_low
            for k in (
                "fomc",
                "fed",
                "cpi",
                "pce",
                "gdp",
                "payroll",
                "employment",
                "nfp",
                "jobs",
                "retail sales",
            )
        )
        if ev.impact != "high" and not major_kw:
            continue
        d = ev.event_date or date.today()
        h, mi = _parse_hhmm_et(ev.time_et, day=d)
        st = datetime(d.year, d.month, d.day, h, mi, 0, tzinfo=_ET)
        imp = _impact_to_score(ev.impact)
        if major_kw:
            imp = max(imp, 4)
        if "fomc" in nm_low or "rate decision" in nm_low:
            imp = 5
        cat = _category_from_name(ev.event_name)
        eid = f"POLY_{d.isoformat()}_{abs(hash(ev.event_name)) % 1_000_000_000}"
        out.append(
            MacroEvent(
                event_id=eid,
                name=ev.event_name[:120],
                category=cat,
                country="US",
                scheduled_time=st,
                importance=min(5, imp),
                source="Polygon",
            )
        )
    return out


def _merge_dedupe_events(primary: list[MacroEvent], extra: list[MacroEvent]) -> list[MacroEvent]:
    seen: set[tuple[str, str]] = set()
    merged: list[MacroEvent] = []
    for e in sorted(primary + extra, key=lambda x: x.scheduled_time):
        key = (e.scheduled_time.date().isoformat(), e.name.lower()[:80])
        if key in seen:
            continue
        seen.add(key)
        merged.append(e)
    return merged


async def get_macro_context(
    fred_client: FREDClient | None = None,
    *,
    polygon_econ_events: list[EconomicCalendarEvent] | None = None,
) -> dict[str, Any]:
    client = fred_client or FREDClient()

    events_task = asyncio.create_task(client.get_upcoming_events(days_ahead=7))
    yield_task = asyncio.create_task(client.get_yield_curve())

    events, yield_curve = await asyncio.gather(
        events_task,
        yield_task,
        return_exceptions=True,
    )

    if isinstance(events, Exception):
        _LOG.warning("macro_events_failed error=%s", events)
        events = []
    if isinstance(yield_curve, Exception):
        _LOG.warning("yield_curve_failed error=%s", yield_curve)
        yield_curve = None

    poly_macro: list[MacroEvent] = []
    if polygon_econ_events:
        poly_macro = polygon_econ_to_macro_events(polygon_econ_events)

    if poly_macro:
        events = _merge_dedupe_events(list(events), poly_macro)

    for e in events:
        compute_event_status(e)

    high_impact = [
        e
        for e in events
        if e.is_high_impact and e.status not in (MacroEventStatus.PAST, MacroEventStatus.RELEASED)
    ]
    high_impact.sort(key=lambda x: x.scheduled_time)

    warnings: list[str] = []
    for event in high_impact[:3]:
        label = event.warning_label
        if label:
            warnings.append(label)

    yc = yield_curve if isinstance(yield_curve, dict) else None
    if yc and yc.get("regime") == "inverted":
        warnings.append("Yield curve inverted — macro bearish bias")
    elif yc and yc.get("regime") == "flat":
        warnings.append("Yield curve flattening — late cycle signal")

    imminent = [e for e in high_impact if e.status == MacroEventStatus.IMMINENT]
    today_events = [e for e in high_impact if e.status == MacroEventStatus.TODAY]

    if imminent:
        macro_risk = "critical"
    elif today_events:
        macro_risk = "elevated"
    elif high_impact:
        macro_risk = "moderate"
    else:
        macro_risk = "low"

    return {
        "upcoming_events": [event_to_wire_dict(e) for e in high_impact],
        "warnings": warnings,
        "macro_risk": macro_risk,
        "macro_risk_level": macro_risk,
        "yield_curve": yc,
    }
