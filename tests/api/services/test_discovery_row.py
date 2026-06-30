"""Discovery row serialization — display-safe R/R fields."""

from __future__ import annotations

import pytest

from stocvest.api.services.opportunity_desk.discovery_row import discovery_row_from_mover
from stocvest.api.services.opportunity_desk.funnel import FunnelMover


@pytest.mark.unit
def test_discovery_row_omits_zero_risk_reward_and_exposes_structure_rr() -> None:
    mover = FunnelMover(
        symbol="AAA",
        gap_percent=1.0,
        direction="up",
        rank_score=10.0,
        day_volume=1e6,
        session_price=100.0,
    )
    row = discovery_row_from_mover(
        mover,
        mode="swing",
        composite={
            "signal_summary": "bullish",
            "risk_reward": 0.0,
            "structure_risk_reward": 1.4,
            "entry_zone_worst_case_rr": 1.9,
            "desk_surface_eligible": False,
            "geometry_block_reason": "rr_below_desk_min",
        },
    )
    assert row["risk_reward"] == 1.4
    assert row["structure_risk_reward"] == 1.4
    assert row["entry_zone_worst_case_rr"] == 1.9
    assert row["desk_surface_eligible"] is False


@pytest.mark.unit
def test_discovery_row_null_risk_when_geometry_unscored() -> None:
    mover = FunnelMover(
        symbol="BBB",
        gap_percent=2.0,
        direction="up",
        rank_score=8.0,
        day_volume=1e6,
        session_price=50.0,
    )
    row = discovery_row_from_mover(
        mover,
        mode="swing",
        composite={
            "signal_summary": "bullish",
            "risk_reward": 0.0,
            "structure_risk_reward": None,
            "entry_zone_quality": "no_clean_entry",
        },
    )
    assert row["risk_reward"] is None
    assert row["structure_risk_reward"] is None
