"""Tests for :mod:`stocvest.signals.macro_event`."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from stocvest.signals.macro_event import MacroEvent, MacroEventCategory, MacroEventStatus, compute_event_status

_ET = ZoneInfo("America/New_York")


def _ev(
    *,
    event_id: str = "E1",
    name: str = "Test",
    category: MacroEventCategory = MacroEventCategory.FED,
    country: str = "US",
    scheduled_time: datetime | None = None,
    importance: int = 5,
    source: str = "test",
    status: MacroEventStatus = MacroEventStatus.UPCOMING,
) -> MacroEvent:
    st = scheduled_time or datetime(2026, 5, 7, 14, 0, tzinfo=_ET)
    return MacroEvent(
        event_id=event_id,
        name=name,
        category=category,
        country=country,
        scheduled_time=st,
        importance=importance,
        source=source,
        status=status,
    )


@pytest.mark.unit
def test_event_status_imminent_under_4h() -> None:
    ref = datetime(2026, 5, 7, 10, 0, 0, tzinfo=_ET)
    ev = _ev(scheduled_time=ref + timedelta(hours=2.5))
    compute_event_status(ev, ref=ref)
    assert ev.status == MacroEventStatus.IMMINENT


@pytest.mark.unit
def test_event_status_today_under_24h() -> None:
    ref = datetime(2026, 5, 7, 10, 0, 0, tzinfo=_ET)
    ev = _ev(scheduled_time=ref + timedelta(hours=10))
    compute_event_status(ev, ref=ref)
    assert ev.status == MacroEventStatus.TODAY


@pytest.mark.unit
def test_event_status_upcoming_over_24h() -> None:
    ref = datetime(2026, 5, 7, 10, 0, 0, tzinfo=_ET)
    ev = _ev(scheduled_time=ref + timedelta(hours=48))
    compute_event_status(ev, ref=ref)
    assert ev.status == MacroEventStatus.UPCOMING


@pytest.mark.unit
def test_event_status_past() -> None:
    ref = datetime(2026, 5, 7, 10, 0, 0, tzinfo=_ET)
    ev = _ev(scheduled_time=ref - timedelta(hours=25))
    compute_event_status(ev, ref=ref)
    assert ev.status == MacroEventStatus.PAST


@pytest.mark.unit
def test_warning_label_imminent() -> None:
    ref = datetime(2026, 5, 7, 12, 0, 0, tzinfo=_ET)
    ev = _ev(
        name="FOMC Rate Decision",
        scheduled_time=ref + timedelta(minutes=45),
        importance=5,
        status=MacroEventStatus.IMMINENT,
    )
    w = ev.get_warning_label(ref=ref)
    assert w is not None
    assert "45 minutes" in w
    assert "avoid new entries" in w


@pytest.mark.unit
def test_warning_label_today() -> None:
    ref = datetime(2026, 5, 7, 6, 0, 0, tzinfo=_ET)
    ev = _ev(
        scheduled_time=ref + timedelta(hours=8),
        importance=5,
        status=MacroEventStatus.TODAY,
    )
    w = ev.get_warning_label(ref=ref)
    assert w is not None
    assert "volatility risk" in w


@pytest.mark.unit
def test_warning_label_none_for_low_importance() -> None:
    ref = datetime(2026, 5, 7, 10, 0, 0, tzinfo=_ET)
    ev = _ev(importance=2, scheduled_time=ref + timedelta(hours=2), status=MacroEventStatus.IMMINENT)
    assert ev.get_warning_label(ref=ref) is None


@pytest.mark.unit
def test_is_high_impact_threshold() -> None:
    assert _ev(importance=4).is_high_impact is True
    assert _ev(importance=3).is_high_impact is False
