"""Relevance scoring, deduplication, and source credibility for market intelligence headlines."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

# Keyword tuples → points (first match wins for catalyst block).
CATALYST_EARNINGS = (
    "earnings",
    "beat",
    "miss",
    "eps",
    "revenue",
    "quarterly",
    "q1",
    "q2",
    "q3",
    "q4",
    "guidance",
)
CATALYST_ANALYST = (
    "upgrade",
    "downgrade",
    "price target",
    "raises target",
    "cuts target",
    "outperform",
    "overweight",
    "buy rating",
    "sell rating",
)
CATALYST_MA = ("merger", "acquisition", "acquired", "takeover", "buyout", "deal")
CATALYST_FDA = ("fda", "approval", "approved", "rejected", "clinical trial", "drug", "phase")
CATALYST_MACRO = (
    "federal reserve",
    "fed decision",
    "rate hike",
    "rate cut",
    "fomc",
    "inflation",
    "cpi",
    "jobs report",
    "nfp",
)
CATALYST_SECTOR = ("semiconductor", "chip", "ai", "cloud", "demand", "supply chain")

CATALYST_SCORES: dict[tuple[str, ...], int] = {
    CATALYST_EARNINGS: 40,
    CATALYST_ANALYST: 35,
    CATALYST_MA: 35,
    CATALYST_FDA: 30,
    CATALYST_MACRO: 25,
    CATALYST_SECTOR: 15,
}

PR_WIRE_SUBSTRINGS = (
    "globenewswire",
    "pr newswire",
    "business wire",
    "accesswire",
    "globe newswire",
    "prnewswire",
    "einpresswire",
)

# Substring match in publisher name → credibility points (first match wins).
SOURCE_CREDIBILITY: tuple[tuple[tuple[str, ...], int], ...] = (
    (("reuters", "bloomberg", "wsj", "wall street journal", "financial times"), 20),
    (("ap ", "associated press", "cnbc", "barron", "marketwatch"), 18),
    (("motley fool", "benzinga", "the street", "investopedia"), 12),
    (("seeking alpha", "zacks"), 8),
)


def _publisher_lc(article: dict[str, Any]) -> str:
    pub = article.get("publisher")
    if isinstance(pub, dict):
        return str(pub.get("name") or "").strip().lower()
    return ""


def _article_tickers_upper(article: dict[str, Any]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    insights = article.get("insights")
    if isinstance(insights, list):
        for item in insights:
            if isinstance(item, dict):
                sym = str(item.get("symbol") or item.get("ticker") or "").strip().upper()
                if sym and sym not in seen:
                    seen.add(sym)
                    out.append(sym)
    for raw in article.get("tickers") or []:
        sym = str(raw).strip().upper()
        if sym and sym not in seen:
            seen.add(sym)
            out.append(sym)
    return out


def catalyst_category_for_text(title_lower: str, description_lower: str) -> str:
    """UI filter bucket (single primary category)."""
    blob = f"{title_lower} {description_lower}"
    if any(k in blob for k in CATALYST_EARNINGS):
        return "earnings"
    if any(k in blob for k in CATALYST_ANALYST):
        return "analyst"
    if any(k in blob for k in CATALYST_MA):
        return "ma"
    if any(k in blob for k in CATALYST_FDA):
        return "fda"
    if any(k in blob for k in CATALYST_MACRO):
        return "macro"
    if any(k in blob for k in CATALYST_SECTOR):
        return "sector"
    return "general"


def calculate_article_relevance(
    article: dict[str, Any],
    watchlist_symbols: list[str] | None = None,
) -> int:
    """
    Scores each article 0-100 for signal value. Higher = more relevant to show first.
    """
    score = 0
    watchlist_symbols = [str(s).strip().upper() for s in (watchlist_symbols or []) if str(s).strip()]

    title_lower = (str(article.get("title") or "") + " " + str(article.get("description") or "")).lower()

    for keywords, pts in CATALYST_SCORES.items():
        if any(kw in title_lower for kw in keywords):
            score += pts
            break

    publisher = _publisher_lc(article)
    if any(p in publisher for p in PR_WIRE_SUBSTRINGS):
        score -= 25

    try:
        raw_pub = str(article.get("published_utc") or "").replace("Z", "+00:00")
        published = datetime.fromisoformat(raw_pub)
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        age_minutes = (datetime.now(timezone.utc) - published).total_seconds() / 60.0
        if age_minutes < 15:
            score += 30
        elif age_minutes < 60:
            score += 25
        elif age_minutes < 120:
            score += 20
        elif age_minutes < 240:
            score += 12
        elif age_minutes < 480:
            score += 5
    except (TypeError, ValueError, OSError):
        pass

    for sources, pts in SOURCE_CREDIBILITY:
        if any(s in publisher for s in sources):
            score += pts
            break

    article_tickers = _article_tickers_upper(article)
    if watchlist_symbols and any(s in article_tickers for s in watchlist_symbols):
        score += 10

    return max(0, min(100, score))


def publisher_credibility_rank(publisher_name: str) -> int:
    """Higher = more credible (tie-break after relevance score)."""
    p = (publisher_name or "").strip().lower()
    best = 0
    for sources, pts in SOURCE_CREDIBILITY:
        if any(s in p for s in sources):
            best = max(best, pts)
    if any(w in p for w in PR_WIRE_SUBSTRINGS):
        best = max(best, 1)
    return best


def source_credibility_meta(publisher_name: str) -> dict[str, str]:
    """Human-readable credibility for API/UI."""
    p = (publisher_name or "").strip().lower()
    if any(w in p for w in PR_WIRE_SUBSTRINGS):
        return {"label": "Press release wire", "band": "pr_wire"}
    for sources, pts in SOURCE_CREDIBILITY:
        if any(s in p for s in sources):
            if pts >= 20:
                return {"label": "Top-tier source", "band": "elite"}
            if pts >= 18:
                return {"label": "Major outlet", "band": "major"}
            if pts >= 12:
                return {"label": "Trade media", "band": "trade"}
            return {"label": "Research / blog", "band": "research"}
    return {"label": "News source", "band": "other"}


def _dedupe_key(article: dict[str, Any]) -> str:
    ticks = sorted({str(t).strip().upper() for t in (article.get("tickers") or []) if str(t).strip()})[:6]
    title = re.sub(r"[^a-z0-9\s]", " ", (str(article.get("title") or "")).lower())
    words = [w for w in title.split() if len(w) > 2][:14]
    return "|".join(ticks) + "::" + " ".join(words)


def _better_article(a: dict[str, Any], b: dict[str, Any], *, score_key: str) -> bool:
    sa = int(a.get(score_key) or 0)
    sb = int(b.get(score_key) or 0)
    if sa != sb:
        return sa > sb
    pa = str((a.get("publisher") or {}).get("name") or "") if isinstance(a.get("publisher"), dict) else ""
    pb = str((b.get("publisher") or {}).get("name") or "") if isinstance(b.get("publisher"), dict) else ""
    ra = publisher_credibility_rank(pa)
    rb = publisher_credibility_rank(pb)
    if ra != rb:
        return ra > rb
    return str(a.get("published_utc") or "") >= str(b.get("published_utc") or "")


def deduplicate_articles(
    articles: list[dict[str, Any]],
    *,
    score_key: str = "_relevance_score",
) -> list[dict[str, Any]]:
    """
    Collapse near-duplicate stories (same tickers + similar headline), keeping the
    strongest relevance (then highest source credibility).
    Preserves first-seen order of unique clusters (input must already be relevance-sorted).
    """
    best_by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for art in articles:
        key = _dedupe_key(art)
        if key not in best_by_key:
            best_by_key[key] = art
            order.append(key)
            continue
        cur = best_by_key[key]
        if _better_article(art, cur, score_key=score_key):
            best_by_key[key] = art
    return [best_by_key[k] for k in order]
