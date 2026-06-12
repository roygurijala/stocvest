"""Geopolitical event typing, sector impact multipliers, and per-stock exposure scoring.

Layer 1 classification stays keyword-driven in :mod:`geo_analyzer` (H/M/L severity).
This module maps detected headline themes to structured event types and applies
sector-specific weights for Layer 2–3 scoring.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Final

# ── Layer 1 → structured event types (detected from headline text) ─────────
OIL_SUPPLY_DISRUPTION: Final = "oil_supply_disruption"
US_CHINA_TRADE_TENSION: Final = "us_china_trade_tension"
MIDDLE_EAST_CONFLICT: Final = "middle_east_conflict"
CENTRAL_BANK_POLICY: Final = "central_bank_policy"
LATAM_EMERGING_MARKET: Final = "latam_emerging_market"

# Order matters: US/China trade before generic ``war`` (e.g. ``trade war`` headlines).
_EVENT_KEYWORD_ORDER: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        LATAM_EMERGING_MARKET,
        (
            "argentina",
            "milei",
            "argentine peso",
            "peso devaluation",
            "buenos aires",
            "latin america",
            "latam",
            "brazil central bank",
            "brazilian real",
            "mexico peso",
            "emerging market debt",
            "sovereign risk",
            "capital controls",
        ),
    ),
    (
        US_CHINA_TRADE_TENSION,
        (
            "china trade",
            "beijing",
            "taiwan strait",
            "export control",
            "chip ban",
            "cfius",
            "decoupling",
            "u.s.-china",
            "us-china",
            "chinese tariff",
            "trade war",
            "tariffs on chinese",
        ),
    ),
    (
        MIDDLE_EAST_CONFLICT,
        (
            "middle east",
            "gaza",
            "israel",
            "iran",
            "houthi",
            "red sea",
            "syria",
            "lebanon",
            "hezbollah",
            "strait of hormuz",
            "yemen",
            "war escalation",
            "military strike",
        ),
    ),
    (
        OIL_SUPPLY_DISRUPTION,
        (
            "oil supply",
            "opec",
            "crude supply",
            "production cut",
            "oil output",
            "drilling",
            "pipeline",
            "energy supply",
            "oil embargo",
        ),
    ),
    (
        CENTRAL_BANK_POLICY,
        (
            "federal reserve",
            "the fed",
            "fomc",
            "jerome powell",
            "interest rate",
            "ecb ",
            "european central bank",
            "bank of japan",
            "rate hike",
            "rate cut",
            "quantitative tightening",
            "quantitative easing",
        ),
    ),
)

# Layer 2 — sector impact multipliers (missing sector → neutral 1.0 at lookup time)
GEO_SECTOR_IMPACT: dict[str, dict[str, float]] = {
    OIL_SUPPLY_DISRUPTION: {
        "energy": 1.8,
        "airlines": 1.4,
        "technology": 0.3,
        "healthcare": 0.2,
    },
    US_CHINA_TRADE_TENSION: {
        "technology": 1.6,
        "semiconductors": 1.8,
        "consumer_discretionary": 1.3,
        "energy": 0.4,
    },
    MIDDLE_EAST_CONFLICT: {
        "energy": 1.8,
        "defense": 1.6,
        "airlines": 1.5,
        "communication_services": 0.4,
        "software": 0.3,
    },
    CENTRAL_BANK_POLICY: {
        "financials": 1.5,
        "real_estate": 1.4,
        "utilities": 1.3,
        "technology": 0.8,
    },
    LATAM_EMERGING_MARKET: {
        "financials": 1.7,
        "banks": 1.8,
        "energy": 1.4,
        "utilities": 1.3,
        "consumer_discretionary": 1.2,
        "technology": 0.6,
    },
}


def normalize_sector_for_geo(sic_bucket: str) -> str:
    """Map internal SIC bucket / ETF routing key → impact table key."""
    b = (sic_bucket or "").strip().lower()
    if b in ("oil_gas", "energy"):
        return "energy"
    if b == "airlines":
        return "airlines"
    if b == "semiconductors":
        return "semiconductors"
    if b == "software":
        return "software"
    if b in ("hardware", "internet", "technology"):
        return "technology"
    if b in ("pharma", "biotech", "medical_devices", "health_services", "healthcare"):
        return "healthcare"
    if b in ("auto", "retail", "restaurants", "consumer_disc"):
        return "consumer_discretionary"
    if b in ("media", "telecom", "communication"):
        return "communication_services"
    if b in ("banks", "insurance", "investment_services", "consumer_finance", "financials"):
        return "financials"
    if b in ("real_estate",):
        return "real_estate"
    if b in ("utilities",):
        return "utilities"
    if b in ("aerospace_defense",):
        return "defense"
    return b if b else "default"


def _article_severity_weight(text: str, *, high_kw: tuple[str, ...], med_kw: tuple[str, ...], low_kw: tuple[str, ...]) -> float:
    t = text.lower()
    if any(k in t for k in high_kw):
        return 3.0
    if any(k in t for k in med_kw):
        return 1.0
    if any(k in t for k in low_kw):
        return 0.5
    return 0.0


def detect_geo_event_scores(
    articles: list[dict[str, Any]],
    *,
    high_kw: tuple[str, ...],
    med_kw: tuple[str, ...],
    low_kw: tuple[str, ...],
) -> list[dict[str, Any]]:
    """
    Layer 1 continuation: accumulate severity-weighted hits per event type from articles.
    """
    totals: dict[str, float] = defaultdict(float)
    for art in articles:
        if not isinstance(art, dict):
            continue
        blob = f"{art.get('title', '')} {art.get('description', '')}"
        sev = _article_severity_weight(blob, high_kw=high_kw, med_kw=med_kw, low_kw=low_kw)
        if sev <= 0:
            continue
        tl = blob.lower()
        matched_types: set[str] = set()
        for etype, keywords in _EVENT_KEYWORD_ORDER:
            if any(k in tl for k in keywords):
                matched_types.add(etype)
        if not matched_types:
            continue
        for etype in matched_types:
            totals[etype] += sev
    out = [{"event_type": k, "score": round(v, 3)} for k, v in sorted(totals.items(), key=lambda x: -x[1])]
    return out


def geo_event_details_for_sector(events: list[dict[str, Any]], impact_sector_key: str) -> list[dict[str, Any]]:
    """Per active theme: severity score × lookup multiplier for this stock's mapped sector (or null)."""
    out: list[dict[str, Any]] = []
    ik = (impact_sector_key or "").strip()
    for ev in events:
        et = str(ev.get("event_type") or "")
        sc = float(ev.get("score") or 0.0)
        table = GEO_SECTOR_IMPACT.get(et)
        mult: float | None = None
        if table and ik and ik != "default":
            mult = float(table.get(ik, 1.0))
        out.append({"event_type": et, "score": round(sc, 3), "sector_multiplier": mult})
    return out


def geo_exposure_band(weighted_score: float) -> str:
    """Qualitative bucket for UI (aligned with deterministic summary thresholds)."""
    if weighted_score < 2.0:
        return "low"
    if weighted_score < 6.0:
        return "moderate"
    return "high"


def weighted_stock_geo_score(events: list[dict[str, Any]], impact_sector_key: str) -> float:
    """Layer 3 — sum(event.score * multiplier[event_type][sector])."""
    if not events or not impact_sector_key or impact_sector_key == "default":
        return 0.0
    total = 0.0
    for ev in events:
        et = str(ev.get("event_type") or "").strip()
        sc = float(ev.get("score") or 0.0)
        if not et or sc <= 0:
            continue
        table = GEO_SECTOR_IMPACT.get(et)
        if not table:
            continue
        mult = float(table.get(impact_sector_key, 1.0))
        total += sc * mult
    return round(total, 3)


def deterministic_geo_exposure_summary(
    *,
    events: list[dict[str, Any]],
    impact_sector_key: str,
    weighted_score: float,
) -> str:
    """Layer 4 (template) — short trader-facing line without LLM."""
    if not events:
        return "No classified geopolitical themes in the scan window — limited headline linkage."
    if impact_sector_key in ("", "default"):
        return "Sector bucket unknown — geo theme scores computed at headline level only."
    top = events[0]
    et = str(top.get("event_type") or "").replace("_", " ")
    if weighted_score >= 6.0:
        return f"Significant overlap: {et} headlines with high sensitivity for this sector ({impact_sector_key})."
    if weighted_score >= 2.5:
        return f"Moderate geo exposure: {et} and related themes weigh on {impact_sector_key}."
    if weighted_score <= 0.8:
        return f"Limited direct exposure: active themes ({et}) map to muted weights for {impact_sector_key}."
    return f"Balanced geo read: {et} active; {impact_sector_key} sits near neutral impact weights."


_COUNTRY_GEO_THEMES: dict[str, dict[str, str]] = {
    "AR": {
        "key": LATAM_EMERGING_MARKET,
        "display_name": "Argentina / LatAm Policy",
        "description": "Home-country policy, FX, and sovereign risk for Argentine ADRs.",
    },
    "BR": {
        "key": LATAM_EMERGING_MARKET,
        "display_name": "Brazil / LatAm Policy",
        "description": "Brazil rates, FX, and fiscal policy for LatAm ADRs.",
    },
    "MX": {
        "key": LATAM_EMERGING_MARKET,
        "display_name": "Mexico / LatAm Policy",
        "description": "Mexico macro and trade policy for LatAm ADRs.",
    },
}


def country_geo_theme_for_ticker(ticker_ref: Any | None) -> dict[str, str] | None:
    """Prefer home-country geo theme for non-US ADRs instead of generic US-China baseline."""
    if ticker_ref is None or not callable(getattr(ticker_ref, "is_adr", None)):
        return None
    if not ticker_ref.is_adr():
        return None
    country = str(getattr(ticker_ref, "country_code", None) or "").strip().upper()
    if not country or country == "US":
        return None
    return _COUNTRY_GEO_THEMES.get(country)
