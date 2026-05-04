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
