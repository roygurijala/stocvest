import pytest

from stocvest.config.signal_parameters import TechnicalParameters
from stocvest.signals.technical_analyzer import TechnicalAnalyzer

from tests.signals.conftest import make_bars, make_snapshot, mock_parameter_store


def test_unavailable_empty_bars(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", [], make_snapshot(), mock_parameter_store.technical)
    assert r.status == "unavailable"
    assert r.score is None
    assert r.verdict == "neutral"


def test_unavailable_below_minimum(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", make_bars(4), make_snapshot(), mock_parameter_store.technical)
    assert r.status == "unavailable"


def test_available_at_minimum(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", make_bars(5), make_snapshot(), mock_parameter_store.technical)
    assert r.status == "available"
    assert r.score is not None


def test_rsi_none_for_insufficient_closes(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    p = mock_parameter_store.technical
    p.rsi_period = 14
    bars = make_bars(14, trend=0.0001)
    r = ta.analyze("T", bars, make_snapshot(), p)
    assert r.rsi is None


def test_vwap_uses_bar_objects_not_snapshot(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    snap = make_snapshot()
    snap = snap.model_copy(update={"day_vwap": 999.0})
    bars = make_bars(20, trend=0.0002)
    r = ta.analyze("T", bars, snap, mock_parameter_store.technical)
    assert r.vwap_from_bars is not None
    assert r.vwap_from_bars != 999.0


def test_vwap_none_when_zero_volume(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    bars = make_bars(20, trend=0.0, volume=0.0)
    r = ta.analyze("T", bars, make_snapshot(), mock_parameter_store.technical)
    assert r.vwap_from_bars is None


def test_orb_forming_during_opening_range(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", make_bars(10), make_snapshot(), mock_parameter_store.technical)
    assert r.orb_signal == "forming"
    assert any("ORB Forming" in c for c in r.chips)


def test_orb_unavailable_after_window_without_store(monkeypatch, mock_parameter_store) -> None:
    monkeypatch.setattr("stocvest.data.orb_store.get_orb_record", lambda *a, **k: None)
    ta = TechnicalAnalyzer()
    # Last bar after 10:00 AM ET (opening range window closed).
    r = ta.analyze("T", make_bars(40), make_snapshot(), mock_parameter_store.technical)
    assert r.orb_signal == "unavailable"
    assert not any("expired" in c.lower() for c in r.chips)


# ---------------------------------------------------------------------------
# D3 — wire-is-live lock-in
# ---------------------------------------------------------------------------
#
# Same uptrending bar window, two different :class:`TechnicalParameters`
# instances differing only in :attr:`bullish_threshold`: the analyzer must
# read the threshold from the params it was passed, not from a hardcoded
# constant. If anyone refactors TechnicalAnalyzer to ignore the params arg
# (or to default-construct TechnicalParameters() internally), this test
# fails. This is the regression guard for the D3 wire from ParameterStore
# through to the layer-1 verdict.


def test_bullish_threshold_param_actually_drives_verdict() -> None:
    """A bullish bar window scores in the bullish zone with the default
    threshold of 65 but neutralizes when the threshold is bumped to 99."""
    ta = TechnicalAnalyzer()
    bars = make_bars(60, trend=0.005)
    snap = make_snapshot(price=bars[-1].close, prev_close=bars[0].close, change_percent=5.0)

    permissive = TechnicalParameters(bullish_threshold=55, bearish_threshold=45)
    r_permissive = ta.analyze("T", bars, snap, permissive)
    assert r_permissive.status == "available"

    strict = TechnicalParameters(bullish_threshold=99, bearish_threshold=1)
    r_strict = ta.analyze("T", bars, snap, strict)
    assert r_strict.status == "available"

    # Both runs see the same bars + snapshot, so the raw score is identical;
    # the verdict differs because the threshold parameter actually drives it.
    assert r_permissive.score == r_strict.score
    assert r_permissive.verdict != r_strict.verdict


def test_vwap_score_delta_param_actually_moves_score() -> None:
    """Bumping the VWAP scoring delta from the default 20 to 0 must shrink
    the absolute distance of the technical score from the neutral 50."""
    ta = TechnicalAnalyzer()
    bars = make_bars(30, trend=0.005)
    snap = make_snapshot(price=bars[-1].close, prev_close=bars[0].close, change_percent=5.0)

    p_default = TechnicalParameters()
    p_no_vwap = TechnicalParameters(vwap_score_delta=0)
    r_default = ta.analyze("T", bars, snap, p_default)
    r_no_vwap = ta.analyze("T", bars, snap, p_no_vwap)
    assert r_default.status == "available" and r_no_vwap.status == "available"
    assert r_default.score is not None and r_no_vwap.score is not None
    assert abs(r_default.score - 50) > abs(r_no_vwap.score - 50)


def test_orb_breakout_long_uses_dynamo_levels(monkeypatch, mock_parameter_store) -> None:
    from stocvest.data.orb_store import ORBRecord

    def _fake_get(sym: str, trade_date=None):
        return ORBRecord(
            trade_date="2026-05-04",
            symbol=sym,
            orb_high=101.0,
            orb_low=99.0,
            orb_range_pct=2.0,
            computed_at="10:00 ET",
        )

    monkeypatch.setattr("stocvest.data.orb_store.get_orb_record", _fake_get)
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", make_bars(40, trend=0.02), make_snapshot(), mock_parameter_store.technical)
    assert r.orb_signal == "breakout_long"
    assert any("ORB Long" in c for c in r.chips)


def test_strong_bullish_vs_bearish_differ(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    bull = ta.analyze("T", make_bars(40, trend=0.002), make_snapshot(), mock_parameter_store.technical)
    bear = ta.analyze("T", make_bars(40, trend=-0.002), make_snapshot(), mock_parameter_store.technical)
    assert bull.score is not None and bear.score is not None
    assert abs(bull.score - bear.score) > 30


def test_reasoning_contains_real_numbers(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", make_bars(30, trend=0.0005), make_snapshot(), mock_parameter_store.technical)
    assert "RSI" in r.reasoning or "VWAP" in r.reasoning or "Technical score" in r.reasoning


def test_rsi_threshold_from_params(monkeypatch, mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    p = mock_parameter_store.technical
    p.rsi_overbought = 75.0

    def fake_rsi(_closes, _period=14):
        return 72.0

    monkeypatch.setattr("stocvest.signals.technical_analyzer._calculate_rsi", fake_rsi)
    bars = make_bars(25, trend=0.0)
    r1 = ta.analyze("T", bars, make_snapshot(), p)

    def fake_rsi2(_closes, _period=14):
        return 76.0

    monkeypatch.setattr("stocvest.signals.technical_analyzer._calculate_rsi", fake_rsi2)
    r2 = ta.analyze("T", bars, make_snapshot(), p)
    assert r1.score is not None and r2.score is not None
    assert r2.score < r1.score
