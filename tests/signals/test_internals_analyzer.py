from stocvest.signals.internals_analyzer import InternalsAnalyzer

from tests.signals.conftest import make_qqq_snapshot, make_spy_snapshot, make_vix_snapshot, mock_parameter_store


def test_chips_contain_vix_number(mock_parameter_store) -> None:
    i = InternalsAnalyzer().analyze(
        make_vix_snapshot(18.5, -6.0),
        make_spy_snapshot(0.6),
        make_qqq_snapshot(0.7),
        mock_parameter_store.macro,
    )
    joined = " ".join(i.chips)
    assert "18.5" in joined


def test_vix_unavailable(mock_parameter_store) -> None:
    i = InternalsAnalyzer().analyze(None, make_spy_snapshot(0.5), make_qqq_snapshot(0.5), mock_parameter_store.macro)
    assert i.status == "available"
    assert i.score is not None


def test_position_mode_excludes_intraday_breadth(mock_parameter_store) -> None:
    # ADR-004: position internals = structural VIX regime only; daily breadth/participation
    # are reported as "structural" and must not move the score.
    i = InternalsAnalyzer().analyze(
        make_vix_snapshot(18.5, -6.0),
        make_spy_snapshot(2.0),
        make_qqq_snapshot(2.0),
        mock_parameter_store.macro,
        mode="position",
    )
    assert i.status == "available"
    assert i.breadth_signal == "structural"
    assert i.participation == "structural"
    assert "structural" in i.reasoning.lower()


def test_position_mode_ignores_todays_vix_move(mock_parameter_store) -> None:
    # Same VIX level, opposite daily moves → identical position score (no tactical adjust).
    falling = InternalsAnalyzer().analyze(
        make_vix_snapshot(18.5, -10.0), None, None, mock_parameter_store.macro, mode="position"
    )
    rising = InternalsAnalyzer().analyze(
        make_vix_snapshot(18.5, 10.0), None, None, mock_parameter_store.macro, mode="position"
    )
    assert falling.score == rising.score

    # Day mode still reacts to the daily move (regression guard on the shared path).
    day_falling = InternalsAnalyzer().analyze(
        make_vix_snapshot(18.5, -10.0), None, None, mock_parameter_store.macro
    )
    day_rising = InternalsAnalyzer().analyze(
        make_vix_snapshot(18.5, 10.0), None, None, mock_parameter_store.macro
    )
    assert day_falling.score != day_rising.score


def test_position_mode_vix_unavailable_neutral(mock_parameter_store) -> None:
    i = InternalsAnalyzer().analyze(
        None, make_spy_snapshot(0.5), make_qqq_snapshot(0.5), mock_parameter_store.macro, mode="position"
    )
    assert i.status == "available"
    assert i.score == 50
    assert i.verdict == "neutral"
