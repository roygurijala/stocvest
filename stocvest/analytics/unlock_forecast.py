"""
Unlock forecast — hints for which layers may clear next (Chunk 7).

Display context only. Skips unknowable layers (news, geopolitical).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

from stocvest.models.watchlist import MATURATION_LAYER_KEYS

CompositeBias = Literal["long", "short", "neutral"]

_SECTOR_PERSISTENCE_TARGET = 0.6
_CONFIDENCE_ORDER = {"high": 0, "medium": 1, "low": 2}
_UNKNOWABLE_LAYERS = frozenset({"news", "geopolitical"})


@dataclass(frozen=True)
class UnlockHint:
    layer_name: str
    layer_label: str
    distance_description: str
    trigger_condition: str
    estimated_sessions: int | None
    confidence: str
    is_primary_blocker: bool = False


def composite_bias_from_summary(signal_summary: str) -> CompositeBias:
    s = (signal_summary or "").strip().lower()
    if s == "bullish":
        return "long"
    if s == "bearish":
        return "short"
    return "neutral"


def _layer_row_available(row: dict[str, Any]) -> bool:
    if str(row.get("status") or "").strip().lower() == "unavailable":
        return False
    return row.get("score") is not None


def _layer_aligned(row: dict[str, Any], *, composite_bias: CompositeBias) -> bool:
    if not _layer_row_available(row):
        return False
    if composite_bias == "neutral":
        return True
    verdict = str(row.get("verdict") or "neutral").strip().lower()
    if composite_bias == "long":
        return verdict == "bullish"
    if composite_bias == "short":
        return verdict == "bearish"
    return False


def derive_missing_layers(
    layers: list[dict[str, Any]],
    *,
    composite_bias: CompositeBias,
) -> list[str]:
    """Layers not aligned with the composite bias (same contract as watchlist maturation)."""
    by_layer = {str(row.get("layer") or "").strip().lower(): row for row in layers if isinstance(row, dict)}
    missing: list[str] = []
    for lid in MATURATION_LAYER_KEYS:
        row = by_layer.get(lid)
        if row is None or not _layer_aligned(row, composite_bias=composite_bias):
            missing.append(lid)
    return missing


def _sector_hint(row: dict[str, Any], *, composite_bias: CompositeBias) -> UnlockHint | None:
    persistence = float(row.get("sector_persistence") or 0.0)
    target = _SECTOR_PERSISTENCE_TARGET
    if composite_bias == "short":
        target = 1.0 - _SECTOR_PERSISTENCE_TARGET
    gap = max(0.0, target - persistence) if composite_bias == "long" else max(0.0, persistence - target)
    if gap <= 0.05:
        sessions: int | None = 1
        confidence = "high"
        distance = "Sector persistence is near the alignment threshold."
    elif gap <= 0.15:
        sessions = 2
        confidence = "high"
        distance = f"Sector persistence {persistence:.2f} — about {gap:.2f} below target."
    else:
        sessions = max(2, int(round(gap / 0.05)))
        confidence = "medium"
        distance = f"Sector persistence {persistence:.2f} — needs several more leading sessions."
    etf = str(row.get("sector_etf") or row.get("sector_display_name") or "sector ETF")
    return UnlockHint(
        layer_name="sector",
        layer_label="Sector",
        distance_description=distance,
        trigger_condition=f"{etf} relative strength holds while persistence reaches {target:.1f}.",
        estimated_sessions=sessions,
        confidence=confidence,
    )


def _macro_hint(row: dict[str, Any]) -> UnlockHint | None:
    events = row.get("upcoming_events") or []
    if not isinstance(events, list) or not events:
        return UnlockHint(
            layer_name="macro",
            layer_label="Macro",
            distance_description="No high-impact macro events in the current window.",
            trigger_condition="Macro regime stays stable without new high-impact releases.",
            estimated_sessions=None,
            confidence="medium",
        )
    first = events[0] if isinstance(events[0], dict) else {}
    hours = float(first.get("hours_until") or 0.0)
    sessions = max(1, int(round(hours / 6.5))) if hours > 0 else 1
    name = str(first.get("name") or "Macro event")
    confidence = "high" if hours <= 24 else "medium"
    return UnlockHint(
        layer_name="macro",
        layer_label="Macro",
        distance_description=f"{name} in ~{hours:.0f}h ({sessions} session(s)).",
        trigger_condition="After the release, macro layer can be re-evaluated for alignment.",
        estimated_sessions=sessions,
        confidence=confidence,
    )


def _internals_hint(row: dict[str, Any], *, composite_bias: CompositeBias) -> UnlockHint | None:
    breadth = str(row.get("breadth_signal") or "unknown")
    participation = str(row.get("participation") or "unknown")
    if composite_bias == "long":
        trigger = "SPY breadth turns up with broad participation (SPY and QQQ positive)."
    elif composite_bias == "short":
        trigger = "Breadth weakens with broad risk-off participation."
    else:
        trigger = "Market internals stabilize without mixed participation."
    sessions = 1 if breadth in ("flat", "up", "strong_up") else 2
    confidence = "high" if breadth in ("strong_up", "up") and composite_bias == "long" else "medium"
    return UnlockHint(
        layer_name="internals",
        layer_label="Market internals",
        distance_description=f"Breadth {breadth}, participation {participation}.",
        trigger_condition=trigger,
        estimated_sessions=sessions,
        confidence=confidence,
    )


def _technical_hint(row: dict[str, Any], *, composite_bias: CompositeBias) -> UnlockHint | None:
    score = row.get("score")
    if score is None:
        return None
    verdict = str(row.get("verdict") or "neutral")
    target = "bullish" if composite_bias == "long" else "bearish" if composite_bias == "short" else "neutral"
    return UnlockHint(
        layer_name="technical",
        layer_label="Technical",
        distance_description=f"Technical score {score} ({verdict}).",
        trigger_condition=f"Daily structure shifts to {target} on the swing stack.",
        estimated_sessions=2,
        confidence="medium",
    )


_LAYER_BUILDERS = {
    "sector": lambda row, bias: _sector_hint(row, composite_bias=bias),
    "macro": lambda row, bias: _macro_hint(row),
    "internals": lambda row, bias: _internals_hint(row, composite_bias=bias),
    "technical": lambda row, bias: _technical_hint(row, composite_bias=bias),
}


def compute_unlock_forecast(
    *,
    missing_layers: list[str],
    layer_raw_data: dict[str, dict[str, Any]],
    composite_bias: CompositeBias | None = None,
    signal_summary: str | None = None,
) -> list[UnlockHint]:
    """
    Hints for knowable missing layers only. Sorted: high confidence first, then fewer sessions.
    """
    if not missing_layers:
        return []

    bias = composite_bias
    if bias is None:
        bias = composite_bias_from_summary(signal_summary or "")

    hints: list[UnlockHint] = []
    for lid in missing_layers:
        if lid in _UNKNOWABLE_LAYERS:
            continue
        row = layer_raw_data.get(lid)
        if not isinstance(row, dict):
            continue
        builder = _LAYER_BUILDERS.get(lid)
        if builder is None:
            continue
        hint = builder(row, bias)
        if hint is not None:
            hints.append(hint)

    hints.sort(
        key=lambda h: (
            _CONFIDENCE_ORDER.get(h.confidence, 9),
            h.estimated_sessions if h.estimated_sessions is not None else 99,
        )
    )
    return [
        UnlockHint(
            layer_name=h.layer_name,
            layer_label=h.layer_label,
            distance_description=h.distance_description,
            trigger_condition=h.trigger_condition,
            estimated_sessions=h.estimated_sessions,
            confidence=h.confidence,
            is_primary_blocker=i == 0,
        )
        for i, h in enumerate(hints)
    ]


def unlock_hints_to_api(hints: list[UnlockHint]) -> list[dict[str, Any]]:
    return [asdict(h) for h in hints]
