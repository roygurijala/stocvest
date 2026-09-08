"""Types for Position fundamentals layer (POS-D2)."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal

PillarId = Literal["F1", "F2", "F3", "F4", "F5"]
PillarVerdict = Literal["bullish", "neutral", "bearish"]

PILLAR_LABELS: dict[PillarId, str] = {
    "F1": "Profitability & quality",
    "F2": "Growth",
    "F3": "Balance sheet & solvency",
    "F4": "Valuation",
    "F5": "Earnings quality & consistency",
}

# v1 weights (F1–F5 only; renormalized when a pillar is unavailable).
PILLAR_WEIGHTS: dict[PillarId, float] = {
    "F1": 20.0,
    "F2": 20.0,
    "F3": 20.0,
    "F4": 15.0,
    "F5": 15.0,
}

PILLAR_BULLISH_THRESHOLD = 62
PILLAR_BEARISH_THRESHOLD = 38


@dataclass
class PositionPillarResult:
    pillar_id: PillarId
    label: str
    weight: float
    status: str
    score: int | None
    verdict: PillarVerdict
    reasoning: str
    chips: list[str] = field(default_factory=list)
    data_quality: str = "unavailable"
    as_of_date: date | None = None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "pillar_id": self.pillar_id,
            "label": self.label,
            "weight": self.weight,
            "status": self.status,
            "score": self.score,
            "verdict": self.verdict,
            "reasoning": self.reasoning,
            "chips": list(self.chips),
            "data_quality": self.data_quality,
            "as_of_date": self.as_of_date.isoformat() if self.as_of_date else None,
        }


@dataclass
class PositionFundamentalsLayerResult:
    """LayerResult-compatible aggregate for the Position Fundamentals layer."""

    status: str
    score: int | None
    verdict: PillarVerdict
    reasoning: str
    chips: list[str] = field(default_factory=list)
    pillars: list[PositionPillarResult] = field(default_factory=list)
    data_quality: str = "unavailable"
    weakest_pillar_id: PillarId | None = None

    def to_api_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "score": self.score,
            "verdict": self.verdict,
            "reasoning": self.reasoning,
            "chips": list(self.chips),
            "data_quality": self.data_quality,
            "weakest_pillar_id": self.weakest_pillar_id,
            "pillars": [p.to_api_dict() for p in self.pillars],
        }
