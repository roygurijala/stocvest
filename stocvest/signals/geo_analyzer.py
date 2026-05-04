"""Layer 5 — keyword geopolitical risk from recent market news dicts."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from typing import Any

GEO_HIGH_RISK = (
    "war",
    "invasion",
    "nuclear",
    "missile",
    "military strike",
    "conflict escalat",
    "troops deploy",
    "sanctions imposed",
    "blockade",
    "terror attack",
)
GEO_MEDIUM_RISK = (
    "tariff",
    "trade war",
    "sanctions",
    "tension",
    "military",
    "protest",
    "election uncertainty",
    "instability",
    "dispute",
)
GEO_LOW_RISK = (
    "ceasefire",
    "peace deal",
    "agreement signed",
    "diplomacy",
    "de-escalat",
    "summit",
    "negotiat",
)

_CACHE: dict[str, tuple[float, "GeoLayerResult"]] = {}
_CACHE_TTL_SEC = 30 * 60


@dataclass
class GeoLayerResult:
    status: str
    score: int | None
    verdict: str
    risk_level: str = "low"
    risk_score: float = 0.0
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)


def _digest(articles: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for a in articles[:20]:
        parts.append(str(a.get("title") or ""))
        parts.append(str(a.get("description") or ""))
    return hashlib.sha256("\n".join(parts).encode("utf-8", errors="ignore")).hexdigest()


class GeoAnalyzer:
    def analyze(self, articles: list[dict[str, Any]]) -> GeoLayerResult:
        digest = _digest(articles)
        now = time.monotonic()
        hit = _CACHE.get(digest)
        if hit and (now - hit[0]) < _CACHE_TTL_SEC:
            return hit[1]

        if not articles:
            result = GeoLayerResult(
                status="available",
                score=60,
                verdict="bullish",
                risk_level="low",
                risk_score=0.0,
                reasoning="No headlines — geo risk assumed low.",
                chips=["Geo: calm"],
            )
            _CACHE[digest] = (now, result)
            return result

        high = medium = low = 0
        scanned = articles[:20]
        for art in scanned:
            if not isinstance(art, dict):
                continue
            text = f"{art.get('title','')} {art.get('description','')}".lower()
            if any(k in text for k in GEO_HIGH_RISK):
                high += 1
            elif any(k in text for k in GEO_MEDIUM_RISK):
                medium += 1
            elif any(k in text for k in GEO_LOW_RISK):
                low += 1

        risk_points = high * 3 + medium * 1 - low * 0.5
        if risk_points >= 3:
            level = "high"
            score = 25
        elif risk_points >= 1:
            level = "medium"
            score = 50
        else:
            level = "low"
            score = 65

        if score >= 60:
            verdict = "bullish"
        elif score <= 35:
            verdict = "bearish"
        else:
            verdict = "neutral"

        result = GeoLayerResult(
            status="available",
            score=score,
            verdict=verdict,
            risk_level=level,
            risk_score=float(risk_points),
            reasoning=f"Geo risk {level} from {len(scanned)} articles (score index {risk_points:.1f}).",
            chips=[f"Geo {level}", f"H/M/L hits {high}/{medium}/{low}"],
        )
        _CACHE[digest] = (now, result)
        return result


def clear_geo_cache() -> None:
    _CACHE.clear()
