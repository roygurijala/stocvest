from stocvest.config.signal_parameters import SectorParameters
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


# ---------------------------------------------------------------------------
# D3 — wire-is-live lock-in
# ---------------------------------------------------------------------------
#
# Same outperforming sector+SPY pair through two different
# :class:`SectorParameters` instances: the analyzer must respect the params
# it was passed for both scoring (strong_outperform_score) and verdict
# thresholds (bullish_threshold).


def test_bullish_threshold_param_actually_drives_verdict() -> None:
    """A clear sector outperformance scores bullish at the default
    threshold of 65 but neutralizes when the bullish threshold is 99."""
    sector_snap = _snap("SOXX", 2.0)
    spy_snap = _snap("SPY", 0.5)

    permissive = SectorParameters(bullish_threshold=65, bearish_threshold=35)
    strict = SectorParameters(bullish_threshold=99, bearish_threshold=1)

    r_permissive = SectorAnalyzer().analyze("NVDA", sector_snap, spy_snap, permissive)
    r_strict = SectorAnalyzer().analyze("NVDA", sector_snap, spy_snap, strict)
    assert r_permissive.score == r_strict.score
    assert r_permissive.verdict != r_strict.verdict


def test_strong_outperform_score_param_actually_moves_score() -> None:
    """Halving strong_outperform_score (default 80 -> 60) must lower the
    sector score when relative strength is clearly in the strong-outperform
    band (delta > +1.0%)."""
    sector_snap = _snap("SOXX", 3.0)
    spy_snap = _snap("SPY", 0.5)

    baseline = SectorAnalyzer().analyze("NVDA", sector_snap, spy_snap, SectorParameters())
    weaker = SectorAnalyzer().analyze(
        "NVDA",
        sector_snap,
        spy_snap,
        SectorParameters(strong_outperform_score=60),
    )
    assert baseline.score is not None and weaker.score is not None
    assert baseline.score > weaker.score
