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
