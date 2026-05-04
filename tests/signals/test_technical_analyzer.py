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


def test_orb_insufficient_bars(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", make_bars(10), make_snapshot(), mock_parameter_store.technical)
    assert r.orb_signal == "insufficient"


def test_orb_expired_after_10am(mock_parameter_store) -> None:
    ta = TechnicalAnalyzer()
    r = ta.analyze("T", make_bars(31), make_snapshot(), mock_parameter_store.technical)
    assert r.orb_signal == "expired"


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
