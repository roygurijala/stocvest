"""Position (weekly) validation-timing windows — ADR-004 POS-D9."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from stocvest.api.services.validation_timing import (
    is_position_ledger_entry_window_et,
    is_position_monitor_evaluation_window_et,
)

# 2026-09-11 is a Friday; 2026-09-10 a Thursday. 20:05 UTC == 16:05 ET (EDT).
_FRI_1605_ET = datetime(2026, 9, 11, 20, 5, tzinfo=timezone.utc)
_FRI_1200_ET = datetime(2026, 9, 11, 16, 0, tzinfo=timezone.utc)  # 12:00 ET
_THU_1605_ET = datetime(2026, 9, 10, 20, 5, tzinfo=timezone.utc)


def test_entry_window_true_only_in_friday_post_close_window() -> None:
    assert is_position_ledger_entry_window_et(_FRI_1605_ET) is True


def test_entry_window_false_before_close_window() -> None:
    assert is_position_ledger_entry_window_et(_FRI_1200_ET) is False


def test_entry_window_false_on_non_friday() -> None:
    assert is_position_ledger_entry_window_et(_THU_1605_ET) is False


def test_monitor_window_true_friday_after_close() -> None:
    assert is_position_monitor_evaluation_window_et(_FRI_1605_ET) is True


def test_monitor_window_false_friday_before_close() -> None:
    assert is_position_monitor_evaluation_window_et(_FRI_1200_ET) is False


@pytest.mark.parametrize("ref", [_THU_1605_ET])
def test_monitor_window_false_non_friday(ref: datetime) -> None:
    assert is_position_monitor_evaluation_window_et(ref) is False
