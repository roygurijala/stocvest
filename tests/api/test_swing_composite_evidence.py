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


def test_swing_range_zone_from_daily_bars() -> None:
    comp = _composite(
        [
            LayerSignal(layer="technical", score=0.8, confidence=0.9),
            LayerSignal(layer="news", score=0.6, confidence=0.85),
            LayerSignal(layer="macro", score=0.5, confidence=0.8),
        ],
        "bull",
    )
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="bull",
        payload={
            "symbol": "AMZN",
            "daily_bars_range": [
                {"low": 262.0, "high": 269.0},
                {"low": 265.0, "high": 272.0},
                {"low": 267.0, "high": 274.0},
                {"low": 268.0, "high": 276.0},
            ],
        },
        confluence={"confirming_signals": [], "conflicting_signals": [], "n_confirming": 2, "n_conflicting": 0},
        snapshot={"last_trade_price": 272.0, "day_low": 269.64, "day_high": 274.75, "day_vwap": 271.0},
    )
    assert fields.get("swing_range_zone") is not None
    assert fields["swing_range_zone"]["low"] == 262.0
    assert fields["swing_range_zone"]["high"] == 276.0
    assert fields.get("reference_stop_provenance")
    assert "session" in str(fields["reference_stop_provenance"]).lower() or "vwap" in str(
        fields["reference_stop_provenance"]
    ).lower()


def test_resistance_scanner_anchors_t2_above_session_high() -> None:
    comp = _composite(
        [
            LayerSignal(layer="technical", score=0.8, confidence=0.9),
            LayerSignal(layer="news", score=0.6, confidence=0.85),
            LayerSignal(layer="macro", score=0.5, confidence=0.8),
        ],
        "bull",
    )
    highs = [98.0, 99.0, 100.0, 101.0, 102.0, 103.0, 104.0, 105.0, 106.0, 107.0, 108.0, 109.0, 110.0, 111.0, 112.0, 111.0, 110.0, 109.0, 108.0]
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="bull",
        payload={
            "symbol": "TEST",
            "daily_bars_range": [{"low": h - 2.0, "high": h} for h in highs],
        },
        confluence={"confirming_signals": [], "conflicting_signals": [], "n_confirming": 2, "n_conflicting": 0},
        snapshot={"last_trade_price": 100.0, "day_low": 98.0, "day_high": 105.0, "day_vwap": 101.0},
    )
    assert fields.get("reference_target_1") == 105.0
    assert fields.get("reference_target_2") == 112.0
    assert fields.get("reference_target_2_provenance") == "resistance"


def test_catalyst_headlines_preserve_source_and_scores() -> None:
    comp = _composite(
        [
            LayerSignal(layer="technical", score=0.8, confidence=0.9),
            LayerSignal(layer="news", score=0.6, confidence=0.85),
            LayerSignal(layer="macro", score=0.5, confidence=0.8),
        ],
        "bull",
    )
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="bull",
        payload={
            "symbol": "SPY",
            "catalyst_headlines": [
                {
                    "text": "Fed holds rates steady",
                    "source": "polygon",
                    "published_at": "2026-01-15T14:00:00.000Z",
                    "sentiment_score": 0.72,
                    "sentiment": "positive",
                }
            ],
        },
        confluence={"confirming_signals": [], "conflicting_signals": [], "n_confirming": 2, "n_conflicting": 0},
        snapshot={"last_trade_price": 500.0, "day_low": 495.0, "day_high": 505.0, "day_vwap": 499.0},
    )
    cat = fields["catalysts"][0]
    assert cat["text"].startswith("Fed holds")
    assert cat.get("source") == "polygon"
    assert cat.get("published_at") == "2026-01-15T14:00:00.000Z"
    assert cat.get("sentiment_score") == 0.72


def _bull_comp():
    return _composite(
        [
            LayerSignal(layer="technical", score=0.8, confidence=0.9),
            LayerSignal(layer="news", score=0.6, confidence=0.85),
            LayerSignal(layer="macro", score=0.5, confidence=0.8),
        ],
        "bull",
    )


def test_v3_breakout_t1_uses_atr_floor_not_glued_to_entry() -> None:
    # Price at high of day, no daily high above entry -> v3 lifts T1 to entry + alpha*ATR
    # (swing alpha 1.5, ATR 2 -> 103) instead of gluing T1 to the session high (the old bug).
    comp = _bull_comp()
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="bull",
        payload={
            "symbol": "BRK",
            "atr": 2.0,
            "daily_bars_range": [{"low": h - 2.0, "high": h} for h in (96.0, 97.0, 98.0, 99.0, 100.0)],
        },
        confluence={"confirming_signals": [], "conflicting_signals": [], "n_confirming": 2, "n_conflicting": 0},
        snapshot={"last_trade_price": 100.0, "day_low": 98.0, "day_high": 100.0, "day_vwap": 99.0},
    )
    assert fields["reference_target_1"] == 103.0
    assert fields["reference_target_1_distance_atr"] == 1.5
    assert fields["reference_stop_distance_atr"] is not None
    # T2 is an honest unanchored projection (no structural resistance above), never "resistance".
    assert fields["reference_target_2_provenance"] in {"atr_extension", "2r_extension"}


def test_v3_excludes_analyst_target_from_gated_t2() -> None:
    # An analyst PT (130, inside the 40% cap) must NOT become a "resistance" T2 under v3.
    comp = _bull_comp()
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="bull",
        payload={
            "symbol": "CYTK",
            "atr": 2.0,
            "analyst_target_levels": [130.0],
            "daily_bars_range": [{"low": h - 2.0, "high": h} for h in (96.0, 97.0, 98.0, 99.0, 100.0)],
        },
        confluence={"confirming_signals": [], "conflicting_signals": [], "n_confirming": 2, "n_conflicting": 0},
        snapshot={"last_trade_price": 100.0, "day_low": 98.0, "day_high": 100.0, "day_vwap": 99.0},
    )
    assert fields["reference_target_2_provenance"] != "resistance"
    assert fields["reference_target_2"] != 130.0
    assert fields["reference_target_2"] < 120.0
    # Analyst level remains visible as informational context.
    assert fields["analyst_target_levels"] == [130.0]


def test_v3_distance_atr_none_without_atr() -> None:
    # No ATR in payload -> v3 inert (falls back to v2/legacy), distance fields are None, no crash.
    comp = _bull_comp()
    fields = build_swing_composite_evidence_fields(
        composite=comp,
        regime="bull",
        payload={"symbol": "AAA"},
        confluence={"confirming_signals": [], "conflicting_signals": [], "n_confirming": 2, "n_conflicting": 0},
        snapshot={"last_trade_price": 100.0, "day_low": 98.0, "day_high": 102.0, "day_vwap": 99.0},
    )
    assert fields["reference_target_1_distance_atr"] is None
    assert fields["reference_target_2_distance_atr"] is None
    assert fields["reference_stop_distance_atr"] is None
