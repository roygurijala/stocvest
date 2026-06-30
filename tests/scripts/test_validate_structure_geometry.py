"""Unit tests for B80 structure geometry validation replay helpers."""

from __future__ import annotations

import pytest

from scripts.validate_structure_geometry import (
    SYNTHETIC_CASES,
    _intc_entry_zone_check,
    planned_rr,
    replay_geometry,
)


@pytest.mark.unit
def test_planned_rr_long() -> None:
    assert planned_rr(100.0, 95.0, 110.0) == pytest.approx(2.0)


@pytest.mark.unit
def test_entry_anchor_fixture_b80_band_narrower() -> None:
    case = SYNTHETIC_CASES[0]
    leg = replay_geometry(case, variant="legacy")
    b80 = replay_geometry(case, variant="b80")
    assert leg.entry_zone_width_pct is not None and b80.entry_zone_width_pct is not None
    assert b80.entry_zone_width_pct < leg.entry_zone_width_pct


@pytest.mark.unit
def test_intc_entry_zone_gate() -> None:
    ok, _detail = _intc_entry_zone_check()
    assert ok


@pytest.mark.unit
def test_analyst_pt_fixture_b80_t2_not_at_analyst_level() -> None:
    case = next(c for c in SYNTHETIC_CASES if c.analyst_target_levels)
    b80 = replay_geometry(case, variant="b80")
    assert b80.target_2 != 130.0
    assert b80.target_2_provenance != "resistance" or (b80.target_2 or 0) < 120.0


@pytest.mark.unit
def test_synthetic_report_cases_replay_without_error() -> None:
    for case in SYNTHETIC_CASES:
        for variant in ("legacy", "b80"):
            res = replay_geometry(case, variant=variant)
            assert res.stop is not None
            assert res.target_1 is not None
