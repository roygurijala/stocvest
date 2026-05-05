"""Unit tests for swing composite evidence enrichment fields."""

from __future__ import annotations

from stocvest.api.services.swing_composite_evidence import build_swing_composite_evidence_fields
from stocvest.signals.composite_score import CompositeScoreEngine, CompositeVerdict, LayerSignal


def _composite(signals: list[LayerSignal], regime: str = "bull"):
    return CompositeScoreEngine().compute(signals, regime=regime)


def test_evidence_fields_strong_uptrend_bull_regime() -> None:
    comp = _composite(
        [
            LayerSignal(layer="technical", score=0.8, confidence=0.9),
            LayerSignal(layer="news", score=0.6, confidence=0.85),
            LayerSignal(layer="macro", score=0.5, confidence=0.8),
        ],
        "bull",
    )
    assert comp.verdict == CompositeVerdict.BULLISH
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="bull",
        payload={"symbol": "SPY", "news_catalyst": {"headline": "Macro tailwind", "sentiment": "positive"}},
        confluence={"confirming_signals": [], "conflicting_signals": [], "n_confirming": 2, "n_conflicting": 0},
        snapshot={"last_trade_price": 500.0, "day_low": 495.0, "day_high": 505.0, "day_vwap": 499.0},
    )
    assert fields["trend_direction"] == "Uptrend"
    assert fields["market_regime"] == "Bullish"
    assert fields["trend_strength"] == "Strong"
    assert len(fields["catalysts"]) >= 1
    assert fields.get("vwap") == 499.0


def test_evidence_fields_neutral_regime_label() -> None:
    comp = _composite(
        [
            LayerSignal(layer="technical", score=0.05, confidence=0.8),
            LayerSignal(layer="news", score=-0.02, confidence=0.8),
            LayerSignal(layer="macro", score=0.0, confidence=0.8),
        ],
        "sideways",
    )
    assert comp.verdict == CompositeVerdict.NEUTRAL
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="sideways",
        payload={"symbol": "QQQ"},
        confluence={"confirming_signals": [], "conflicting_signals": [{"label": "A"}, {"label": "B"}], "n_confirming": 1, "n_conflicting": 2},
        snapshot={"last_trade_price": 400.0},
    )
    assert fields["market_regime"] == "Neutral"
    assert fields["trend_strength"] == "Weak"
