"""
First-class MacroEvent entity for scheduled releases and central-bank decisions.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
from enum import Enum
from typing import Any
from zoneinfo import ZoneInfo

_ET = ZoneInfo("America/New_York")


class MacroEventCategory(str, Enum):
    FED = "Fed"
    CPI = "CPI"
    PCE = "PCE"
    GDP = "GDP"
    JOBS = "Jobs"
    RETAIL = "Retail Sales"
    ISM = "ISM"
    EARNINGS = "Earnings Season"
    OTHER = "Other"


class MacroEventStatus(str, Enum):
    UPCOMING = "upcoming"
    TODAY = "today"
    IMMINENT = "imminent"
    RELEASED = "released"
    PAST = "past"


def _format_time_et_ampm(dt: datetime) -> str:
    """Portable 12-hour time with AM/PM (no platform-specific strftime flags)."""
    h24 = dt.hour
    m = dt.minute
    ampm = "AM" if h24 < 12 else "PM"
    h12 = h24 % 12
    if h12 == 0:
        h12 = 12
    return f"{h12}:{m:02d} {ampm} ET"


@dataclass
class MacroEvent:
    event_id: str
    name: str
    category: MacroEventCategory
    country: str
    scheduled_time: datetime
    importance: int
    source: str
    status: MacroEventStatus = MacroEventStatus.UPCOMING
    actual: str | None = None
    forecast: str | None = None
    previous: str | None = None

    @property
    def is_high_impact(self) -> bool:
        return self.importance >= 4

    def hours_until(self, *, ref: datetime | None = None) -> float:
        """Hours until event. Negative if past."""
        now = ref if ref is not None else datetime.now(self.scheduled_time.tzinfo or _ET)
        st = self.scheduled_time
        if st.tzinfo is None:
            st = st.replace(tzinfo=_ET)
        delta = st - now
        return delta.total_seconds() / 3600.0

    def get_warning_label(self, *, ref: datetime | None = None) -> str | None:
        if self.status in (MacroEventStatus.PAST, MacroEventStatus.RELEASED):
            return None
        if not self.is_high_impact:
            return None

        time_str = _format_time_et_ampm(self.scheduled_time)

        if self.status == MacroEventStatus.IMMINENT:
            mins = max(1, int(self.hours_until(ref=ref) * 60))
            return f"⚠️ {self.name} in {mins} minutes — avoid new entries"
        if self.status == MacroEventStatus.TODAY:
            return f"⚠️ {self.name} at {time_str} — volatility risk"
        if self.status == MacroEventStatus.UPCOMING:
            days = max(1, int(self.hours_until(ref=ref) / 24) + 1)
            when = "tomorrow" if days == 1 else f"in {days} days"
            return f"High-impact {self.category.value} {when} — elevated swing risk"
        return None

    @property
    def warning_label(self) -> str | None:
        return self.get_warning_label()


def compute_event_status(event: MacroEvent, *, ref: datetime | None = None) -> MacroEvent:
    """Update ``event.status`` from wall-clock vs ``scheduled_time``."""
    hours = event.hours_until(ref=ref)
    if hours < -24:
        event.status = MacroEventStatus.PAST
    elif hours < 0:
        event.status = MacroEventStatus.RELEASED
    elif hours < 4:
        event.status = MacroEventStatus.IMMINENT
    elif hours < 24:
        event.status = MacroEventStatus.TODAY
    else:
        event.status = MacroEventStatus.UPCOMING
    return event


def event_to_wire_dict(e: MacroEvent) -> dict[str, Any]:
    ev = replace(e)
    compute_event_status(ev)
    return {
        "event_id": ev.event_id,
        "name": ev.name,
        "category": ev.category.value,
        "status": ev.status.value,
        "importance": ev.importance,
        "hours_until": round(ev.hours_until(), 1),
        "warning": ev.get_warning_label(),
        "scheduled_time": ev.scheduled_time.isoformat(),
    }
