"""Format Benzinga analyst ratings for the ticker news panel API."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from stocvest.data.benzinga_client import BenzingaRating
from stocvest.signals.analyst_rating_score import (
    CONSENSUS_WINDOW_DAYS,
    analyst_firm_weight,
    consensus_counts,
    consensus_label,
)
from stocvest.api.services.news_panel_format import compute_news_age_label


def _rating_row_id(rating: BenzingaRating) -> str:
    firm = (rating.analyst_firm or "unknown").strip().lower().replace(" ", "-")
    ts = rating.published_at.astimezone(timezone.utc).strftime("%Y%m%dT%H%M")
    return f"{firm}-{ts}"


def format_analyst_ratings_for_panel(
    ratings: list[BenzingaRating],
    *,
    symbol: str,
    analyst_feed_configured: bool,
    current_price: float | None = None,
    limit: int = 20,
    now: datetime | None = None,
) -> dict[str, Any]:
    ref = now or datetime.now(timezone.utc)
    feed_state: str
    if not analyst_feed_configured:
        feed_state = "unconfigured"
    elif not ratings:
        feed_state = "empty"
    else:
        feed_state = "available"

    upgrades, downgrades, momentum = consensus_counts(ratings, now=ref)
    label = consensus_label(momentum)
    consensus: dict[str, Any] | None = None
    if upgrades or downgrades:
        consensus = {
            "upgrades_30d": upgrades,
            "downgrades_30d": downgrades,
            "momentum": momentum,
            "label": label,
            "unique_firms": True,
        }

    rows: list[dict[str, Any]] = []
    for rating in sorted(ratings, key=lambda r: r.published_at, reverse=True)[: max(1, limit)]:
        upside_pct: float | None = None
        if (
            current_price is not None
            and current_price > 0
            and rating.price_target is not None
            and rating.price_target > 0
        ):
            upside_pct = round(((rating.price_target - current_price) / current_price) * 100.0, 1)
        pub_iso = rating.published_at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        rows.append(
            {
                "id": _rating_row_id(rating),
                "firm": rating.analyst_firm,
                "action": rating.action,
                "rating": rating.rating,
                "price_target": rating.price_target,
                "upside_pct": upside_pct,
                "firm_tier": "tier_1" if analyst_firm_weight(rating.analyst_firm) > 1.0 else "standard",
                "published_at": pub_iso,
                "age_label": compute_news_age_label(ref, rating.published_at),
            }
        )

    return {
        "feed_state": feed_state,
        "window_days": CONSENSUS_WINDOW_DAYS,
        "consensus": consensus,
        "ratings": rows,
        "total_found": len(ratings),
        "symbol": symbol.strip().upper(),
    }
