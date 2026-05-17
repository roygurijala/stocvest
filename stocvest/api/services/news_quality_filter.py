from __future__ import annotations

from typing import Any

from stocvest.api.services.news_relevance import _article_tickers_upper

BLOCKED_PUBLISHERS = [
    "globenewswire",
    "prnewswire",
    "businesswire",
    "accesswire",
    "einpresswire",
    "globenewswire inc",
    "pr newswire",
]

TIER_1_PUBLISHERS = [
    "reuters",
    "bloomberg",
    "cnbc",
    "wall street journal",
    "wsj",
    "financial times",
    "marketwatch",
    "barrons",
    "the motley fool",
    "seeking alpha",
]

NOISE_SUBSTRINGS = [
    "cagr",
    "market size",
    "market research",
    "industry report",
    "research report",
    "market forecast",
    "projected to reach",
    "billion by 20",
    "million by 20",
    "compound annual",
    "market is expected",
    "global market",
    "market overview",
    "all time best",
    "all-time best",
    "best performing stock",
    "worst performing stock",
    "years of returns",
    "historical returns",
    "since ipo",
]


def _publisher_name(article: dict[str, Any]) -> str:
    pub = article.get("publisher")
    if isinstance(pub, dict):
        raw = pub.get("name")
        return str(raw or "").strip()
    return ""


def passes_market_intelligence_gate(article: dict[str, Any]) -> bool:
    """
    Polygon market-news pipeline: require tickers + block listicle noise.
    PR wires are *not* hard-dropped here — relevance scoring penalizes them instead.
    """
    title = str(article.get("title") or "").lower()
    description = str(article.get("description") or "").lower()
    combined = f"{title} {description}"
    if any(noise in combined for noise in NOISE_SUBSTRINGS):
        return False

    tickers = article.get("tickers")
    if isinstance(tickers, list) and any(str(t).strip() for t in tickers):
        return True
    # Polygon often tags via insights[] only; composite news layer already counts those.
    return bool(_article_tickers_upper(article))


def is_quality_article(article: dict[str, Any]) -> bool:
    """Return True when the article is relevant for active traders."""
    publisher = _publisher_name(article).lower()
    if any(blocked in publisher for blocked in BLOCKED_PUBLISHERS):
        return False

    return passes_market_intelligence_gate(article)


def get_publisher_tier(publisher_name: str) -> int:
    """Return 1 for top-tier publishers, else 2."""
    name = (publisher_name or "").strip().lower()
    if any(tier in name for tier in TIER_1_PUBLISHERS):
        return 1
    return 2