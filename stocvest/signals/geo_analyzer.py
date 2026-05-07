"""Layer 5 — geopolitical risk: structural baseline (themes + sector) plus headline-driven events."""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.signals.geo_sector_impact import (
    detect_geo_event_scores,
    deterministic_geo_exposure_summary,
    geo_event_details_for_sector,
    geo_exposure_band as geo_stock_exposure_band,
    normalize_sector_for_geo,
    weighted_stock_geo_score,
)
from stocvest.workers.geo_themes_updater import get_cached_themes

GEO_HIGH_RISK_KW = (
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
GEO_MEDIUM_RISK_KW = (
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
GEO_LOW_RISK_KW = (
    "ceasefire",
    "peace deal",
    "agreement signed",
    "diplomacy",
    "de-escalat",
    "summit",
    "negotiat",
)

GEO_HIGH_RISK = GEO_HIGH_RISK_KW
GEO_MEDIUM_RISK = GEO_MEDIUM_RISK_KW
GEO_LOW_RISK = GEO_LOW_RISK_KW

_CACHE: dict[str, tuple[float, "GeoLayerResult"]] = {}
_CACHE_TTL_SEC = 30 * 60


def _digest(articles: list[dict[str, Any]], sector_bucket: str | None, theme_sig: str) -> str:
    parts: list[str] = []
    for a in articles[:20]:
        parts.append(str(a.get("title") or ""))
        parts.append(str(a.get("description") or ""))
    parts.append(str(sector_bucket or ""))
    parts.append(theme_sig)
    return hashlib.sha256("\n".join(parts).encode("utf-8", errors="ignore")).hexdigest()


def compute_geo_baseline(sector_bucket: str, active_themes: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Structural geo exposure from sector + active themes (no news articles required).
    Returns baseline_score / exposure_band per product spec (higher baseline_score = greater sensitivity).
    """
    from stocvest.signals.geo_sector_impact import GEO_SECTOR_IMPACT

    sector_key = normalize_sector_for_geo(sector_bucket)
    sector_display = sector_key.replace("_", " ").title() if sector_key else "General"

    if not active_themes:
        return {
            "baseline_score": 15,
            "exposure_band": "Low",
            "max_weight": 1.0,
            "primary_theme": None,
            "baseline_summary": (
                f"{sector_display} sector — no active geo themes detected. Baseline monitoring active."
            ),
        }

    max_weight = -1.0
    primary_theme: dict[str, Any] = active_themes[0]

    for theme in active_themes:
        theme_key = str(theme.get("key", "") or "").strip()
        sector_weights = GEO_SECTOR_IMPACT.get(theme_key, {})
        weight = float(sector_weights.get(sector_key, 1.0))
        if weight > max_weight:
            max_weight = weight
            primary_theme = theme

    if max_weight < 0:
        max_weight = 1.0

    baseline_score = min(100, int(round(20 + (max_weight * 22))))

    if baseline_score >= 60:
        band = "High"
    elif baseline_score >= 35:
        band = "Moderate"
    else:
        band = "Low"

    theme_name = str(primary_theme.get("display_name", "geopolitical situation")).strip()
    description = str(primary_theme.get("description", "")).strip()

    summary = (f"{sector_display} sector carries {max_weight}x sensitivity to {theme_name}. {description}").strip()

    return {
        "baseline_score": baseline_score,
        "exposure_band": band,
        "max_weight": max_weight,
        "primary_theme": primary_theme.get("key") if isinstance(primary_theme.get("key"), str) else None,
        "baseline_summary": summary,
    }


def detect_geo_events(
    articles: list[dict[str, Any]],
    active_themes: list[dict[str, Any]],  # noqa: ARG001 — reserved for theme-weighted narrowing
) -> list[dict[str, Any]]:
    del active_themes
    return detect_geo_event_scores(
        articles,
        high_kw=GEO_HIGH_RISK_KW,
        med_kw=GEO_MEDIUM_RISK_KW,
        low_kw=GEO_LOW_RISK_KW,
    )


def compute_event_score(events: list[dict[str, Any]], sector_bucket: str | None) -> int:
    if not events:
        return 0
    ik = normalize_sector_for_geo(sector_bucket or "default") if sector_bucket else "default"
    w = weighted_stock_geo_score(events, ik)
    raw_points = sum(float(ev.get("score") or 0.0) for ev in events)
    if ik and ik != "default" and w > 0:
        return min(100, max(20, int(22 + w * 6)))
    if raw_points > 0:
        return min(100, max(45, int(52 + raw_points * 14)))
    return min(100, max(20, int(22 + w * 6)))


def build_event_summary(baseline: dict[str, Any], events: list[dict[str, Any]]) -> str:
    head = str(baseline.get("baseline_summary") or "").strip()
    if not events:
        return head
    top = events[0]
    et = str(top.get("event_type", "")).replace("_", " ").strip()
    suffix = f" Headlines flagged {et} in the scan window." if et else ""
    return f"{head}{suffix}".strip()


def _composite_sentiment_score_from_geo_risk(risk_0_100: int) -> int:
    return max(5, min(95, int(100 - risk_0_100)))


@dataclass
class GeoLayerResult:
    status: str
    score: int | None
    verdict: str
    risk_level: str = "low"
    risk_score: float = 0.0
    reasoning: str = ""
    chips: list[str] = field(default_factory=list)
    high_impact_count: int = 0
    geo_active_events: list[dict[str, Any]] = field(default_factory=list)
    geo_impact_sector_key: str = ""
    geo_stock_exposure_score: float | None = None
    geo_exposure_summary: str | None = None
    geo_event_details: list[dict[str, Any]] = field(default_factory=list)
    geo_exposure_band: str = ""
    #: Structural baseline (risk scale 0–100; higher = more sensitivity / thematic pressure).
    geo_baseline_score: int = 0
    geo_baseline_summary: str = ""
    geo_has_live_events: bool = False
    geo_primary_theme: str | None = None


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
        articles_scoped = filtered

        themes_payload = get_cached_themes()
        active_raw = themes_payload.get("active_themes", []) if isinstance(themes_payload, dict) else []
        active_themes = [t for t in active_raw if isinstance(t, dict)]
        theme_sig = json.dumps(
            sorted(str(t.get("key", "")) for t in active_themes),
            separators=(",", ":"),
        )[:512]

        digest = _digest(articles_scoped, sector_bucket, theme_sig)
        now_mono = time.monotonic()
        hit = _CACHE.get(digest)
        if hit and (now_mono - hit[0]) < _CACHE_TTL_SEC:
            return hit[1]

        baseline = compute_geo_baseline(sector_bucket or "default", active_themes)

        scanned = articles_scoped[:20]
        high = medium = low = 0
        for art in scanned:
            if not isinstance(art, dict):
                continue
            text = f"{art.get('title','')} {art.get('description','')}".lower()
            if any(k in text for k in GEO_HIGH_RISK_KW):
                high += 1
            elif any(k in text for k in GEO_MEDIUM_RISK_KW):
                medium += 1
            elif any(k in text for k in GEO_LOW_RISK_KW):
                low += 1

        events = detect_geo_events(scanned, active_themes) if scanned else []

        structural_risk = int(baseline["baseline_score"])

        ik = normalize_sector_for_geo(sector_bucket) if sector_bucket else ""

        primary_key = baseline.get("primary_theme")
        primary_label = ""
        if active_themes and primary_key:
            for t in active_themes:
                if str(t.get("key")) == str(primary_key):
                    primary_label = str(t.get("display_name") or "").strip()
                    break

        if events:
            event_risk = compute_event_score(events, sector_bucket)
            final_risk = min(100, int(round(structural_risk * 0.4 + event_risk * 0.6)))
            has_live = True
            summary = build_event_summary(baseline, events)
            risk_points = float(high * 3 + medium * 1 - low * 0.5)
            w_geo = weighted_stock_geo_score(events, ik) if ik and ik != "default" else 0.0
            exposure_line = deterministic_geo_exposure_summary(
                events=events, impact_sector_key=ik or "default", weighted_score=w_geo
            )
            event_details = geo_event_details_for_sector(events, ik) if ik else []
            band_stock = geo_stock_exposure_band(w_geo) if w_geo > 0 else "low"
            band_out = baseline["exposure_band"] if structural_risk >= event_risk else band_stock.title()
            if isinstance(band_out, str) and band_out.islower():
                band_out = band_out.title()
        else:
            final_risk = structural_risk
            has_live = False
            summary = baseline["baseline_summary"]
            risk_points = 0.0
            w_geo = weighted_stock_geo_score(events, ik) if events and ik else 0.0
            exposure_line = summary
            event_details = []
            band_out = str(baseline.get("exposure_band") or "Low")

        composite_score = _composite_sentiment_score_from_geo_risk(final_risk)

        if composite_score >= 60:
            verdict = "bullish"
            level = "low"
        elif composite_score <= 35:
            verdict = "bearish"
            level = "high"
        else:
            verdict = "neutral"
            level = "medium"

        chips = []
        chips.append(f"Geo baseline {baseline['exposure_band']}")
        if has_live:
            chips.extend([f"Geo {level}", f"H/M/L hits {high}/{medium}/{low}"])
        else:
            chips.extend(["Structural exposure", "No geo headlines"])
        sector_short = ik.replace("_", " ").title() if ik else ""
        if sector_short and primary_label:
            chips.append(f"Sectors · {baseline.get('max_weight', 1.0)}x {primary_label}")

        reasoning = summary[:320]

        result = GeoLayerResult(
            status="available",
            score=composite_score,
            verdict=verdict,
            risk_level=level,
            risk_score=risk_points,
            reasoning=reasoning,
            chips=chips,
            high_impact_count=high if has_live else 0,
            geo_active_events=events,
            geo_impact_sector_key=ik or "",
            geo_stock_exposure_score=w_geo if has_live and ik else None,
            geo_exposure_summary=exposure_line if has_live else summary,
            geo_event_details=event_details,
            geo_exposure_band=band_out.lower() if isinstance(band_out, str) else "low",
            geo_baseline_score=structural_risk,
            geo_baseline_summary=baseline["baseline_summary"],
            geo_has_live_events=has_live,
            geo_primary_theme=str(primary_key) if primary_key else None,
        )
        _CACHE[digest] = (now_mono, result)
        return result


def clear_geo_cache() -> None:
    _CACHE.clear()
