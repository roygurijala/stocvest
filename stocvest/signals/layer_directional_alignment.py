"""Layer directional counts vs composite consistency (neutral verdict handling)."""

from __future__ import annotations

from typing import Any, Literal

from stocvest.models.watchlist import MATURATION_LAYER_KEYS

LayerVerdict = Literal["bullish", "bearish", "neutral", "unavailable"]


def _normalize_verdict(raw: object) -> LayerVerdict:
    v = str(raw or "").strip().lower()
    if v == "bullish":
        return "bullish"
    if v == "bearish":
        return "bearish"
    if v in ("neutral", "mixed", "as of close"):
        return "neutral"
    return "unavailable"


def count_directional_layers(
    layers: list[dict[str, Any]] | None,
    *,
    total: int = len(MATURATION_LAYER_KEYS),
) -> dict[str, int | str | None]:
    """Count layer verdict buckets and derived alignment metrics.

    - ``directional_aligned``: layers matching the winning bullish/bearish bucket (0 on ties).
    - ``consistency_aligned``: whole-layer count from ``alignment_ratio`` when provided,
      else bullish + bearish + neutral (available) layers — **not** all layers when composite is neutral.
    - ``directional_tilt``: long | short | None when bullish == bearish.
    """
    by_id: dict[str, dict[str, Any]] = {}
    for item in layers or []:
        if not isinstance(item, dict):
            continue
        lid = str(item.get("layer") or "").strip().lower()
        if lid:
            by_id[lid] = item

    bullish = bearish = neutral = unavailable = 0
    for lid in MATURATION_LAYER_KEYS:
        row = by_id.get(lid)
        if row is None:
            unavailable += 1
            continue
        status = str(row.get("status") or "").strip().lower()
        if status == "unavailable" or row.get("score") is None:
            unavailable += 1
            continue
        verdict = _normalize_verdict(row.get("verdict"))
        if verdict == "bullish":
            bullish += 1
        elif verdict == "bearish":
            bearish += 1
        else:
            neutral += 1

    if bullish > bearish:
        directional_aligned = bullish
        directional_tilt: Literal["long", "short"] | None = "long"
    elif bearish > bullish:
        directional_aligned = bearish
        directional_tilt = "short"
    else:
        directional_aligned = 0
        directional_tilt = None

    available = bullish + bearish + neutral
    return {
        "bullish": bullish,
        "bearish": bearish,
        "neutral": neutral,
        "unavailable": unavailable,
        "available": available,
        "directional_aligned": directional_aligned,
        "directional_tilt": directional_tilt,
        "layers_total": total,
        "consistency_aligned": available,
    }


def composite_direction_fields(body: dict[str, Any]) -> dict[str, Any]:
    """API fields: consistency vs directional layer counts for neutral composites."""
    summary = str(body.get("signal_summary") or "").strip().lower()
    bias: Literal["long", "short", "neutral"]
    if summary == "bullish":
        bias = "long"
    elif summary == "bearish":
        bias = "short"
    else:
        bias = "neutral"

    metrics = count_directional_layers(
        body.get("layers") if isinstance(body.get("layers"), list) else None
    )
    from_ratio = body.get("alignment_ratio")
    consistency = metrics["consistency_aligned"]
    if isinstance(from_ratio, (int, float)) and float(from_ratio) == float(from_ratio):
        consistency = max(0, min(len(MATURATION_LAYER_KEYS), round(max(0.0, min(1.0, float(from_ratio))) * 6)))

    directional = int(metrics["directional_aligned"])
    total = len(MATURATION_LAYER_KEYS)
    out: dict[str, Any] = {
        "layers_total": total,
        "consistency_layers_aligned": int(consistency),
        "directional_layers_aligned": directional,
        "layer_verdict_bullish": int(metrics["bullish"]),
        "layer_verdict_bearish": int(metrics["bearish"]),
        "layer_verdict_neutral": int(metrics["neutral"]),
    }
    tilt = metrics.get("directional_tilt")
    if tilt in ("long", "short"):
        out["directional_tilt"] = tilt
    if bias == "neutral":
        out["setup_quality_label"] = "balanced"
    return out
