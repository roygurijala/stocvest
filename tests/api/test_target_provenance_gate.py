"""Target provenance and structure R/R gate honesty."""

from __future__ import annotations

from stocvest.api.services.risk_reward_structure import structure_risk_reward_long


def test_ubxg_like_unanchored_t2_returns_none_for_headline_rr() -> None:
    entry = 9.44
    stop = 2.86
    t1 = 11.4
    t2 = 22.7
    rr = structure_risk_reward_long(entry, t1, stop, t2, "2r_extension")
    assert rr is None


def test_structure_risk_reward_uses_t2_only_when_resistance_anchored() -> None:
    stop = round(min(98, 99.5) * 0.998, 4)
    entry = 100.0
    t1 = 102.0
    t2 = entry + 2.0 * (entry - stop)
    rr = structure_risk_reward_long(entry, t1, stop, t2, "resistance")
    assert rr is not None
    assert rr > 1.0


def test_unanchored_t2_does_not_promote_when_t1_tight() -> None:
    stop = round(min(98, 99.5) * 0.998, 4)
    entry = 100.0
    t1 = 102.0
    t2 = entry + 2.0 * (entry - stop)
    rr = structure_risk_reward_long(entry, t1, stop, t2, "2r_extension")
    assert rr is None


def test_swing_high_prefers_resistance_anchored_t2() -> None:
    from stocvest.api.services.swing_composite_evidence import _long_side_geometry

    highs = [98.0, 99.0, 100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 109.0, 110.0, 111.0, 112.0, 111.0, 110.0, 109.0, 108.0]
    daily_bars = [{"low": h - 2.0, "high": h} for h in highs]
    _, t1, t2, _, provenance = _long_side_geometry(
        day_lo=98.0,
        day_hi=105.0,
        vwap=101.0,
        prev_close=99.0,
        last=100.0,
        daily_bars=daily_bars,
    )
    assert t1 == 105.0
    assert t2 == 112.0
    assert provenance == "resistance"
