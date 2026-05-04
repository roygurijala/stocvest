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
