"""B77 — day-desk midday session-phase gate (dead-zone) timing helpers."""

from __future__ import annotations

from datetime import datetime, time, timezone

import pytest

from stocvest.api.services.signal_validation_eligibility import (
    MIN_ACTIONABLE_SCORE_0_100,
    evaluate_day_ledger_entry,
)
from stocvest.api.services.validation_timing import (
    DAY_DEADZONE_END_ET,
    DAY_DEADZONE_START_ET,
    is_day_ledger_dead_zone_et,
    parse_et_hhmm,
)
from stocvest.signals.composite_score import CompositeVerdict

pytestmark = pytest.mark.unit


def _score_for_s100(s100: int) -> float:
    """Inverse of _score_0_100_from_composite: s100 = (score + 1) * 50."""
    return s100 / 50.0 - 1.0


def _day_eval(s100: int, *, penalty: float = 0.0, context: dict | None = None):
    return evaluate_day_ledger_entry(
        response_status="active",
        verdict=CompositeVerdict.BULLISH,
        composite_score=_score_for_s100(s100),
        alignment_ratio=0.60,
        macro_market_regime="neutral",
        risk_reward=2.0,
        intraday_bar_count=30,
        orb_signal="breakout_long",
        vwap_state="available",
        market_environment=None,
        session_phase_penalty_0_100=penalty,
        session_phase_context=context,
    )


def _utc(y: int, mo: int, d: int, hh: int, mm: int) -> datetime:
    """Build a UTC instant; ET = UTC-4 in June (DST), so add 4h to the ET clock."""
    return datetime(y, mo, d, hh + 4, mm, tzinfo=timezone.utc)


def test_defaults_are_noon_to_two() -> None:
    assert DAY_DEADZONE_START_ET == time(12, 0)
    assert DAY_DEADZONE_END_ET == time(14, 0)


@pytest.mark.parametrize("hh,mm", [(12, 0), (12, 30), (13, 0), (13, 59)])
def test_inside_window_blocks(hh: int, mm: int) -> None:
    # 2026-06-22 is a Monday.
    assert is_day_ledger_dead_zone_et(_utc(2026, 6, 22, hh, mm)) is True


@pytest.mark.parametrize("hh,mm", [(9, 45), (11, 59), (14, 0), (14, 1), (15, 30)])
def test_outside_window_allows(hh: int, mm: int) -> None:
    assert is_day_ledger_dead_zone_et(_utc(2026, 6, 22, hh, mm)) is False


def test_end_boundary_is_half_open() -> None:
    # 14:00 exactly must re-qualify into the healthier afternoon window.
    assert is_day_ledger_dead_zone_et(_utc(2026, 6, 22, 14, 0)) is False
    assert is_day_ledger_dead_zone_et(_utc(2026, 6, 22, 13, 59)) is True


def test_weekend_never_blocks() -> None:
    # 2026-06-21 is a Sunday.
    assert is_day_ledger_dead_zone_et(_utc(2026, 6, 21, 12, 30)) is False


def test_custom_window_override() -> None:
    start, end = time(10, 30), time(14, 0)
    assert is_day_ledger_dead_zone_et(
        _utc(2026, 6, 22, 10, 45), start_et=start, end_et=end
    ) is True
    assert is_day_ledger_dead_zone_et(
        _utc(2026, 6, 22, 9, 45), start_et=start, end_et=end
    ) is False


def test_inverted_window_disables_gate() -> None:
    # start >= end is treated as "no dead zone" rather than blocking everything.
    assert is_day_ledger_dead_zone_et(
        _utc(2026, 6, 22, 12, 30), start_et=time(14, 0), end_et=time(12, 0)
    ) is False


def test_parse_et_hhmm() -> None:
    assert parse_et_hhmm("12:00", time(0, 0)) == time(12, 0)
    assert parse_et_hhmm("09:30", time(0, 0)) == time(9, 30)
    assert parse_et_hhmm(None, time(13, 0)) == time(13, 0)
    assert parse_et_hhmm("garbage", time(13, 0)) == time(13, 0)
    assert parse_et_hhmm("", time(13, 0)) == time(13, 0)


# ── penalty wiring into the day decision-score gate ────────────────────────────

def test_no_penalty_is_byte_identical_legacy() -> None:
    ok, gates = _day_eval(80, penalty=0.0, context=None)
    assert ok is True
    assert "session_phase" not in gates
    assert gates["decision_score"] == {"pass": True, "value": 80}


def test_penalty_drops_marginal_midday_signal() -> None:
    # s100 80 - 12 = 68 < 72 → the marginal signal no longer qualifies.
    ctx = {"in_dead_zone": True, "rvol": 1.1, "rvol_override": False, "penalty": 12.0}
    ok, gates = _day_eval(80, penalty=12.0, context=ctx)
    assert ok is False
    assert gates["decision_score"]["pass"] is False
    assert gates["decision_score"]["value"] == 80
    assert gates["decision_score"]["effective"] == 68.0
    assert gates["decision_score"]["penalty"] == 12.0
    assert gates["session_phase"]["pass"] is False
    assert gates["session_phase"]["in_dead_zone"] is True


def test_penalty_keeps_strong_midday_signal() -> None:
    # s100 92 - 12 = 80 ≥ 72 → a high-conviction midday signal still qualifies.
    ctx = {"in_dead_zone": True, "rvol": 1.0, "rvol_override": False, "penalty": 12.0}
    ok, gates = _day_eval(92, penalty=12.0, context=ctx)
    assert ok is True
    assert gates["decision_score"]["pass"] is True
    assert gates["decision_score"]["effective"] == 80.0
    assert gates["session_phase"]["pass"] is True


def test_rvol_override_records_context_without_penalty() -> None:
    # RVOL surge → penalty 0; the marginal s100 80 signal still qualifies and the
    # decision_score gate is byte-identical to legacy (no effective/penalty keys).
    ctx = {"in_dead_zone": True, "rvol": 3.4, "rvol_override": True, "penalty": 0.0}
    ok, gates = _day_eval(80, penalty=0.0, context=ctx)
    assert ok is True
    assert gates["decision_score"] == {"pass": True, "value": 80}
    assert gates["session_phase"]["pass"] is True
    assert gates["session_phase"]["rvol_override"] is True


def test_threshold_constant_unchanged() -> None:
    assert MIN_ACTIONABLE_SCORE_0_100 == 72
