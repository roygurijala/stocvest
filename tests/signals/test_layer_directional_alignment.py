"""Tests for composite direction vs consistency layer counts."""

from __future__ import annotations

from typing import Any

from stocvest.signals.layer_directional_alignment import (
    composite_direction_fields,
    count_directional_layers,
)
from stocvest.models.watchlist import MATURATION_LAYER_KEYS


def _layer(lid: str, *, verdict: str = "neutral") -> dict[str, Any]:
    return {"layer": lid, "verdict": verdict, "status": "ok", "score": 0.5}


def test_count_directional_all_neutral() -> None:
    layers = [_layer(k) for k in MATURATION_LAYER_KEYS]
    m = count_directional_layers(layers)
    assert m["directional_aligned"] == 0
    assert m["directional_tilt"] is None
    assert m["consistency_aligned"] == 6


def test_count_directional_bullish_plurality() -> None:
    layers = [
        _layer("technical", verdict="bullish"),
        _layer("news", verdict="bullish"),
        _layer("macro", verdict="bullish"),
        _layer("sector", verdict="bullish"),
        _layer("geopolitical", verdict="neutral"),
        _layer("internals", verdict="bearish"),
    ]
    m = count_directional_layers(layers)
    assert m["directional_aligned"] == 4
    assert m["directional_tilt"] == "long"


def test_composite_direction_fields_neutral_with_ratio() -> None:
    body = {
        "signal_summary": "neutral",
        "alignment_ratio": 0.67,
        "layers": [_layer(k) for k in MATURATION_LAYER_KEYS],
    }
    out = composite_direction_fields(body)
    assert out["setup_quality_label"] == "balanced"
    assert out["consistency_layers_aligned"] == 4
    assert out["directional_layers_aligned"] == 0
    assert out["layers_total"] == 6


def test_composite_direction_fields_position_mode_seven_layers() -> None:
    from stocvest.signals.signal_math_contract import POSITION_SIGNAL_LAYERS

    layers = [_layer(k) for k in POSITION_SIGNAL_LAYERS]
    body = {
        "mode": "position",
        "signal_summary": "neutral",
        "alignment_ratio": 0.5,
        "layers": layers,
    }
    out = composite_direction_fields(body)
    assert out["layers_total"] == 7
    assert out["consistency_layers_aligned"] == 4
    assert out["layer_verdict_neutral"] == 7


def test_count_directional_layers_includes_fundamentals_for_position() -> None:
    layers = [
        _layer("fundamentals", verdict="bullish"),
        *[_layer(k) for k in MATURATION_LAYER_KEYS],
    ]
    m = count_directional_layers(layers, mode="position")
    assert m["layers_total"] == 7
    assert m["directional_aligned"] == 1
    assert m["bullish"] == 1
