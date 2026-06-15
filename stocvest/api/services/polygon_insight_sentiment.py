"""Per-ticker sentiment from Polygon news ``insights`` rows."""

from __future__ import annotations

from typing import Any

_POSITIVE = frozenset({"positive", "bullish"})
_NEGATIVE = frozenset({"negative", "bearish"})


def _insight_ticker(insight: dict[str, Any]) -> str:
    return str(insight.get("ticker") or insight.get("symbol") or "").strip().upper()


def insight_sentiment_score(insight: dict[str, Any]) -> float:
    s = str(insight.get("sentiment") or "").strip().lower()
    if s in _POSITIVE:
        return 1.0
    if s in _NEGATIVE:
        return -1.0
    return 0.0


def insight_sentiment_label(insight: dict[str, Any]) -> str:
    s = str(insight.get("sentiment") or "").strip().lower()
    if s in _POSITIVE:
        return "positive"
    if s in _NEGATIVE:
        return "negative"
    return "neutral"


def _article_ticker_count(article: dict[str, Any]) -> int:
    tickers = article.get("tickers")
    if not isinstance(tickers, list):
        return 0
    return len({str(t).strip().upper() for t in tickers if str(t).strip()})


def article_sentiment_score_for_symbol(
    article: dict[str, Any],
    symbol: str | None = None,
) -> float:
    """
    Resolve sentiment for ``symbol`` from Polygon insights.

    Multi-ticker comparison articles often tag each name separately. Using only
    ``insights[0]`` misattributes competitor sentiment (e.g. bearish AEVA applied to CGNX).
    """
    sym = (symbol or "").strip().upper()
    insights = article.get("insights")
    parsed: list[dict[str, Any]] = []
    if isinstance(insights, list):
        parsed = [x for x in insights if isinstance(x, dict)]

    if parsed and sym:
        for item in parsed:
            if _insight_ticker(item) == sym:
                return insight_sentiment_score(item)

    ticker_count = _article_ticker_count(article)

    if parsed:
        if len(parsed) == 1 and ticker_count <= 1:
            return insight_sentiment_score(parsed[0])
        if sym and ticker_count > 1:
            # Comparison piece without a ticker-specific insight — abstain.
            return 0.0
        if len(parsed) == 1:
            return insight_sentiment_score(parsed[0])

    raw = str(article.get("sentiment") or "").strip().lower()
    if raw in _POSITIVE:
        return 1.0
    if raw in _NEGATIVE:
        return -1.0
    return 0.0


def article_sentiment_label_for_symbol(
    article: dict[str, Any],
    symbol: str | None = None,
) -> str:
    score = article_sentiment_score_for_symbol(article, symbol)
    if score > 0.2:
        return "positive"
    if score < -0.2:
        return "negative"
    return "neutral"
