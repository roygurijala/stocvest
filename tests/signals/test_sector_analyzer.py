from stocvest.data.models import Snapshot
from stocvest.signals.sector_analyzer import SectorAnalyzer

from tests.signals.conftest import mock_parameter_store


def _snap(sym: str, pct: float) -> Snapshot:
    return Snapshot(symbol=sym, last_trade_price=100.0, change_percent=pct, prev_close=99.0)


def test_outperformance_bullish(mock_parameter_store) -> None:
    s = SectorAnalyzer().analyze(
        "NVDA",
        _snap("SOXX", 2.0),
        _snap("SPY", 0.5),
        mock_parameter_store.sector,
        sector_display_name="Semiconductors",
    )
    assert s.status == "available"
    assert s.score is not None and s.score >= 65


def test_underperformance_bearish(mock_parameter_store) -> None:
    s = SectorAnalyzer().analyze(
        "X",
        _snap("SOXX", -0.5),
        _snap("SPY", 0.8),
        mock_parameter_store.sector,
    )
    assert s.status == "available"
    assert s.score is not None and s.score <= 40


def test_relative_not_absolute(mock_parameter_store) -> None:
    s = SectorAnalyzer().analyze(
        "X",
        _snap("SOXX", -1.0),
        _snap("SPY", -1.0),
        mock_parameter_store.sector,
    )
    assert s.status == "available"
    assert s.score is not None
    assert 40 <= s.score <= 60


def test_sector_snapshot_none_unavailable(mock_parameter_store) -> None:
    s = SectorAnalyzer().analyze("X", None, _snap("SPY", 0.5), mock_parameter_store.sector)
    assert s.status == "unavailable"


def test_spy_proxy_single_chip_and_reasoning(mock_parameter_store) -> None:
    s = SectorAnalyzer().analyze(
        "PINS",
        _snap("SPY", 1.19),
        _snap("SPY", 1.19),
        mock_parameter_store.sector,
        sector_display_name="Broad Market",
    )
    assert s.status == "available"
    assert len(s.chips) == 1
    assert "Broad market (SPY)" in s.chips[0]
    assert "no separate sector ETF" in s.chips[0]
    assert "no distinct sector index" in s.reasoning


def test_non_spy_two_chips(mock_parameter_store) -> None:
    s = SectorAnalyzer().analyze(
        "PINS",
        _snap("XLK", 0.8),
        _snap("SPY", 0.5),
        mock_parameter_store.sector,
    )
    assert s.status == "available"
    assert len(s.chips) == 2
    assert s.chips[0].startswith("XLK")
    assert s.chips[1].startswith("Rel. vs SPY:")
