"""Structured Benzinga analyst rating scoring — firm tier, PT distance, consensus, recency."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Any, Literal
from zoneinfo import ZoneInfo

from stocvest.data.benzinga_client import BenzingaMultiResult, BenzingaRating

TradingMode = Literal["day", "swing"]
AnalystFeedState = Literal["available", "unconfigured", "empty"]

ET = ZoneInfo("America/New_York")

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

HEADLINE_BLEND_WEIGHT: dict[TradingMode, float] = {"day": 0.5, "swing": 0.7}
ANALYST_BLEND_WEIGHT: dict[TradingMode, float] = {"day": 0.5, "swing": 0.3}

MAX_RATING_COMPONENT = 0.40
MAX_CONSENSUS_COMPONENT = 0.20
MAX_ANALYST_SCORE = 1.0


@dataclass(frozen=True)
class AnalystScoreBreakdown:
    """Standalone analyst sub-score in [-1, 1] for blending with headline sentiment."""

    score: float
    catalyst: str | None
    consensus: dict[str, Any] | None
    chips: tuple[str, ...]
    feed_state: AnalystFeedState


def blend_headline_and_analyst(
    headline_sentiment: float,
    analyst_score: float,
    *,
    mode: TradingMode,
    analyst_active: bool,
) -> float:
    """Blend headline and analyst sub-scores with mode-specific weights."""
    if not analyst_active:
        return max(-1.0, min(1.0, headline_sentiment))
    w_h = HEADLINE_BLEND_WEIGHT[mode]
    w_a = ANALYST_BLEND_WEIGHT[mode]
    return max(-1.0, min(1.0, w_h * headline_sentiment + w_a * analyst_score))


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


def _pt_upside_pct(current_price: float | None, price_target: float | None) -> float | None:
    if current_price is None or current_price <= 0 or price_target is None or price_target <= 0:
        return None
    return ((price_target - current_price) / current_price) * 100.0


def _action_base_and_catalyst(
    rating: BenzingaRating,
    *,
    current_price: float | None,
) -> tuple[float, str | None]:
    act = str(rating.action or "").lower()
    rat = str(rating.rating or "").lower()
    upside = _pt_upside_pct(current_price, rating.price_target)

    if _is_upgrade(act):
        return 0.15, "analyst_upgrade"
    if _is_downgrade(act):
        return -0.15, "analyst_downgrade"
    if "initiat" in act:
        if any(x in rat for x in ("buy", "outperform", "overweight")):
            return 0.10, "analyst_initiates_buy"
        if any(x in rat for x in ("sell", "underperform", "underweight")):
            return -0.10, "analyst_initiates_sell"
        if any(x in rat for x in ("hold", "neutral", "equal-weight", "equal weight")):
            return 0.03, "analyst_initiates_hold"
        return 0.05, "analyst_initiates"
    if "maintain" in act or "reiterat" in act:
        if upside is not None:
            if upside > 10:
                return 0.08, "analyst_pt_raise"
            if upside > 5:
                return 0.05, "analyst_maintains_bullish"
            if upside < -10:
                return -0.08, "analyst_pt_cut"
            if upside < -5:
                return -0.05, "analyst_maintains_bearish"
        if any(x in rat for x in ("buy", "outperform", "overweight")):
            return 0.03, "analyst_reiterates"
        if any(x in rat for x in ("sell", "underperform", "underweight")):
            return -0.03, "analyst_reiterates_bearish"
    return 0.0, None


def action_recency_weight(age_days: float) -> float:
    """News-layer analyst actions: >14d excluded, 7–14d partial, <7d full."""
    if age_days > 14:
        return 0.0
    if age_days > 7:
        return 0.3
    return 1.0


def et_session_bucket(published_at: datetime) -> str:
    et = published_at.astimezone(ET)
    t = et.time()
    if time(4, 0) <= t < time(9, 30):
        return "pre_market"
    if time(9, 30) <= t < time(16, 0):
        return "rth"
    if time(16, 0) <= t < time(20, 0):
        return "after_hours"
    return "overnight"


def day_session_recency_scale(published_at: datetime, now: datetime) -> float:
    """Session-aware day desk catalyst weight (pre-market > after-hours > RTH)."""
    et_now = now.astimezone(ET)
    et_pub = published_at.astimezone(ET)
    age_days = max(0.0, (now - published_at).total_seconds() / 86400.0)
    bucket = et_session_bucket(published_at)

    if et_pub.date() == et_now.date():
        if bucket == "pre_market":
            return 1.30
        if bucket == "after_hours":
            return 1.15
        if bucket == "rth":
            return 0.85
        return 0.75

    if age_days <= 1.5:
        if bucket in ("pre_market", "after_hours", "overnight"):
            return 1.20
        return 0.90

    if age_days <= 5:
        return 0.75
    return 0.50


def pt_conviction_multiplier(
    current_price: float | None,
    price_target: float | None,
    *,
    bearish: bool,
) -> float:
    """
    Modulate action magnitude (0.85–1.15) without flipping direction.
    PT confirms conviction; it does not add a second directional bump.
    """
    upside = _pt_upside_pct(current_price, price_target)
    if upside is None:
        return 1.0
    if bearish:
        if upside < -10:
            return 1.15
        if upside < 0:
            return 1.08
        if upside > 10:
            return 0.85
        return 0.92
    if upside > 20:
        return 1.15
    if upside >= 5:
        return 1.08
    if upside > 0:
        return 1.03
    if upside < -10:
        return 0.85
    return 0.88


def price_target_adjustment(current_price: float | None, price_target: float | None) -> float:
    """Legacy additive PT bands — kept for tests; scoring uses pt_conviction_multiplier."""
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
    """Count unique firms (not raw events) with upgrade/downgrade in the window."""
    ref = now or datetime.now(timezone.utc)
    cutoff = ref - timedelta(days=window_days)
    upgrade_firms: set[str] = set()
    downgrade_firms: set[str] = set()
    for r in ratings:
        if r.published_at < cutoff:
            continue
        firm = _normalize_firm(r.analyst_firm)
        if not firm:
            continue
        if _is_upgrade(r.action):
            upgrade_firms.add(firm)
        elif _is_downgrade(r.action):
            downgrade_firms.add(firm)
    upgrades = len(upgrade_firms)
    downgrades = len(downgrade_firms)
    return upgrades, downgrades, upgrades - downgrades


def consensus_label(momentum: int) -> str | None:
    if momentum >= CONSENSUS_STRONG_THRESHOLD:
        return "Analyst consensus improving"
    if momentum <= -CONSENSUS_STRONG_THRESHOLD:
        return "Analyst consensus deteriorating"
    return None


def _single_rating_score(
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

    base, catalyst = _action_base_and_catalyst(rating, current_price=current_price)
    if base == 0.0:
        return 0.0, None

    firm_w = analyst_firm_weight(rating.analyst_firm)
    mode_scale = day_session_recency_scale(rating.published_at, now) if mode == "day" else 1.0
    pt_mult = pt_conviction_multiplier(
        current_price,
        rating.price_target,
        bearish=base < 0,
    )
    combined = base * pt_mult * firm_w * recency * mode_scale
    combined = max(-MAX_RATING_COMPONENT, min(MAX_RATING_COMPONENT, combined))
    return combined, catalyst


def _resolve_feed_state(bz: BenzingaMultiResult | None) -> AnalystFeedState:
    if bz is None:
        return "unconfigured"
    if not bz.analyst_feed_configured:
        return "unconfigured"
    if not bz.ratings:
        return "empty"
    return "available"


def compute_structured_analyst_score(
    bz: BenzingaMultiResult | None,
    *,
    mode: TradingMode,
    current_price: float | None = None,
    now: datetime | None = None,
) -> AnalystScoreBreakdown:
    feed_state = _resolve_feed_state(bz)
    if bz is None or not bz.analyst_feed_configured:
        return AnalystScoreBreakdown(0.0, None, None, (), feed_state)

    if not bz.ratings:
        return AnalystScoreBreakdown(0.0, None, None, (), feed_state)

    ref = now or datetime.now(timezone.utc)
    ratings = sorted(bz.ratings, key=lambda r: r.published_at, reverse=True)

    rating_score = 0.0
    catalyst: str | None = None
    for r in ratings:
        score, cat = _single_rating_score(r, mode=mode, current_price=current_price, now=ref)
        if score != 0.0:
            rating_score += score
            if catalyst is None and cat:
                catalyst = cat
            break

    upgrades, downgrades, momentum = consensus_counts(ratings, now=ref)
    consensus_score = 0.0
    label = consensus_label(momentum)
    if mode == "swing" and label:
        consensus_score = MAX_CONSENSUS_COMPONENT if momentum >= CONSENSUS_STRONG_THRESHOLD else -MAX_CONSENSUS_COMPONENT
    elif mode == "day" and label:
        consensus_score = 0.08 if momentum >= CONSENSUS_STRONG_THRESHOLD else -0.08

    total = max(-MAX_ANALYST_SCORE, min(MAX_ANALYST_SCORE, rating_score + consensus_score))
    chip_list: list[str] = []
    if upgrades or downgrades:
        chip_list.append(f"Analyst 30d: {upgrades} firms↑ {downgrades}↓")
    if label:
        chip_list.append(label)

    consensus_payload: dict[str, Any] | None = None
    if upgrades or downgrades:
        consensus_payload = {
            "upgrades_30d": upgrades,
            "downgrades_30d": downgrades,
            "momentum": momentum,
            "label": label,
            "unique_firms": True,
        }

    return AnalystScoreBreakdown(
        score=total,
        catalyst=catalyst,
        consensus=consensus_payload,
        chips=tuple(chip_list),
        feed_state=feed_state,
    )


# Backward-compatible alias used during migration.
compute_structured_analyst_adjustment = compute_structured_analyst_score
