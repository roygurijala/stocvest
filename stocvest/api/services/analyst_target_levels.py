"""Analyst price targets for structural resistance — Benzinga first, Perplexity fallback."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from stocvest.data.benzinga_client import BenzingaRating


@dataclass(frozen=True)
class AnalystTargetResolution:
    levels: list[float]
    source: str  # "benzinga" | "perplexity" | "none"


def _positive_price(v: Any) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x > 0 else None


def analyst_targets_from_ratings(ratings: Iterable[BenzingaRating]) -> list[float]:
    """Distinct standing analyst price targets from Benzinga ratings rows."""
    out: list[float] = []
    seen: set[float] = set()
    for row in ratings:
        pt = _positive_price(getattr(row, "price_target", None))
        if pt is None:
            continue
        rounded = round(pt, 4)
        if rounded in seen:
            continue
        seen.add(rounded)
        out.append(rounded)
    return out


def analyst_targets_from_payload(payload: dict[str, Any] | None) -> list[float]:
    if not payload:
        return []
    raw = payload.get("analyst_target_levels")
    if not isinstance(raw, list):
        return []
    out: list[float] = []
    seen: set[float] = set()
    for row in raw:
        pt = _positive_price(row)
        if pt is None:
            continue
        rounded = round(pt, 4)
        if rounded in seen:
            continue
        seen.add(rounded)
        out.append(rounded)
    return out


def parse_perplexity_analyst_targets(data: dict[str, Any] | None) -> list[float]:
    """Normalize Perplexity JSON into distinct positive price targets."""
    if not data:
        return []
    out: list[float] = []
    seen: set[float] = set()

    def _add(v: Any) -> None:
        pt = _positive_price(v)
        if pt is None:
            return
        rounded = round(pt, 4)
        if rounded in seen:
            return
        seen.add(rounded)
        out.append(rounded)

    raw_list = data.get("price_targets")
    if isinstance(raw_list, list):
        for row in raw_list:
            _add(row)
    for key in ("price_target_avg", "price_target_high", "price_target_low", "consensus_target"):
        _add(data.get(key))
    return out
