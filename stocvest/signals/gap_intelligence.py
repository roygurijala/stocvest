"""
Gap intelligence: merge pre-market gap candidates with news catalyst context.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from stocvest.data.models import NewsArticle, Snapshot
from stocvest.signals.day_trading_scanner import PremarketGapCandidate
from stocvest.signals.news_catalyst_detector import NewsCatalystCandidate, NewsCatalystDetector

NO_CATALYST_WARNING = (
    "No catalyst found — momentum gap only. Price-only gaps carry higher reversal risk."
)

SECONDARY_SHARED_CATALYST_HEADLINE = "Referenced in related news — see primary ticker"


def calculate_gap_quality_score(
    gap_pct: float,
    volume_vs_avg: float,
    has_catalyst: bool,
    price: float,
) -> int:
    score = 0
    ag = abs(gap_pct)
    if ag >= 10:
        score += 30
    elif ag >= 5:
        score += 20
    elif ag >= 2:
        score += 10
    if volume_vs_avg >= 2.0:
        score += 30
    elif volume_vs_avg >= 1.5:
        score += 20
    elif volume_vs_avg >= 1.0:
        score += 10
    if has_catalyst:
        score += 20
    if price >= 10:
        score += 20
    elif price >= 5:
        score += 10
    return score


def _volume_vs_adv(day_volume: float, prev_day_volume: float | None) -> float:
    if prev_day_volume is not None and prev_day_volume > 0:
        return day_volume / float(prev_day_volume)
    return 1.0


def _filter_articles_last_hours(articles: list[NewsArticle], *, hours: int = 24) -> list[NewsArticle]:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    return [a for a in articles if a.published_at >= cutoff]


@dataclass
class _GapWork:
    gap: PremarketGapCandidate
    snap: Snapshot | None
    company_name: str
    volume_vs_avg: float
    adv: float | None


def _first_ticker_position_in_title(title: str, symbol: str) -> int | None:
    sym = symbol.strip()
    if not sym:
        return None
    m = re.search(rf"\b{re.escape(sym)}\b", title, re.IGNORECASE)
    return m.start() if m else None


def _pick_primary_gap_index(items: list[dict[str, Any]], indices: list[int]) -> int:
    """Prefer ticker appearing earliest in the headline; tie-break on higher gap_quality_score."""
    cat0 = items[indices[0]].get("catalyst")
    headline = str(cat0.get("headline") or "") if isinstance(cat0, dict) else ""
    scored: list[tuple[int, int, int]] = []
    for i in indices:
        sym = str(items[i].get("symbol") or "").strip().upper()
        pos = _first_ticker_position_in_title(headline, sym)
        pos_key = pos if pos is not None else 9999
        gqs = int(items[i].get("gap_quality_score") or 0)
        scored.append((pos_key, -gqs, i))
    scored.sort()
    return scored[0][2]


def _dedupe_shared_catalyst_headlines(items: list[dict[str, Any]]) -> None:
    """Same article/headline on multiple gap cards: keep primary headline on one symbol only."""
    groups: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(items):
        cat = row.get("catalyst")
        if not isinstance(cat, dict):
            continue
        hid = str(cat.get("article_id") or "").strip()
        hl = str(cat.get("headline") or "").strip().lower()
        if not hl:
            continue
        key = hid if hid else f"headline:{hl}"
        groups[key].append(i)
    for idxs in groups.values():
        if len(idxs) < 2:
            continue
        primary_i = _pick_primary_gap_index(items, idxs)
        for i in idxs:
            if i == primary_i:
                continue
            cat = items[i].get("catalyst")
            if isinstance(cat, dict):
                cat["headline"] = SECONDARY_SHARED_CATALYST_HEADLINE


def _prepare_work_items(
    gaps: list[PremarketGapCandidate],
    snapshot_by_symbol: dict[str, Snapshot],
) -> list[_GapWork]:
    out: list[_GapWork] = []
    for g in gaps:
        snap = snapshot_by_symbol.get(g.symbol)
        company_name = (snap.company_name.strip() if snap and snap.company_name else "") or ""
        prev_v = float(snap.prev_day_volume) if snap and snap.prev_day_volume is not None else None
        vol_ratio = _volume_vs_adv(g.day_volume, prev_v)
        out.append(_GapWork(gap=g, snap=snap, company_name=company_name, volume_vs_avg=vol_ratio, adv=prev_v))
    return out


def build_gap_intelligence_items(
    gaps: list[PremarketGapCandidate],
    snapshot_by_symbol: dict[str, Snapshot],
    articles: list[NewsArticle],
    *,
    detector: NewsCatalystDetector | None = None,
    news_lookback_hours: int = 24,
) -> list[dict[str, Any]]:
    det = detector or NewsCatalystDetector(min_score=0.35)
    arts = _filter_articles_last_hours(articles, hours=news_lookback_hours)
    work = _prepare_work_items(gaps, snapshot_by_symbol)
    items: list[dict[str, Any]] = []

    for w in work:
        g = w.gap
        price = float(g.premarket_price)
        day_vol = float(g.day_volume)
        prev_v = w.adv

        if price < 5.0 or day_vol < 500_000:
            continue
        if prev_v is not None and prev_v > 0 and w.volume_vs_avg < 0.5:
            continue

        best: NewsCatalystCandidate | None = None
        best_article: NewsArticle | None = None
        for art in arts:
            c = det.candidate_for_symbol(art, g.symbol)
            if c is None:
                continue
            if best is None or c.catalyst_score > best.catalyst_score:
                best = c
                best_article = art

        has_cat = best is not None
        gqs = calculate_gap_quality_score(g.gap_percent, w.volume_vs_avg, has_cat, price)
        if gqs < 40:
            continue

        gap_dollars = round(price - float(g.prev_close), 4)
        catalyst_payload: dict[str, Any] | None = None
        if best is not None and best_article is not None:
            pub = best_article.published_at.isoformat() if best_article.published_at else ""
            catalyst_payload = {
                "article_id": best.article_id,
                "headline": best.title,
                "category": best.catalyst_type,
                "sentiment": best.sentiment_label,
                "score": best.narrative_score,
                "article_url": best_article.url,
                "article_description": (best_article.description or "").strip(),
                "published_at": pub,
                "source": (best_article.source or "").strip(),
            }
        elif best is not None:
            catalyst_payload = {
                "article_id": best.article_id,
                "headline": best.title,
                "category": best.catalyst_type,
                "sentiment": best.sentiment_label,
                "score": best.narrative_score,
            }

        items.append(
            {
                "symbol": g.symbol,
                "company_name": w.company_name,
                "gap_pct": g.gap_percent,
                "gap_dollars": gap_dollars,
                "prev_close": g.prev_close,
                "current_price": price,
                "volume": int(day_vol),
                "volume_vs_avg": round(w.volume_vs_avg, 4),
                "gap_quality_score": gqs,
                "catalyst": catalyst_payload,
                "has_catalyst": has_cat,
                "no_catalyst_warning": None if has_cat else NO_CATALYST_WARNING,
            }
        )

    _dedupe_shared_catalyst_headlines(items)
    items.sort(key=lambda row: (row["has_catalyst"], row["gap_quality_score"]), reverse=True)
    return items[:10]
