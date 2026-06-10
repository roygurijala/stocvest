from __future__ import annotations

from datetime import date

from scripts.ledger_signal_report import _is_ledger_row, _period_window


def test_period_window_daily() -> None:
    start, end, label = _period_window("daily", date(2026, 6, 9))
    assert start == end == date(2026, 6, 9)
    assert "2026-06-09" in label


def test_period_window_weekly() -> None:
    start, end, _ = _period_window("weekly", date(2026, 6, 9))
    assert end == date(2026, 6, 9)
    assert (end - start).days == 6


def test_period_window_monthly() -> None:
    start, end, _ = _period_window("monthly", date(2026, 6, 15))
    assert start == date(2026, 6, 1)
    assert end == date(2026, 6, 30)


def test_is_ledger_row_shadow_pattern() -> None:
    assert _is_ledger_row({"pattern": "swing_composite:ledger_capture_shadow"})


def test_is_ledger_row_qualified() -> None:
    assert _is_ledger_row({"ledger_qualified": True, "pattern": "swing_composite"})
