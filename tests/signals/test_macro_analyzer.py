from stocvest.config.signal_parameters import MacroParameters
from stocvest.data.models import EconomicCalendarEvent
from stocvest.signals.macro_analyzer import MacroAnalyzer

from tests.signals.conftest import make_qqq_snapshot, make_spy_snapshot, make_vix_snapshot, mock_parameter_store


def test_bull_conditions_high_score(mock_parameter_store) -> None:
    m = MacroAnalyzer().analyze(
        make_spy_snapshot(1.0),
        make_qqq_snapshot(1.5),
        make_vix_snapshot(13.0, -1.0),
        [],
        mock_parameter_store.macro,
    )
    assert m.score is not None and m.score >= 60
    assert m.market_regime in ("risk_on", "neutral")


def test_vix_unavailable_no_crash(mock_parameter_store) -> None:
    m = MacroAnalyzer().analyze(make_spy_snapshot(0.5), make_qqq_snapshot(0.5), None, [], mock_parameter_store.macro)
    assert m.status == "available"
    assert m.score is not None


def test_sharp_selloff_calm_vix_registers_risk_off(mock_parameter_store) -> None:
    """Regression: an orderly-but-sharp selloff (SPY -2.6%, QQQ -5.4%) with a
    non-extreme VIX must register as risk_off, not neutral. This is the live
    scenario the momentum-weight (0.45) + risk_off ceiling (45) tuning targets."""
    m = MacroAnalyzer().analyze(
        make_spy_snapshot(-2.6),
        make_qqq_snapshot(-5.4),
        make_vix_snapshot(15.4, 8.0),
        [],
        mock_parameter_store.macro,
    )
    assert m.status == "available"
    assert m.score is not None and m.score <= 45
    assert m.market_regime == "risk_off"


def test_fomc_reduces_score(mock_parameter_store) -> None:
    ev = [EconomicCalendarEvent(time_et="14:00", event_name="FOMC statement", impact="high")]
    m = MacroAnalyzer().analyze(
        make_spy_snapshot(0.5),
        make_qqq_snapshot(0.5),
        make_vix_snapshot(16.0, 0.0),
        ev,
        mock_parameter_store.macro,
    )
    assert m.event_today is True


# ---------------------------------------------------------------------------
# D3 — wire-is-live lock-in
# ---------------------------------------------------------------------------
#
# Identical SPY/QQQ/VIX snapshots through two different :class:`MacroParameters`
# instances: the analyzer must read its scoring from the params it was passed,
# not from hardcoded constants. If MacroAnalyzer is ever refactored to ignore
# the params arg or default-construct internally, these tests fail.


def test_bullish_threshold_param_actually_drives_verdict() -> None:
    """A risk-on snapshot scores bullish under the default 60/40 thresholds
    but flips to neutral when the bullish threshold is bumped to 99."""
    spy = make_spy_snapshot(1.0)
    qqq = make_qqq_snapshot(1.5)
    vix = make_vix_snapshot(13.0, -1.0)

    permissive = MacroParameters(bullish_threshold=60, bearish_threshold=40)
    strict = MacroParameters(bullish_threshold=99, bearish_threshold=1)

    r_permissive = MacroAnalyzer().analyze(spy, qqq, vix, [], permissive)
    r_strict = MacroAnalyzer().analyze(spy, qqq, vix, [], strict)
    assert r_permissive.score == r_strict.score
    assert r_permissive.verdict != r_strict.verdict


# ---------------------------------------------------------------------------
# Long-horizon (position) desk — structural macro (ADR-004 POS-AI engine fix)
# ---------------------------------------------------------------------------


def test_position_mode_neutralizes_intraday_index_momentum(mock_parameter_store) -> None:
    """The long-horizon desk must not let today's index tape sway macro: a big
    up day and a big down day produce the SAME structural macro score."""
    up = MacroAnalyzer().analyze(
        make_spy_snapshot(2.5),
        make_qqq_snapshot(3.0),
        make_vix_snapshot(16.0, 0.0),
        [],
        mock_parameter_store.macro,
        mode="position",
    )
    down = MacroAnalyzer().analyze(
        make_spy_snapshot(-2.5),
        make_qqq_snapshot(-3.0),
        make_vix_snapshot(16.0, 0.0),
        [],
        mock_parameter_store.macro,
        mode="position",
    )
    assert up.score is not None and up.score == down.score
    assert "Structural (long-horizon)" in up.chips

    # Control: swing/day (default mode) still respond to the intraday tape.
    up_swing = MacroAnalyzer().analyze(
        make_spy_snapshot(2.5), make_qqq_snapshot(3.0), make_vix_snapshot(16.0, 0.0), [], mock_parameter_store.macro
    )
    down_swing = MacroAnalyzer().analyze(
        make_spy_snapshot(-2.5), make_qqq_snapshot(-3.0), make_vix_snapshot(16.0, 0.0), [], mock_parameter_store.macro
    )
    assert up_swing.score != down_swing.score


def test_position_mode_ignores_vix_intraday_change_nudge(mock_parameter_store) -> None:
    """Position reads the structural VIX *level* only — a big intraday VIX swing
    (both at the same level) must not move the score."""
    vix_falling = MacroAnalyzer().analyze(
        make_spy_snapshot(0.0), make_qqq_snapshot(0.0), make_vix_snapshot(16.0, -15.0), [],
        mock_parameter_store.macro, mode="position",
    )
    vix_spiking = MacroAnalyzer().analyze(
        make_spy_snapshot(0.0), make_qqq_snapshot(0.0), make_vix_snapshot(16.0, 15.0), [],
        mock_parameter_store.macro, mode="position",
    )
    assert vix_falling.score is not None and vix_falling.score == vix_spiking.score


def test_vix_score_band_params_actually_move_score() -> None:
    """Halving the low-VIX score (default 80 -> 40) must drop the overall
    macro score when the VIX snapshot sits in the low band."""
    spy = make_spy_snapshot(0.2)
    qqq = make_qqq_snapshot(0.2)
    vix_low = make_vix_snapshot(13.0, 0.0)

    baseline = MacroAnalyzer().analyze(spy, qqq, vix_low, [], MacroParameters())
    halved = MacroAnalyzer().analyze(
        spy, qqq, vix_low, [], MacroParameters(vix_low_score=40)
    )
    assert baseline.score is not None and halved.score is not None
    assert baseline.score > halved.score
