"""Additive composite layer fields for UI detail drawers (articles, ratings, indicators)."""

from __future__ import annotations

from typing import Any


def quality_article_wire(article: dict[str, Any], sentiment: float) -> dict[str, Any] | None:
    title = str(article.get("title") or "").strip()
    if not title:
        return None
    url = article.get("article_url") or article.get("url")
    return {
        "text": title[:240],
        "source": str(article.get("source") or "polygon").strip().lower() or "polygon",
        "published_at": str(article.get("published_utc") or ""),
        "sentiment_score": round(float(sentiment), 3),
        "sentiment": "positive" if sentiment > 0.3 else "negative" if sentiment < -0.3 else "neutral",
        "url": url if url else None,
    }


def recent_ratings_wire(ratings: list[Any], *, max_items: int = 6, max_age_days: int = 30) -> list[dict[str, Any]]:
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)
    out: list[dict[str, Any]] = []
    for r in ratings[: max_items * 2]:
        published = getattr(r, "published_at", None)
        if published is None:
            continue
        if (now - published) > timedelta(days=max_age_days):
            continue
        pt = getattr(r, "price_target", None)
        out.append(
            {
                "action": str(getattr(r, "action", "") or "").strip(),
                "rating": str(getattr(r, "rating", "") or "").strip(),
                "firm": str(getattr(r, "analyst_firm", "") or "").strip(),
                "date": published.date().isoformat(),
                "price_target": float(pt) if pt is not None else None,
            }
        )
        if len(out) >= max_items:
            break
    return out


def technical_indicator_snapshot_wire(res: Any, *, mode: str) -> dict[str, Any] | None:
    """Structured indicator readout for layer detail drawers."""
    if res is None:
        return None
    if mode == "swing":
        snap: dict[str, Any] = {"mode": "swing"}
        for key in (
            "daily_rsi",
            "sma20",
            "sma50",
            "sma200",
            "bars_analyzed",
            "base_days",
            "base_range_pct",
        ):
            val = getattr(res, key, None)
            if val is not None:
                snap[key] = val
        if getattr(res, "golden_cross", False):
            snap["golden_cross"] = True
        if getattr(res, "macd_above_signal", False):
            snap["macd_above_signal"] = True
        if getattr(res, "higher_highs_lows", False):
            snap["higher_highs_lows"] = True
        if getattr(res, "in_base", False):
            snap["in_base"] = True
        vol = getattr(res, "volume_regime", None)
        if vol:
            snap["volume_regime"] = str(vol)
        return snap if len(snap) > 1 else None

    snap = {"mode": "day"}
    for key in ("rsi", "ema9", "ema20", "vwap_from_bars", "volume_vs_adv", "bars_analyzed", "orb_signal", "ema_alignment"):
        val = getattr(res, key, None)
        if val is not None:
            snap[key] = val
    if getattr(res, "volume_surge", False):
        snap["volume_surge"] = True
    if getattr(res, "orb_qualified", False):
        snap["orb_qualified"] = True
    vwap_state = getattr(res, "vwap_state", None)
    if vwap_state:
        snap["vwap_state"] = str(vwap_state)
    return snap if len(snap) > 1 else None
