"""Layer 5 — keyword geopolitical risk from recent market news dicts."""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.signals.geo_sector_impact import (
    detect_geo_event_scores,
    deterministic_geo_exposure_summary,
    geo_event_details_for_sector,
    geo_exposure_band,
    normalize_sector_for_geo,
    weighted_stock_geo_score,
)

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
    #: Articles in the scan window whose text matched ``GEO_HIGH_RISK`` keywords (same count as the
    #: first figure in chip ``H/M/L hits H/M/L``). Exposed as ``geo_high_impact_count`` on composite payloads.
    high_impact_count: int = 0
    geo_active_events: list[dict[str, Any]] = field(default_factory=list)
    geo_impact_sector_key: str = ""
    geo_stock_exposure_score: float | None = None
    geo_exposure_summary: str | None = None
    geo_event_details: list[dict[str, Any]] = field(default_factory=list)
    geo_exposure_band: str = ""


def _digest(articles: list[dict[str, Any]], sector_bucket: str | None) -> str:
    parts: list[str] = []
    for a in articles[:20]:
        parts.append(str(a.get("title") or ""))
        parts.append(str(a.get("description") or ""))
    parts.append(str(sector_bucket or ""))
    return hashlib.sha256("\n".join(parts).encode("utf-8", errors="ignore")).hexdigest()


class GeoAnalyzer:
    def analyze(
        self,
        articles: list[dict[str, Any]],
        *,
        lookback_hours: int = 8,
        sector_bucket: str | None = None,
    ) -> GeoLayerResult:
        now_utc = datetime.now(timezone.utc)
        cutoff = now_utc - timedelta(hours=float(lookback_hours))
        filtered: list[dict[str, Any]] = []
        for a in articles:
            if not isinstance(a, dict):
                continue
            pr = a.get("published_utc")
            try:
                pub = datetime.fromisoformat(str(pr).replace("Z", "+00:00"))
                if pub.tzinfo is None:
                    pub = pub.replace(tzinfo=timezone.utc)
            except (TypeError, ValueError):
                filtered.append(a)
                continue
            if pub.astimezone(timezone.utc) >= cutoff:
                filtered.append(a)
        articles = filtered

        digest = _digest(articles, sector_bucket)
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
                high_impact_count=0,
                geo_active_events=[],
                geo_impact_sector_key="",
                geo_stock_exposure_score=None,
                geo_exposure_summary=None,
                geo_event_details=[],
                geo_exposure_band="",
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

        geo_events = detect_geo_event_scores(
            scanned, high_kw=GEO_HIGH_RISK, med_kw=GEO_MEDIUM_RISK, low_kw=GEO_LOW_RISK
        )
        impact_key = normalize_sector_for_geo(sector_bucket) if sector_bucket else ""
        w_geo = (
            weighted_stock_geo_score(geo_events, impact_key)
            if geo_events and impact_key and impact_key != "default"
            else 0.0
        )
        exposure_line = deterministic_geo_exposure_summary(
            events=geo_events, impact_sector_key=impact_key or "default", weighted_score=w_geo
        )
        event_details = (
            geo_event_details_for_sector(geo_events, impact_key) if geo_events and impact_key else []
        )
        band = ""
        if geo_events and impact_key:
            band = geo_exposure_band(w_geo) if w_geo > 0 else "low"
        chips = [f"Geo {level}", f"H/M/L hits {high}/{medium}/{low}"]
        if geo_events:
            theme_bits = [e.get("event_type", "?").replace("_", " ") for e in geo_events]
            chips.append(f"Themes: {', '.join(theme_bits)}")

        result = GeoLayerResult(
            status="available",
            score=score,
            verdict=verdict,
            risk_level=level,
            risk_score=float(risk_points),
            reasoning=f"Geo risk {level} from {len(scanned)} articles (score index {risk_points:.1f}).",
            chips=chips,
            high_impact_count=high,
            geo_active_events=geo_events,
            geo_impact_sector_key=impact_key,
            geo_stock_exposure_score=w_geo if geo_events and impact_key else None,
            geo_exposure_summary=exposure_line,
            geo_event_details=event_details,
            geo_exposure_band=band,
        )
        _CACHE[digest] = (now, result)
        return result


def clear_geo_cache() -> None:
    _CACHE.clear()
