"""Position holder / position-management read (ship-dark) — deterministic builder."""

from __future__ import annotations

import pytest

from stocvest.signals.position_holder_read import build_position_holder_read

pytestmark = pytest.mark.unit


def _body(**over):
    base = {
        "status": "active",
        "signal_summary": "neutral",
        "signal_structure_broken": False,
        "risk_reward": 2.5,
        "min_rr_desk": 1.5,
        "reference_stop_distance_atr": 3.0,
        "reference_stop_level": 20.98,
        "position_fundamentals": {"verdict": "bullish"},
    }
    base.update(over)
    return base


def test_broken_structure_plus_bad_rr_is_defensive() -> None:
    # SOFI-shaped: structure broken + R/R 0.40 < 1.5 minimum.
    read = build_position_holder_read(
        _body(signal_structure_broken=True, risk_reward=0.40, signal_summary="bearish")
    )
    assert read is not None
    assert read["stance"] == "defensive"
    assert any("reduc" in a.lower() for a in read["actions"])
    assert any("tighten your stop" in a.lower() for a in read["actions"])
    # Quality-vs-price conflict surfaced because fundamentals still read bullish.
    assert any("quality-vs-price" in c.lower() for c in read["context"])
    assert "not personalized investment advice" in read["disclaimer"].lower()


def test_broken_structure_alone_is_caution() -> None:
    read = build_position_holder_read(
        _body(signal_structure_broken=True, risk_reward=2.0, min_rr_desk=1.5)
    )
    assert read is not None
    assert read["stance"] == "caution"
    assert any("tighten your stop" in a.lower() for a in read["actions"])


def test_thin_rr_with_intact_trend_is_caution_no_add() -> None:
    read = build_position_holder_read(_body(risk_reward=1.0, min_rr_desk=1.5))
    assert read is not None
    assert read["stance"] == "caution"
    assert any("avoid adding" in a.lower() for a in read["actions"])


def test_healthy_setup_is_constructive() -> None:
    read = build_position_holder_read(_body(risk_reward=2.5, min_rr_desk=1.5))
    assert read is not None
    assert read["stance"] == "constructive"
    assert any("no defensive action" in a.lower() for a in read["actions"])


def test_insufficient_returns_none_but_incomplete_still_reads() -> None:
    assert build_position_holder_read(_body(status="insufficient_data")) is None
    assert build_position_holder_read(_body(signal_summary="")) is None
    assert build_position_holder_read(None) is None
    # "incomplete" geometry is a valid case for an existing holder — still produce a read.
    incomplete = build_position_holder_read(_body(status="incomplete", risk_reward=0.0))
    assert incomplete is not None and incomplete["stance"] in ("defensive", "caution")


def test_context_lines_are_factual() -> None:
    read = build_position_holder_read(_body(risk_reward=0.40, min_rr_desk=1.5))
    assert read is not None
    joined = " ".join(read["context"]).lower()
    assert "0.40" in joined and "1.50" in joined
    assert "atr" in joined
