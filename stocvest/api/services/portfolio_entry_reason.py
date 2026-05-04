"""Human-readable entry reason text from layer analyzer results."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


def build_entry_reason_from_layer_results(layer_results: Sequence[Any]) -> str:
    """
    Build a short entry reason from bullish available layers for display and logging.
    Uses signal-tracking language only (no investment advice phrasing).
    """
    parts: list[str] = []
    for result in layer_results:
        if getattr(result, "status", "") != "available":
            continue
        if getattr(result, "verdict", "") != "bullish":
            continue
        label = type(result).__name__.replace("LayerResult", "")
        reason = (getattr(result, "reasoning", None) or "").strip()[:60]
        if reason:
            parts.append(f"{label}: {reason}")
    return ". ".join(parts[:3]) or "Signal tracked from live layers."

