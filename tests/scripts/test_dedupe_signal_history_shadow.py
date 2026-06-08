"""Tests for shadow-row dedupe selection logic."""

from __future__ import annotations

from datetime import datetime, timezone

from scripts.dedupe_signal_history_shadow import (
    ShadowRow,
    is_shadow_row,
    select_shadow_duplicates_to_delete,
)


def test_is_shadow_row_detects_capture_kind_and_pattern_suffix() -> None:
    assert is_shadow_row({"capture_kind": "shadow", "pattern": "breakout_long"})
    assert is_shadow_row({"capture_kind": "qualified", "pattern": "x:ledger_capture_shadow"})
    assert not is_shadow_row({"capture_kind": "qualified", "pattern": "breakout_long"})
    assert not is_shadow_row({"capture_kind": "live", "pattern": "intraday_composite"})


def test_select_shadow_duplicates_keeps_earliest_per_group() -> None:
    base = datetime(2026, 6, 5, 19, 55, tzinfo=timezone.utc)
    rows = [
        ShadowRow("a", "u1", "NVDA", "day", "2026-06-05", base),
        ShadowRow("b", "u1", "NVDA", "day", "2026-06-05", base.replace(minute=58)),
        ShadowRow("c", "u1", "NVDA", "day", "2026-06-05", base.replace(minute=59)),
        ShadowRow("d", "u1", "TSLA", "day", "2026-06-05", base),
    ]
    assert select_shadow_duplicates_to_delete(rows) == ["b", "c"]
