from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from stocvest.data.orb_store import ORBRecord
from stocvest.signals.technical_analyzer import get_orb_state

_ET = ZoneInfo("America/New_York")


def test_orb_chip_forming_during_window() -> None:
    ref = datetime(2026, 5, 7, 9, 45, tzinfo=_ET)
    s = get_orb_state("AAPL", 430.0, ref_et=ref)
    assert s["orb_status"] == "forming"
    assert s["chip"] == "ORB Forming"


def test_orb_chip_long_breakout(monkeypatch: pytest.MonkeyPatch) -> None:
    ref = datetime(2026, 5, 7, 14, 0, tzinfo=_ET)

    def _fake_get(sym: str, trade_date=None):
        return ORBRecord(
            trade_date="2026-05-07",
            symbol=sym,
            orb_high=432.15,
            orb_low=428.90,
            orb_range_pct=0.77,
            computed_at="10:00:02 ET",
        )

    monkeypatch.setattr("stocvest.data.orb_store.get_orb_record", _fake_get)
    s = get_orb_state("AAPL", 435.0, ref_et=ref)
    assert s["chip"] == "ORB Long ↑ $432.15"
    assert s["breakout_direction"] == "long"
    assert s["orb_status"] == "complete"


def test_orb_chip_short_breakout(monkeypatch: pytest.MonkeyPatch) -> None:
    ref = datetime(2026, 5, 7, 14, 0, tzinfo=_ET)

    def _fake_get(sym: str, trade_date=None):
        return ORBRecord(
            trade_date="2026-05-07",
            symbol="AAPL",
            orb_high=432.15,
            orb_low=428.90,
            orb_range_pct=0.77,
            computed_at="10:00:02 ET",
        )

    monkeypatch.setattr("stocvest.data.orb_store.get_orb_record", _fake_get)
    s = get_orb_state("AAPL", 426.0, ref_et=ref)
    assert s["chip"] == "ORB Short ↓ $428.90"
    assert s["breakout_direction"] == "short"


def test_orb_chip_inside_range(monkeypatch: pytest.MonkeyPatch) -> None:
    ref = datetime(2026, 5, 7, 14, 0, tzinfo=_ET)

    def _fake_get(sym: str, trade_date=None):
        return ORBRecord(
            trade_date="2026-05-07",
            symbol="AAPL",
            orb_high=432.15,
            orb_low=428.90,
            orb_range_pct=0.77,
            computed_at="10:00:02 ET",
        )

    monkeypatch.setattr("stocvest.data.orb_store.get_orb_record", _fake_get)
    s = get_orb_state("AAPL", 430.5, ref_et=ref)
    chip = s["chip"] or ""
    assert "Inside ORB" in chip
    assert "428.90" in chip
    assert "432.15" in chip


def test_orb_chip_none_when_no_record(monkeypatch: pytest.MonkeyPatch) -> None:
    ref = datetime(2026, 5, 7, 14, 0, tzinfo=_ET)
    monkeypatch.setattr("stocvest.data.orb_store.get_orb_record", lambda *a, **k: None)
    s = get_orb_state("AAPL", 430.0, ref_et=ref)
    assert s["chip"] is None
    assert s["orb_status"] == "unavailable"


def test_orb_chip_none_premarket() -> None:
    ref = datetime(2026, 5, 7, 9, 15, tzinfo=_ET)
    s = get_orb_state("AAPL", 430.0, ref_et=ref)
    assert s["chip"] is None
    assert s["orb_status"] == "pre_market"


def test_no_expired_chip_ever_generated(monkeypatch: pytest.MonkeyPatch) -> None:
    scenarios = [
        datetime(2026, 5, 7, 9, 15, tzinfo=_ET),
        datetime(2026, 5, 7, 9, 45, tzinfo=_ET),
        datetime(2026, 5, 7, 10, 0, tzinfo=_ET),
        datetime(2026, 5, 7, 14, 0, tzinfo=_ET),
    ]

    def _fake_get(sym: str, trade_date=None):
        return ORBRecord(
            trade_date="2026-05-07",
            symbol=sym,
            orb_high=432.0,
            orb_low=428.0,
            orb_range_pct=0.9,
            computed_at="10:00 ET",
        )

    monkeypatch.setattr("stocvest.data.orb_store.get_orb_record", _fake_get)
    for ref in scenarios:
        s = get_orb_state("AAPL", 430.0, ref_et=ref)
        chip = s.get("chip")
        if isinstance(chip, str):
            assert "expired" not in chip.lower()
            assert "unavailable" not in chip.lower()
