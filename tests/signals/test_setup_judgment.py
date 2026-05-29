"""Setup judgment — quality vs tradeability."""

from __future__ import annotations

from stocvest.signals.setup_judgment import build_setup_judgment
from stocvest.signals.swing_technical_analyzer import SwingTechnicalLayerResult


def _bullish_layer(lid: str, score: int = 70) -> dict:
    return {
        "layer": lid,
        "status": "available",
        "score": score,
        "verdict": "bullish",
    }


def test_process_uses_alignment_ratio_for_display_count() -> None:
    layers = [_bullish_layer(lid) for lid in ("technical", "news", "macro", "sector")]
    layers.append({"layer": "geopolitical", "status": "available", "score": 40, "verdict": "neutral"})
    layers.append({"layer": "internals", "status": "available", "score": 35, "verdict": "bearish"})
    j = build_setup_judgment(
        mode="swing",
        layers=layers,
        signal_summary="bullish",
        alignment_ratio=0.83,
    )
    assert j["process"]["layers_aligned"] == 5
    assert j["process"]["tier"] == "actionable"


def test_near_ready_process_with_missing_layers() -> None:
    layers = [_bullish_layer(lid) for lid in ("technical", "news", "macro", "sector")]
    layers.append({"layer": "geopolitical", "status": "available", "score": 40, "verdict": "neutral"})
    layers.append({"layer": "internals", "status": "available", "score": 35, "verdict": "bearish"})
    j = build_setup_judgment(
        mode="swing",
        layers=layers,
        signal_summary="bullish",
        alignment_ratio=0.65,
    )
    assert j["process"]["tier"] == "near_ready"
    assert j["process"]["layers_aligned"] == 4
    assert j["primary_blocker"] is not None
    assert "Missing alignment" in j["primary_blocker"]


def test_extended_rsi_weak_tradeability() -> None:
    layers = [_bullish_layer(lid) for lid in ("technical", "news", "macro", "sector", "geopolitical", "internals")]
    tech = SwingTechnicalLayerResult(
        status="available",
        score=75,
        verdict="bullish",
        sma50=100.0,
        daily_rsi=78.0,
    )
    j = build_setup_judgment(
        mode="swing",
        layers=layers,
        signal_summary="bullish",
        tech_result=tech,
        bars=[],
    )
    assert j["setup_phase"]["id"] == "extended"
    assert j["tradeability"]["band"] == "weak"
    assert any(f["id"] == "rsi_extended" for f in j["tradeability"]["flags"])


def test_strong_tradeability_early_phase() -> None:
    layers = [_bullish_layer(lid) for lid in ("technical", "news", "macro", "sector", "geopolitical", "internals")]
    tech = SwingTechnicalLayerResult(
        status="available",
        score=72,
        verdict="bullish",
        sma50=100.0,
        daily_rsi=55.0,
    )
    j = build_setup_judgment(
        mode="swing",
        layers=layers,
        signal_summary="bullish",
        tech_result=tech,
    )
    assert j["setup_phase"]["id"] == "early"
    assert j["tradeability"]["band"] == "strong"
    assert j["primary_blocker"] is None
