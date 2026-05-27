"""Structured Benzinga analyst rating scoring — firm tier, PT distance, consensus, recency."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from stocvest.data.benzinga_client import BenzingaMultiResult, BenzingaRating

TradingMode = Literal["day", "swing"]

# Normalized substring match — Benzinga firm strings vary ("JPMorgan Chase", etc.).
TIER_1_FIRM_FRAGMENTS: tuple[str, ...] = (
    "goldman sachs",
    "morgan stanley",
    "jpmorgan",
    "j.p. morgan",
    "bank of america",
    "wells fargo",
    "citigroup",
    "citi ",
)

CONSENSUS_WINDOW_DAYS = 30
CONSENSUS_STRONG_THRESHOLD = 3


@dataclass(frozen=True)
class AnalystScoreBreakdown:
    """Additive sentiment adjust in [-1, 1] space (same units as NewsAnalyzer weighted_avg nudge)."""

    adjust: float
    catalyst: str | None
    consensus: dict[str, Any] | None
    chips: tuple[str, ...]


def _normalize_firm(firm: str) -> str:
    return " ".join(str(firm or "").strip().lower().split())


def analyst_firm_weight(firm: str) -> float:
    n = _normalize_firm(firm)
    if not n:
        return 1.0
    for frag in TIER_1_FIRM_FRAGMENTS:
        if frag in n:
            return 1.5
    return 1.0


def _is_upgrade(action: str) -> bool:
    return "upgrade" in str(action or "").lower()


def _is_downgrade(action: str) -> bool:
    return "downgrade" in str(action or "").lower()


def _is_initiate_buy(action: str, rating: str) -> bool:
    act = str(action or "").lower()
    rat = str(rating or "").lower()
    return "initiate" in act and "buy" in rat


def action_recency_weight(age_days: float) -> float:
    """News-layer analyst actions: >14d excluded, 7–14d partial, <7d full."""
    if age_days > 14:
        return 0.0
    if age_days > 7:
        return 0.3
    return 1.0


def day_action_recency_boost(age_days: float) -> float:
    """Day desk: today/yesterday actions are direct gap catalysts."""
    if age_days <= 1.5:
        return 1.25
    if age_days <= 5:
        return 1.0
    return 0.65


def price_target_adjustment(current_price: float | None, price_target: float | None) -> float:
    """
    Map PT distance to sentiment nudge (≈ +15 / +8 / +3 / −10 on 0–100 news score scale).
    """
    if current_price is None or current_price <= 0 or price_target is None or price_target <= 0:
        return 0.0
    upside_pct = ((price_target - current_price) / current_price) * 100.0
    if upside_pct > 20:
        return 0.15
    if upside_pct >= 5:
        return 0.08
    if upside_pct > 0:
        return 0.03
    return -0.10


def consensus_counts(
    ratings: list[BenzingaRating],
    *,
    window_days: int = CONSENSUS_WINDOW_DAYS,
    now: datetime | None = None,
) -> tuple[int, int, int]:
    ref = now or datetime.now(timezone.utc)
    cutoff = ref - timedelta(days=window_days)
    upgrades = downgrades = 0
    for r in ratings:
        if r.published_at < cutoff:
            continue
        if _is_upgrade(r.action):
            upgrades += 1
        elif _is_downgrade(r.action):
            downgrades += 1
    return upgrades, downgrades, upgrades - downgrades


def consensus_label(momentum: int) -> str | None:
    if momentum >= CONSENSUS_STRONG_THRESHOLD:
        return "Analyst consensus improving"
    if momentum <= -CONSENSUS_STRONG_THRESHOLD:
        return "Analyst consensus deteriorating"
    return None


def _single_rating_adjustment(
    rating: BenzingaRating,
    *,
    mode: TradingMode,
    current_price: float | None,
    now: datetime,
) -> tuple[float, str | None]:
    age_days = max(0.0, (now - rating.published_at).total_seconds() / 86400.0)
    recency = action_recency_weight(age_days)
    if recency <= 0:
        return 0.0, None

    firm_w = analyst_firm_weight(rating.analyst_firm)
    mode_scale = day_action_recency_boost(age_days) if mode == "day" else 1.0

    base = 0.0
    catalyst: str | None = None
    if _is_upgrade(rating.action):
        base = 0.15
        catalyst = "analyst_upgrade"
    elif _is_downgrade(rating.action):
        base = -0.15
        catalyst = "analyst_downgrade"
    elif _is_initiate_buy(rating.action, rating.rating):
        base = 0.10
        catalyst = "analyst_initiates_buy"

    if base == 0.0:
        return 0.0, None

    pt_adj = price_target_adjustment(current_price, rating.price_target)
    combined = (base + pt_adj) * firm_w * recency * mode_scale
    return combined, catalyst


def compute_structured_analyst_adjustment(
    bz: BenzingaMultiResult | None,
    *,
    mode: TradingMode,
    current_price: float | None = None,
    now: datetime | None = None,
) -> AnalystScoreBreakdown:
    if bz is None or not bz.ratings:
        return AnalystScoreBreakdown(0.0, None, None, ())

    ref = now or datetime.now(timezone.utc)
    ratings = sorted(bz.ratings, key=lambda r: r.published_at, reverse=True)

    rating_adjust = 0.0
    catalyst: str | None = None
    if mode == "day":
        for r in ratings:
            adj, cat = _single_rating_adjustment(r, mode=mode, current_price=current_price, now=ref)
            if adj != 0.0:
                rating_adjust += adj
                if catalyst is None and cat:
                    catalyst = cat
                break
    else:
        adj, cat = _single_rating_adjustment(ratings[0], mode=mode, current_price=current_price, now=ref)
        rating_adjust += adj
        catalyst = cat

    upgrades, downgrades, momentum = consensus_counts(ratings, now=ref)
    consensus_adj = 0.0
    label = consensus_label(momentum)
    if mode == "swing" and label:
        consensus_adj = 0.12 if momentum >= CONSENSUS_STRONG_THRESHOLD else -0.12
    elif mode == "day" and label:
        consensus_adj = 0.05 if momentum >= CONSENSUS_STRONG_THRESHOLD else -0.05

    total = max(-0.35, min(0.35, rating_adjust + consensus_adj))
    chips: list[str] = []
    if upgrades or downgrades:
        chips.append(f"Analyst 30d: {upgrades}↑ {downgrades}↓")
    if label:
        chips.append(label)

    consensus_payload: dict[str, Any] | None = None
    if upgrades or downgrades:
        consensus_payload = {
            "upgrades_30d": upgrades,
            "downgrades_30d": downgrades,
            "momentum": momentum,
            "label": label,
        }

    return AnalystScoreBreakdown(
        adjust=total,
        catalyst=catalyst,
        consensus=consensus_payload,
        chips=tuple(chips),
    )
