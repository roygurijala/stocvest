"""Macro layer scoring with FRED-backed ``macro_context``."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from stocvest.signals.macro_analyzer import MacroAnalyzer

from tests.signals.conftest import make_qqq_snapshot, make_spy_snapshot, make_vix_snapshot, mock_parameter_store

_ET = ZoneInfo("America/New_York")


def test_imminent_event_reduces_macro_score(mock_parameter_store) -> None:
    ref = datetime(2026, 5, 7, 12, 0, 0, tzinfo=_ET)
    upcoming = [
        {
            "event_id": "FOMC_2026-05-07",
            "name": "FOMC Rate Decision",
            "category": "Fed",
            "status": "imminent",
            "importance": 5,
            "hours_until": 2.0,
            "warning": "⚠️ soon",
            "scheduled_time": (ref + timedelta(hours=2)).isoformat(),
        }
    ]
    ctx = {
        "upcoming_events": upcoming,
        "warnings": ["⚠️ FOMC"],
        "macro_risk": "critical",
        "yield_curve": {"regime": "normal", "chip": "2s10s: +0.60%"},
    }
    base = MacroAnalyzer().analyze(
        make_spy_snapshot(1.0),
        make_qqq_snapshot(1.5),
        make_vix_snapshot(13.0, -1.0),
        [],
        mock_parameter_store.macro,
        macro_context=None,
    )
    adj = MacroAnalyzer().analyze(
        make_spy_snapshot(1.0),
        make_qqq_snapshot(1.5),
        make_vix_snapshot(13.0, -1.0),
        [],
        mock_parameter_store.macro,
        macro_context=ctx,
    )
    assert base.score is not None and adj.score is not None
    assert adj.score <= base.score - 15
    assert adj.macro_risk_level == "critical"


def test_inverted_yield_curve_reduces_score(mock_parameter_store) -> None:
    ctx = {
        "upcoming_events": [],
        "warnings": [],
        "macro_risk": "low",
        "yield_curve": {
            "regime": "inverted",
            "chip": "inv",
            "yield_2yr": 4.0,
            "yield_10yr": 3.5,
            "spread": -0.5,
            "label": "Yield curve: inverted ⚠️",
        },
    }
    base = MacroAnalyzer().analyze(
        make_spy_snapshot(1.0),
        make_qqq_snapshot(1.5),
        make_vix_snapshot(13.0, -1.0),
        [],
        mock_parameter_store.macro,
        macro_context=None,
    )
    adj = MacroAnalyzer().analyze(
        make_spy_snapshot(1.0),
        make_qqq_snapshot(1.5),
        make_vix_snapshot(13.0, -1.0),
        [],
        mock_parameter_store.macro,
        macro_context=ctx,
    )
    assert base.score is not None and adj.score is not None
    assert adj.score == base.score - 15


def test_no_events_no_penalty(mock_parameter_store) -> None:
    ctx = {
        "upcoming_events": [],
        "warnings": [],
        "macro_risk": "low",
        "yield_curve": {"regime": "normal", "chip": "n", "yield_2yr": 3.8, "yield_10yr": 4.5, "spread": 0.7, "label": "ok"},
    }
    base = MacroAnalyzer().analyze(
        make_spy_snapshot(1.0),
        make_qqq_snapshot(1.5),
        make_vix_snapshot(13.0, -1.0),
        [],
        mock_parameter_store.macro,
        macro_context=None,
    )
    adj = MacroAnalyzer().analyze(
        make_spy_snapshot(1.0),
        make_qqq_snapshot(1.5),
        make_vix_snapshot(13.0, -1.0),
        [],
        mock_parameter_store.macro,
        macro_context=ctx,
    )
    assert adj.macro_risk_level == "low"
    assert adj.score == base.score


def test_macro_warnings_populated(mock_parameter_store) -> None:
    ctx = {
        "upcoming_events": [
            {
                "event_id": "x",
                "name": "FOMC Rate Decision",
                "category": "Fed",
                "status": "today",
                "importance": 5,
                "hours_until": 5.0,
                "warning": "⚠️ FOMC today",
                "scheduled_time": datetime(2026, 5, 7, 14, 0, tzinfo=_ET).isoformat(),
            }
        ],
        "warnings": ["⚠️ FOMC today", "Yield curve inverted — macro bearish bias"],
        "macro_risk": "elevated",
        "yield_curve": {"regime": "inverted", "chip": "c"},
    }
    m = MacroAnalyzer().analyze(
        make_spy_snapshot(0.5),
        make_qqq_snapshot(0.5),
        make_vix_snapshot(16.0, 0.0),
        [],
        mock_parameter_store.macro,
        macro_context=ctx,
    )
    assert len(m.macro_warnings) >= 2
    assert any("FOMC" in w for w in m.macro_warnings)


def test_upcoming_events_in_response(mock_parameter_store) -> None:
    evs = [
        {
            "event_id": "a",
            "name": "A",
            "category": "Fed",
            "status": "upcoming",
            "importance": 5,
            "hours_until": 72.0,
            "warning": None,
            "scheduled_time": datetime(2026, 5, 10, 14, 0, tzinfo=_ET).isoformat(),
        },
        {
            "event_id": "b",
            "name": "B",
            "category": "CPI",
            "status": "upcoming",
            "importance": 5,
            "hours_until": 48.0,
            "warning": None,
            "scheduled_time": datetime(2026, 5, 9, 8, 30, tzinfo=_ET).isoformat(),
        },
        {
            "event_id": "c",
            "name": "C",
            "category": "Jobs",
            "status": "upcoming",
            "importance": 5,
            "hours_until": 96.0,
            "warning": None,
            "scheduled_time": datetime(2026, 5, 11, 8, 30, tzinfo=_ET).isoformat(),
        },
    ]
    ctx = {"upcoming_events": evs, "warnings": [], "macro_risk": "moderate", "yield_curve": None}
    m = MacroAnalyzer().analyze(
        make_spy_snapshot(0.5),
        make_qqq_snapshot(0.5),
        make_vix_snapshot(16.0, 0.0),
        [],
        mock_parameter_store.macro,
        macro_context=ctx,
    )
    assert len(m.upcoming_events) == 3
    times = [x["scheduled_time"] for x in m.upcoming_events]
    assert times == sorted(times)
