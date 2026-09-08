"""Shared helpers for Position fundamental pillars — pure, no I/O."""

from __future__ import annotations

import statistics
from datetime import date
from typing import Callable, Sequence, TypeVar

from stocvest.data.fundamentals_models import FundamentalsDataQuality, StatementRow
from stocvest.signals.position_fundamentals.types import (
    PILLAR_BEARISH_THRESHOLD,
    PILLAR_BULLISH_THRESHOLD,
    PILLAR_LABELS,
    PILLAR_WEIGHTS,
    PillarId,
    PillarVerdict,
    PositionPillarResult,
)
from stocvest.signals.signal_math_contract import clamp_layer_score

T = TypeVar("T", bound=StatementRow)

# FMP emits some ratio fields as 0–100 and others as 0–1; values above this
# threshold are treated as whole-percent inputs and scaled down.
_PCT_RATE_MAGNITUDE_THRESHOLD = 1.5


def normalize_pct_rate(value: float | None) -> float | None:
    """Normalize ROE, margins, yields — FMP may use 22.5 or 0.225."""
    if value is None:
        return None
    v = float(value)
    if abs(v) > _PCT_RATE_MAGNITUDE_THRESHOLD:
        return v / 100.0
    return v


def normalize_positive_multiple(value: float | None) -> float | None:
    """P/E, P/FCF, EV multiples — must be strictly positive to be meaningful."""
    if value is None:
        return None
    v = float(value)
    if v <= 0:
        return None
    return v


def score_to_verdict(score: float) -> PillarVerdict:
    s = int(round(clamp_layer_score(score)))
    if s >= PILLAR_BULLISH_THRESHOLD:
        return "bullish"
    if s <= PILLAR_BEARISH_THRESHOLD:
        return "bearish"
    return "neutral"


def finalize_pillar_score(base_score: float) -> tuple[int, PillarVerdict]:
    score = int(round(clamp_layer_score(base_score)))
    return score, score_to_verdict(float(score))


def yoy_ratio(current: float | None, prior: float | None) -> float | None:
    """YoY change; returns None when prior is zero or signs flip unreliably."""
    if current is None or prior is None:
        return None
    if prior == 0:
        return None
    # Negative base period makes % change misleading for quality scoring.
    if prior < 0 and current >= 0:
        return None
    if prior > 0 and current < 0:
        return None
    return (current - prior) / abs(prior)


def quarter_offset_value(
    rows: Sequence[T],
    value_fn: Callable[[T], float | None],
    *,
    offset: int = 4,
) -> tuple[float | None, float | None]:
    """Latest value and value ``offset`` quarters back (default YoY)."""
    if len(rows) <= offset:
        return None, None
    latest = value_fn(rows[0])
    prior = value_fn(rows[offset])
    return latest, prior


def series_values(
    rows: Sequence[T],
    value_fn: Callable[[T], float | None],
    *,
    filter_fn: Callable[[float], bool] | None = None,
) -> list[float]:
    out: list[float] = []
    for row in rows:
        val = value_fn(row)
        if val is None:
            continue
        if filter_fn is not None and not filter_fn(val):
            continue
        out.append(val)
    return out


def median_value(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return float(statistics.median(values))


def std_dev(values: Sequence[float]) -> float | None:
    if len(values) < 2:
        return None
    return float(statistics.pstdev(values))


def cagr(start: float, end: float, periods: int) -> float | None:
    if start <= 0 or end <= 0 or periods <= 0:
        return None
    try:
        return (end / start) ** (1.0 / periods) - 1.0
    except (ZeroDivisionError, ValueError, OverflowError):
        return None


def pillar_data_quality(row_count: int) -> FundamentalsDataQuality:
    if row_count >= 8:
        return "high"
    if row_count >= 4:
        return "medium"
    if row_count >= 1:
        return "low"
    return "unavailable"


def unavailable_pillar(
    pillar_id: PillarId,
    *,
    reason: str,
) -> PositionPillarResult:
    return PositionPillarResult(
        pillar_id=pillar_id,
        label=PILLAR_LABELS[pillar_id],
        weight=PILLAR_WEIGHTS[pillar_id],
        status="unavailable",
        score=None,
        verdict="neutral",
        reasoning=reason,
        chips=["Insufficient data"],
        data_quality="unavailable",
    )


def latest_as_of(rows: Sequence[StatementRow]) -> date | None:
    if not rows:
        return None
    return rows[0].as_of_date


def apply_score_delta(base: float, delta: float) -> float:
    return clamp_layer_score(base + delta)


def clamp_non_negative_int(value: int) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return 0
    return max(0, n)


def prioritize_chips(primary: list[str], secondary: list[str], *, limit: int = 6) -> list[str]:
    """Keep critical chips (primary) before informational ones."""
    merged: list[str] = []
    seen: set[str] = set()
    for chip in primary + secondary:
        if chip and chip not in seen:
            seen.add(chip)
            merged.append(chip)
        if len(merged) >= limit:
            break
    return merged
