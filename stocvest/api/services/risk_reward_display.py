"""Display-safe risk/reward values for desk rows and API payloads."""

from __future__ import annotations

from typing import Any


def positive_risk_reward(*values: Any) -> float | None:
    """First finite ratio > 0, rounded to one decimal for cards."""
    for v in values:
        if isinstance(v, (int, float)):
            f = float(v)
            if f == f and f > 0:
                return round(f, 1)
    return None
