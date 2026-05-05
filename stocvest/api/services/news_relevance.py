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
    (("reuters", "bloomberg", "wsj", "wall street journal", "financial times", "the financial times"), 20),
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


def categorize_article(article: dict[str, Any]) -> str:
    """
    Primary UI category for filter tabs.
    Values: earnings | analyst | macro | sector | merger | breaking | general
    """
    text = (str(article.get("title") or "") + " " + str(article.get("description") or "")).lower()
    if any(
        w in text
        for w in (
            "breaking news",
            "breaking:",
            "news flash",
            "newsflash",
            "trading halt",
            "stock halt",
            "halted",
        )
    ):
        return "breaking"
    if any(k in text for k in CATALYST_EARNINGS):
        return "earnings"
    if any(k in text for k in CATALYST_ANALYST):
        return "analyst"
    if any(k in text for k in CATALYST_MACRO):
        return "macro"
    if any(k in text for k in CATALYST_MA):
        return "merger"
    if any(k in text for k in CATALYST_FDA) or any(k in text for k in CATALYST_SECTOR):
        return "sector"
    return "general"


def catalyst_category_for_text(title_lower: str, description_lower: str) -> str:
    """Legacy API field: fda / ma / macro / … for older clients."""
    blob = f"{title_lower} {description_lower}"
    cat = categorize_article({"title": title_lower, "description": description_lower, "tickers": [], "publisher": {}})
    if cat == "merger":
        return "ma"
    if cat == "breaking":
        return "macro"
    if cat == "sector" and any(k in blob for k in CATALYST_FDA):
        return "fda"
    if cat == "sector":
        return "sector"
    if cat in ("earnings", "analyst", "macro", "general"):
        return cat
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

    matched_cred = False
    for sources, pts in SOURCE_CREDIBILITY:
        if any(s in publisher for s in sources):
            score += pts
            matched_cred = True
            break
    if not matched_cred and (re.search(r"(^|\s)ft\.com(\s|$)", publisher) or publisher.strip() in {"ft", "the ft"}):
        score += 20

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


def deduplicate_articles(
    articles: list[dict[str, Any]],
    *,
    score_key: str = "_relevance_score",
) -> list[dict[str, Any]]:
    """
    Stories already sorted by relevance descending. Skip items whose topic fingerprint
    is ~60%+ word-overlap with a kept story (same event, different outlet).
    First kept row per cluster = highest score / best source.
    """
    _ = score_key  # ordering is extrinsic; tie-breaks handled before dedupe
    seen_topic_keys: list[str] = []
    deduped: list[dict[str, Any]] = []
    for article in articles:
        title = str(article.get("title") or "")
        title_words = title.lower().split()[:5]
        fingerprint = " ".join(title_words)
        tickers = article.get("tickers") or []
        primary = str(tickers[0]).strip().upper() if tickers else ""
        topic_key = f"{primary}:{fingerprint}"

        skip = False
        for seen in seen_topic_keys:
            seen_words = set(seen.split())
            curr_words = set(topic_key.split())
            inter = len(seen_words & curr_words)
            overlap = inter / max(len(seen_words), 1)
            if overlap > 0.6:
                skip = True
                break
        if not skip:
            seen_topic_keys.append(topic_key)
            deduped.append(article)
    return deduped
